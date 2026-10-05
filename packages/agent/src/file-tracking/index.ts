import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { createTwoFilesPatch } from "diff";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { ReminderSource } from "../reminders/index.ts";
import type { ToolStateDefinition } from "../tool-state/index.ts";

const trackingSchema = Type.Object(
  {
    files: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1 }),
          mtimeMs: Type.Number(),
          size: Type.Integer({ minimum: 0 }),
          hash: Type.String({ pattern: "^[a-fA-F0-9]{64}$" }),
          stale: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
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

export const fileTrackingState: ToolStateDefinition = {
  name: "file-tracking",
  version: 1,
  parse(version, value) {
    if (version !== 1) throw new Error(`Unsupported file-tracking version: ${version}`);
    if (!validSnapshot(value)) throw new Error("Invalid file-tracking schema.");
    return value;
  },
};

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
      reminder?: Extract<AgentMessage, { role: "system-reminder" }>,
    ) => Promise<void>;
  },
) {
  const files = new Map<string, TrackedFile>();
  const pendingReminders = new Map<
    string,
    Map<string, { previous: TrackedFile; current?: TrackedFile }>
  >();
  let requestRemaining = 16000;
  const restore = (snapshot: unknown) => {
    const previous = new Map(files);
    files.clear();
    pendingReminders.clear();
    requestRemaining = 16000;
    if (!validSnapshot(snapshot)) return;
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
    reminder?: Extract<AgentMessage, { role: "system-reminder" }>,
  ) =>
    options.persist(
      {
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
  return {
    reminderSource,
    /** Replace a Tool State projection; retain bytes only when their hash still matches. */
    restore,
    /** Commit the staged knowledge and its reminder together; failures leave both undelivered. */
    async persistReminder(reminder: Extract<AgentMessage, { role: "system-reminder" }>) {
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
    /** Prompt collection and request preparation share a budget until this request is prepared. */
    finishRequest() {
      requestRemaining = 16000;
      pendingReminders.clear();
    },
    /** Prepared paths include hook rewrites; reject stale writes before invoking the file tool. */
    wrapTool<T extends TSchema, D>(tool: AgentTool<T, D>): AgentTool<T, D> {
      return {
        ...tool,
        async execute(...args) {
          const params = args[1];
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
          if (!result.isError && path) {
            let current: TrackedFile | undefined;
            try {
              current = await baseline(path);
            } catch {
              // A successful tool result remains successful when its file disappears before tracking.
            }
            if (current) {
              const previous = files.get(path);
              files.set(path, current);
              try {
                await persist();
              } catch (error) {
                // Failed knowledge persistence cannot grant permission to overwrite unknown bytes.
                files.set(path, previous ?? { ...current, content: undefined, stale: true });
                throw error;
              }
            }
          }
          return result;
        },
      };
    },
  };
}
