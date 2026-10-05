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
  content: string;
}

async function baseline(path: string): Promise<TrackedFile> {
  const metadata = await stat(path);
  const bytes = await readFile(path);
  return {
    path,
    mtimeMs: metadata.mtimeMs,
    size: metadata.size,
    hash: createHash("sha256").update(bytes).digest("hex"),
    content: bytes.toString("utf8"),
  };
}

/** Each Session owns the last file contents its model learned through file tools or diffs. */
export function createFileTracking(cwd: string) {
  const files = new Map<string, TrackedFile>();
  let sequence = 0;
  const displayPath = (path: string) => {
    const local = relative(cwd, path);
    return local === ".." || local.startsWith("../") || isAbsolute(local) ? path : local;
  };
  const reminderSource: ReminderSource = {
    source: "file-changes",
    async currentContent() {
      const changes: string[] = [];
      for (const [path, previous] of files) {
        try {
          const metadata = await stat(path);
          if (metadata.mtimeMs === previous.mtimeMs && metadata.size === previous.size) continue;
          const current = await baseline(path);
          files.set(path, current);
          if (current.hash === previous.hash) continue;
          const shown = displayPath(path);
          changes.push(
            createTwoFilesPatch(shown, shown, previous.content, current.content, "", "", {
              context: 3,
            }),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            files.delete(path);
            changes.push(`Deleted: ${displayPath(path)}`);
          }
        }
      }
      if (!changes.length) return undefined;
      // Event reminders can repeat the same diff after another successful file tool operation.
      return `File changes (${++sequence}):\nThe following files were modified since you last read or wrote them (by the user, a hook, a command, or another agent):\n\n${changes.join("\n\n")}`;
    },
  };
  return {
    reminderSource,
    wrapTool<T extends TSchema, D>(tool: AgentTool<T, D>): AgentTool<T, D> {
      return {
        ...tool,
        async execute(...args) {
          const result = await tool.execute(...args);
          const params = args[1];
          if (
            !result.isError &&
            typeof params === "object" &&
            params !== null &&
            "path" in params &&
            typeof params.path === "string"
          ) {
            const path = resolve(cwd, params.path);
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
