import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { createTwoFilesPatch } from "diff";
import type { TSchema } from "typebox";
import type { ReminderSource } from "../reminders/index.ts";

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
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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
export function createFileTracking(cwd: string) {
  const files = new Map<string, TrackedFile>();
  let sequence = 0;
  let requestRemaining = 16000;
  const displayPath = (path: string) => {
    const local = relative(cwd, path);
    return local === ".." || local.startsWith("../") || isAbsolute(local) ? path : local;
  };
  const reminderSource: ReminderSource = {
    source: "file-changes",
    async currentContent() {
      const pending: Array<{
        path: string;
        report: string;
        current?: TrackedFile;
        patch?: string;
      }> = [];
      for (const [path, previous] of files) {
        let metadata: { mtimeMs: number; size: number } | undefined;
        try {
          metadata = await stat(path);
          if (metadata.mtimeMs === previous.mtimeMs && metadata.size === previous.size) continue;
          const current = await baseline(path);
          current.stale = previous.stale;
          if (current.hash === previous.hash) {
            current.content = previous.content;
            files.set(path, current);
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
            pending.push({ path, report: `Deleted: ${displayPath(path)}` });
          } else if (
            !previous.unavailable ||
            (metadata && (metadata.mtimeMs !== previous.mtimeMs || metadata.size !== previous.size))
          ) {
            // No bytes were available to hash. Keep the last hash and any metadata we did observe.
            pending.push({
              path,
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
        }
      }
      if (!pending.length) return undefined;
      const header = `File changes (${sequence + 1}):\nThe following files were modified since you last read or wrote them (by the user, a hook, a command, or another agent):\n\n`;
      const changes: string[] = [];
      const diffs: Array<{ index: number; patch: string; current: TrackedFile }> = [];
      let remaining = requestRemaining - header.length;
      // Only emitted reports advance a baseline; the next request can still detect deferred files.
      for (const { path, report, current, patch } of pending) {
        const cost = report.length + (changes.length ? 2 : 0);
        if (cost > remaining) break;
        remaining -= cost;
        const index = changes.length;
        changes.push(report);
        if (current) {
          files.set(path, current);
          if (patch !== undefined) {
            diffs.push({ index, patch, current });
          } else {
            current.content = undefined;
            current.stale = true;
          }
        } else {
          files.delete(path);
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
      return content;
    },
  };
  return {
    reminderSource,
    /** Prompt collection and request preparation share a budget until this request is prepared. */
    finishRequest() {
      requestRemaining = 16000;
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
            try {
              files.set(path, await baseline(path));
            } catch {
              // A successful tool result remains successful when its file disappears before tracking.
            }
          }
          return result;
        },
      };
    },
  };
}
