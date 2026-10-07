import type { EntryRecord, ToolRegistration } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import type { TranscriptMessage } from "../session/messages.ts";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { createTwoFilesPatch } from "diff";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { ReminderSource } from "../reminders/index.ts";
import { defineToolState, type ToolStateDefinition } from "../tool-state/index.ts";

const trackedFileSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    mtimeMs: Type.Number(),
    size: Type.Integer({ minimum: 0 }),
    hash: Type.String({ pattern: "^[a-fA-F0-9]{64}$" }),
    stale: Type.Boolean(),
  },
  { additionalProperties: false },
);
const candidateSchema = Type.Object(
  {
    callId: Type.String({ minLength: 1 }),
    toolName: Type.Union([Type.Literal("read"), Type.Literal("write"), Type.Literal("edit")]),
    file: trackedFileSchema,
  },
  { additionalProperties: false },
);
const trackingSchema = Type.Object(
  {
    files: Type.Array(trackedFileSchema),
    lastResultEntryId: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
type TrackingSnapshot = Static<typeof trackingSchema>;

function validSnapshot(value: unknown): value is TrackingSnapshot {
  return (
    Value.Check(trackingSchema, value) &&
    value.files.every((file) => isAbsolute(file.path) && Number.isFinite(file.mtimeMs))
  );
}

export const fileTrackingState: ToolStateDefinition = defineToolState({
  history: "rewindable",
  fork: "asOf",
  name: "file-tracking",
  version: 1,
  parse(version, value) {
    if (version !== 1) throw new Error(`Unsupported file-tracking version: ${version}`);
    if (!validSnapshot(value)) throw new Error("Invalid file-tracking schema.");
    return value;
  },
});

interface TrackedFile {
  path: string;
  mtimeMs: number;
  size: number;
  hash: string;
  content?: string;
  stale: boolean;
  unavailable?: boolean;
}

function textContent(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

async function baseline(path: string): Promise<TrackedFile> {
  const metadata = await stat(path);
  const bytes = await readFile(path);
  return {
    path,
    mtimeMs: metadata.mtimeMs,
    size: metadata.size,
    hash: createHash("sha256").update(bytes).digest("hex"),
    content: textContent(bytes),
    stale: false,
  };
}

/** Each Session owns the last file contents its model learned through file tools or diffs. */
export function createFileTracking(
  cwd: string,
  options: {
    initialState?: unknown;
    previousReminder?: string;
    persist: (
      snapshot: TrackingSnapshot,
      reminder?: Extract<TranscriptMessage, { role: "system-reminder" }>,
    ) => Promise<void>;
  },
) {
  const files = new Map<string, TrackedFile>();
  const pendingReminders = new Map<
    string,
    Map<string, { previous: TrackedFile; current?: TrackedFile }>
  >();
  const toolCandidates = new Map<
    string,
    { candidate: Static<typeof candidateSchema>; current: TrackedFile }
  >();
  let lastResultEntryId = 0;
  let requestRemaining = 16000;
  const restore = (snapshot: unknown) => {
    const previous = new Map(files);
    files.clear();
    lastResultEntryId = 0;
    pendingReminders.clear();
    requestRemaining = 16000;
    if (!validSnapshot(snapshot)) return;
    lastResultEntryId = snapshot.lastResultEntryId ?? 0;
    for (const file of snapshot.files) {
      const known = previous.get(file.path);
      files.set(file.path, {
        ...file,
        ...(known?.hash === file.hash && { content: known.content }),
      });
    }
  };
  restore(options.initialState);
  // Continue the event identity across resume so equal path-only reports still inject.
  let sequence = Number(options.previousReminder?.match(/^File changes \((\d+)\):/)?.[1] ?? 0);
  const persist = (
    unreported?: ReadonlySet<string>,
    reminder?: Extract<TranscriptMessage, { role: "system-reminder" }>,
  ) =>
    options.persist(
      {
        ...(lastResultEntryId ? { lastResultEntryId } : {}),
        files: Array.from(files.values(), ({ path, mtimeMs, size, hash, stale }) => ({
          path,
          mtimeMs,
          size,
          hash,
          stale: stale || (unreported?.has(path) ?? false),
        })),
      },
      reminder,
    );
  const displayPath = (path: string) => {
    const local = relative(cwd, path);
    return local === ".." || local.startsWith("../") || isAbsolute(local) ? path : local;
  };
  const reminderSource: ReminderSource = {
    source: "file-changes",
    async currentContent() {
      const previousFiles = new Map(files);
      const previousRemaining = requestRemaining;
      try {
        const pending: Array<{
          path: string;
          previous: TrackedFile;
          report: string;
          current?: TrackedFile;
          patch?: string;
        }> = [];
        for (const [path, previous] of files) {
          let metadata: { mtimeMs: number; size: number } | undefined;
          let refreshed = false;
          try {
            metadata = await stat(path);
            if (metadata.mtimeMs === previous.mtimeMs && metadata.size === previous.size) continue;
            const current = await baseline(path);
            current.stale = previous.stale;
            if (current.hash === previous.hash) {
              current.content = previous.content;
              files.set(path, current);
              refreshed = true;
              continue;
            }
            const shown = displayPath(path);
            const patch =
              previous.content !== undefined && current.content !== undefined
                ? createTwoFilesPatch(shown, shown, previous.content, current.content, "", "", {
                    context: 3,
                  })
                : undefined;
            pending.push({
              path,
              previous,
              report: `Externally modified: ${shown}. Read it again before editing.`,
              current,
              patch: patch !== undefined && patch.length <= 4000 ? patch : undefined,
            });
          } catch (error) {
            if (
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "ENOENT"
            ) {
              pending.push({ path, previous, report: `Deleted: ${displayPath(path)}` });
            } else if (
              !previous.unavailable ||
              (metadata &&
                (metadata.mtimeMs !== previous.mtimeMs || metadata.size !== previous.size))
            ) {
              // No bytes were available to hash. Keep the last hash and any metadata we did observe.
              pending.push({
                path,
                previous,
                report: `Externally modified: ${displayPath(path)}. Read it again before editing.`,
                current: {
                  ...previous,
                  mtimeMs: metadata?.mtimeMs ?? previous.mtimeMs,
                  size: metadata?.size ?? previous.size,
                  content: undefined,
                  stale: true,
                  unavailable: true,
                },
              });
            }
          } finally {
            // Storage failures are not filesystem failures and must reach the caller.
            if (refreshed) await persist();
          }
        }
        if (!pending.length) return undefined;
        const header = `File changes (${sequence + 1}):\nThe following files were modified since you last read or wrote them (by the user, a hook, a command, or another agent):\n\n`;
        const changes: string[] = [];
        const diffs: Array<{ index: number; patch: string; current: TrackedFile }> = [];
        const candidates = new Map<string, { previous: TrackedFile; current?: TrackedFile }>();
        let remaining = requestRemaining - header.length;
        // Stage only reports that fit; neither reported nor deferred knowledge advances yet.
        for (const { path, previous, report, current, patch } of pending) {
          const cost = report.length + (changes.length ? 2 : 0);
          if (cost > remaining) break;
          remaining -= cost;
          const index = changes.length;
          changes.push(report);
          candidates.set(path, { previous, current });
          if (current) {
            if (patch !== undefined) {
              diffs.push({ index, patch, current });
            } else {
              current.content = undefined;
              current.stale = true;
            }
          }
        }
        if (!changes.length) return undefined;
        // Reserve path-only reports, separators, and the header before spending context on diffs.
        let exhausted = false;
        for (const { index, patch, current } of diffs) {
          const extra = patch.length - changes[index]!.length;
          if (!exhausted && extra <= remaining) {
            changes[index] = patch;
            remaining -= extra;
          } else {
            exhausted = true;
            current.content = undefined;
            current.stale = true;
          }
        }
        // Event reminders can repeat the same diff after another successful file tool operation.
        sequence++;
        const content = header + changes.join("\n\n");
        requestRemaining -= content.length;
        // Persist old hashes and paths so failed reminder delivery remains detectable after resume.
        // The conservative stale flags also protect conversation rewind from unseen diff knowledge.
        await persist(new Set(candidates.keys()));
        pendingReminders.set(content, candidates);
        return content;
      } catch (error) {
        files.clear();
        for (const [path, file] of previousFiles) files.set(path, file);
        requestRemaining = previousRemaining;
        throw error;
      }
    },
  };
  /** The immutable successful receipt, rather than a staged candidate, advances knowledge. */
  async function commitResults(entries: readonly EntryRecord[]) {
    // These candidates entered this cache only after their native owner-entry commit.
    // A warm afterTools callback can therefore supply receipts without rescanning history.
    const candidates = new Map(
      [...toolCandidates].map(([callId, value]) => [callId, value.candidate]),
    );
    const previous = new Map(files);
    const previousResultEntryId = lastResultEntryId;
    const next = new Map(files);
    let nextResultEntryId = lastResultEntryId;
    const learned: string[] = [];
    for (const entry of entries) {
      if (entry.kind === "rukie.file-baseline") {
        if (
          !Value.Check(candidateSchema, entry.data) ||
          !isAbsolute(entry.data.file.path) ||
          !Number.isFinite(entry.data.file.mtimeMs)
        )
          throw new Error("Invalid committed file baseline candidate.");
        candidates.set(entry.data.callId, entry.data);
      }
      if (Number(entry.id) <= previousResultEntryId) continue;
      for (const message of entry.model ?? []) {
        if (message.role !== "toolResult") continue;
        const candidate = candidates.get(message.toolCallId);
        if (!candidate || candidate.toolName !== message.toolName || message.isError) continue;
        const warm = toolCandidates.get(message.toolCallId)?.current;
        next.set(
          candidate.file.path,
          warm?.hash === candidate.file.hash ? warm : { ...candidate.file },
        );
        nextResultEntryId = Math.max(nextResultEntryId, Number(entry.id));
        learned.push(message.toolCallId);
      }
    }
    if (!learned.length) return;
    files.clear();
    for (const [path, file] of next) files.set(path, file);
    lastResultEntryId = nextResultEntryId;
    try {
      await persist();
      for (const id of learned) toolCandidates.delete(id);
    } catch (error) {
      files.clear();
      for (const [path, file] of previous) files.set(path, file);
      lastResultEntryId = previousResultEntryId;
      throw error;
    }
  }
  return {
    reminderSource,
    /** Replace a Tool State projection; retain bytes only when their hash still matches. */
    restore,
    /** Reconcile saved successful receipts before native task recovery can execute another tool. */
    restoreCommitted: commitResults,
    /** Commit the staged knowledge and its reminder together; failures leave both undelivered. */
    async persistReminder(reminder: Extract<TranscriptMessage, { role: "system-reminder" }>) {
      const known = pendingReminders.get(reminder.content);
      const previous = new Map(files);
      for (const [path, { previous: expected, current }] of known ?? []) {
        // A later successful file tool must not be overwritten by an older report.
        if (files.get(path) !== expected) continue;
        if (current) files.set(path, current);
        else files.delete(path);
      }
      try {
        await persist(undefined, reminder);
        pendingReminders.delete(reminder.content);
      } catch (error) {
        files.clear();
        for (const [path, file] of previous) files.set(path, file);
        if (known) {
          requestRemaining += reminder.content.length;
          pendingReminders.delete(reminder.content);
        }
        throw error;
      }
    },
    /** Learn only from native result entries already committed, before the next provider request. */
    commitResults,
    /** Prompt collection and request preparation share a budget until this request is prepared. */
    finishRequest() {
      requestRemaining = 16000;
      pendingReminders.clear();
    },
    /** Prepared paths include hook rewrites; reject stale writes before invoking the file tool. */
    wrapTool<T extends TSchema, D extends JsonValue>(
      tool: ToolRegistration<T, D>,
    ): ToolRegistration<T, D> {
      return {
        ...tool,
        async execute(...args) {
          const params = args[0];
          const path =
            typeof params === "object" &&
            params !== null &&
            "path" in params &&
            typeof params.path === "string"
              ? resolve(cwd, params.path)
              : undefined;
          if (path && (tool.name === "write" || tool.name === "edit")) {
            const previous = files.get(path);
            if (previous) {
              let changed = previous.stale;
              if (!changed) {
                try {
                  // Execution must compare bytes even when metadata did not change.
                  const bytes = await readFile(path);
                  changed = createHash("sha256").update(bytes).digest("hex") !== previous.hash;
                } catch {
                  changed = true;
                }
              }
              if (changed)
                throw new Error(
                  "File has been modified since it was last read. Read it again before editing.",
                );
            }
          }
          const result = await tool.execute(...args);
          if (
            !result.isError &&
            path &&
            (tool.name === "read" || tool.name === "write" || tool.name === "edit")
          ) {
            let current: TrackedFile | undefined;
            try {
              current = await baseline(path);
            } catch {
              // A successful tool result remains successful when its file disappears before tracking.
            }
            if (current) {
              const { path, mtimeMs, size, hash, stale } = current;
              const api = args[1];
              const candidate: Static<typeof candidateSchema> = {
                callId: api.callId,
                toolName: tool.name,
                file: { path, mtimeMs, size, hash, stale },
              };
              await api.commit(
                (tx) =>
                  tx.appendEntry(api.conversationId, {
                    kind: "rukie.file-baseline",
                    data: candidate,
                  }),
                args[2],
              );
              toolCandidates.set(api.callId, { candidate, current });
            }
          }

          return result;
        },
      };
    },
  };
}
