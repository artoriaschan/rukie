import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { defineToolState, type ToolStateDefinition } from "../tool-state/index.ts";
import { resolvePermissionPath, type OnToolCallAllowed } from "../permissions/index.ts";

export { cleanupExpiredBackups } from "./cleanup.ts";

const checkpointSchema = Type.Object(
  {
    checkpoints: Type.Array(
      Type.Object(
        {
          promptEntryId: Type.String(),
          files: Type.Array(
            Type.Object(
              { path: Type.String(), backup: Type.Union([Type.String(), Type.Null()]) },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
type CheckpointState = Static<typeof checkpointSchema>;

export interface Checkpoint {
  promptEntryId: string;
  preview: string;
  files: Array<{ path: string; backup: string | null }>;
}

export interface RewindResult {
  prompt: string;
  restored: string[];
  deleted: string[];
}

export const checkpointState: ToolStateDefinition = defineToolState({
  history: "rewindable",
  fork: "asOf",
  name: "checkpoint",
  version: 1,
  parse(version, value) {
    if (version !== 1) throw new Error(`Unsupported checkpoint version: ${version}`);
    if (!Value.Check(checkpointSchema, value)) throw new Error("Invalid checkpoint schema.");
    return value;
  },
});

export function createCheckpoints({
  homeDir,
  sessionId,
  getState,
  persist,
  getPrompt,
}: {
  homeDir: string;
  sessionId: string;
  getState(): unknown;
  persist(state: CheckpointState): Promise<void>;
  getPrompt(promptEntryId: string): string | undefined;
}) {
  let writes = Promise.resolve();
  const state = (): CheckpointState =>
    structuredClone((getState() as CheckpointState | undefined) ?? { checkpoints: [] });
  const enqueue = (write: () => Promise<void>) => {
    const pending = writes.then(write);
    writes = pending.catch(() => {});
    return pending;
  };
  return {
    start(promptEntryId: string) {
      return enqueue(async () => {
        const next = state();
        next.checkpoints.push({ promptEntryId, files: [] });
        await persist(next);
      });
    },
    record(call: Parameters<OnToolCallAllowed>[0], cwd: string, toolHomeDir: string) {
      if (call.toolName !== "write" && call.toolName !== "edit") return Promise.resolve();
      const path = resolvePermissionPath({ ...call, cwd, homeDir: toolHomeDir })?.realPath;
      if (!path) return Promise.resolve();
      return enqueue(async () => {
        const next = state();
        const current = next.checkpoints.at(-1);
        if (!current || current.files.some((file) => file.path === path)) return;
        let backup: string | null = null;
        let bytes: Buffer | undefined;
        try {
          bytes = await readFile(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (bytes !== undefined) {
          const hash = createHash("sha256").update(bytes).digest("hex");
          backup = join(homeDir, ".rukie", "file-history", sessionId, hash);
          if (!(await Bun.file(backup).exists())) await Bun.write(backup, bytes);
        }
        current.files.push({ path, backup });
        await persist(next);
      });
    },
    list(): Checkpoint[] {
      return state().checkpoints.map((checkpoint) => {
        const text = (getPrompt(checkpoint.promptEntryId) ?? "").replace(/\s+/g, " ").trim();
        const chars = Array.from(text);
        return {
          ...checkpoint,
          preview: chars.length > 80 ? `${chars.slice(0, 80).join("")}…` : text,
        };
      });
    },
    prompt(promptEntryId: string): string {
      const prompt = getPrompt(promptEntryId);
      if (
        !state().checkpoints.some((checkpoint) => checkpoint.promptEntryId === promptEntryId) ||
        prompt === undefined
      )
        throw new Error(`Checkpoint not found: ${promptEntryId}`);
      return prompt;
    },
    async restoreCode(promptEntryId: string): Promise<Pick<RewindResult, "restored" | "deleted">> {
      await writes;
      const checkpoints = state().checkpoints;
      const index = checkpoints.findIndex(
        (checkpoint) => checkpoint.promptEntryId === promptEntryId,
      );
      if (index < 0) throw new Error(`Checkpoint not found: ${promptEntryId}`);
      const files = new Map<string, string | null>();
      for (const checkpoint of checkpoints.slice(index))
        for (const file of checkpoint.files)
          if (!files.has(file.path)) files.set(file.path, file.backup);
      // Read every backup before touching any project file. Missing history is
      // a failure of the entire restore, even when an earlier path could succeed.
      const prepared = await Promise.all(
        [...files].map(async ([path, backup]) => {
          if (backup === null) return { path, bytes: null };
          try {
            return { path, bytes: await readFile(backup) };
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              throw new Error(`Checkpoint backup missing: ${backup}`);
            throw error;
          }
        }),
      );
      const restored: string[] = [];
      const deleted: string[] = [];
      for (const { path, bytes } of prepared) {
        if (bytes === null) {
          await rm(path, { force: true });
          deleted.push(path);
        } else {
          await Bun.write(path, bytes);
          restored.push(path);
        }
      }
      return { restored, deleted };
    },
  };
}
