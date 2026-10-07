import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { EntryRecord } from "@earendil-works/pi-durable";
import type { createHooks } from "./index.ts";

/** Replace a derived conversation export without exposing a partially written file. */
export async function writeHookTranscript(target: string, transcript: readonly EntryRecord[]) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, transcript.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  await rename(temporary, target);
}

/** Hook files are derived conversation exports; native JSONL remains the recovery authority. */
export function withHookTranscript(
  owner: ReturnType<typeof createHooks>,
  path: () => string,
  entries: () => Promise<readonly EntryRecord[]>,
  enabled: boolean,
  available: () => boolean,
): ReturnType<typeof createHooks> {
  if (!enabled) return owner;
  return {
    ...owner,
    async run(...args) {
      if (args[0] === "SessionEnd" || available())
        await writeHookTranscript(path(), await entries());
      const result = await owner.run(...args);
      if (args[0] === "SessionEnd" || available())
        await writeHookTranscript(path(), await entries());
      return result;
    },
  };
}
