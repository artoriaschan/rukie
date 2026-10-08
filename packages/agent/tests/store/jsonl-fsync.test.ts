import { expect, test } from "bun:test";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSession as createNativeSession, defineDoc } from "@earendil-works/pi-durable";
import { JsonlStorage } from "@earendil-works/pi-durable/storage/jsonl";
import { err, FileError } from "@earendil-works/pi-durable/env";
import { CommittedFiles } from "../../src/store/files.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

test("native JSONL flushes sidecars and its commit marker before acknowledging, and rejects a failed marker flush", async () => {
  const dirs = await tempDirs();
  const operations: string[] = [];
  let rejectMain = false;
  const directory = join(dirs.homeDir, "native-storage");
  const main = join(directory, "main.jsonl");
  class ObservedFiles extends CommittedFiles {
    override async flushFile(...args: Parameters<CommittedFiles["flushFile"]>) {
      operations.push(args[0]);
      if (rejectMain && args[0] === main)
        return err<void, FileError>(new FileError("permission_denied", "Marker flush rejected"));
      return super.flushFile(...args);
    }
  }
  const files = new ObservedFiles({ cwd: dirs.cwd });
  const doc = defineDoc<{ value: string }>({
    kind: "fixture.flush",
    version: 1,
    scope: "session",
    initial: () => ({ value: "" }),
  });
  let native;
  try {
    const storage = await JsonlStorage.open(directory, files, BACKGROUND_CONTEXT, { fsync: true });
    native = createNativeSession(storage);
    operations.length = 0;
    await native.commit(async (tx) => {
      (await tx.doc(doc)).value = "acknowledged";
    }, BACKGROUND_CONTEXT);
    expect(operations.some((path) => path !== main)).toBe(true);
    expect(operations.at(-1)).toBe(main);
    expect(await native.snapshot(doc, BACKGROUND_CONTEXT)).toEqual({ value: "acknowledged" });

    rejectMain = true;
    await expect(
      native.commit(async (tx) => {
        (await tx.doc(doc)).value = "unacknowledged";
      }, BACKGROUND_CONTEXT),
    ).rejects.toThrow("JSONL storage is poisoned and must be reopened");
    expect(operations.at(-1)).toBe(main);
    await expect(native.snapshot(doc, BACKGROUND_CONTEXT)).rejects.toThrow("Session is poisoned");
    // Append precedes flush: rejection must not be mistaken for rollback of disk bytes.
    expect(await Bun.file(main).text()).toContain("fixture.flush");
    await native.close(BACKGROUND_CONTEXT);
    rejectMain = false;
    native = createNativeSession(
      await JsonlStorage.open(directory, files, BACKGROUND_CONTEXT, { fsync: true }),
    );
    // This fixture completed its append before rejecting flush: cold storage recovers that valid marker.
    expect(await native.snapshot(doc, BACKGROUND_CONTEXT)).toEqual({ value: "unacknowledged" });
  } finally {
    await native?.close(BACKGROUND_CONTEXT);
    await files.cleanup(BACKGROUND_CONTEXT);
    await dirs.cleanup();
  }
});
