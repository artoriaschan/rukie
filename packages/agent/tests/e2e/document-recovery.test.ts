import { expect, test } from "bun:test";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord";
import {
  createSession as createNativeSession,
  defineDoc,
  ROOT_CONVERSATION_ID,
} from "@earendil-works/pi-durable";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createJsonlStore, createSession, listSessions } from "../../src/index.ts";
import { SessionMetadataDoc } from "../../src/store/index.ts";
import { checkpointState } from "../../src/checkpoint/index.ts";
import { SubagentDirectoryDoc } from "../../src/tools/subagents/state.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

test.each(["checkpoint schema", "checkpoint version", "directory schema", "directory version"])(
  "invalid native %s rejects cold opening and releases ownership for repair",
  async (caseName) => {
    const dirs = await tempDirs();
    const store = createJsonlStore(dirs);
    const directory = caseName.startsWith("directory");
    const token = directory ? SubagentDirectoryDoc : checkpointState.document;
    const valid: JsonValue = directory ? [] : { checkpoints: [] };
    const newer = defineDoc({
      kind: token.definition.kind,
      version: token.definition.version + 1,
      scope: "conversation",
      history: "rewindable",
      fork: directory ? "initial" : "asOf",
      initial: () => ({ value: null as JsonValue }),
    });
    const version = caseName.endsWith("version");
    const expected = version
      ? "has newer version"
      : directory
        ? "Invalid subagent directory"
        : "Invalid checkpoint schema";
    const session = await createSession({
      ...dirs,
      store,
      ...fakeModel([fauxAssistantMessage("saved")]),
    });
    try {
      await session.run("record a real prompt");
      await session.close();
      async function change(repair: boolean) {
        const lease = await store.open({ id: session.id }, BACKGROUND_CONTEXT);
        const native = createNativeSession(lease.storage);
        try {
          if (version) {
            await native.commit(
              (tx) => tx.retireDoc(repair ? newer : token, ROOT_CONVERSATION_ID),
              BACKGROUND_CONTEXT,
            );
          }
          await native.commit(async (tx) => {
            (await tx.doc(version && !repair ? newer : token, ROOT_CONVERSATION_ID)).value = repair
              ? valid
              : "invalid native owner state";
          }, BACKGROUND_CONTEXT);
        } finally {
          await native.close(BACKGROUND_CONTEXT);
          await lease.release();
        }
      }
      await change(false);
      const cold = fakeModel([]);
      // A repeated failure must remain a validation error rather than a leaked host lease.
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(
          createSession({ ...dirs, store, ...cold, resumeId: session.id }),
        ).rejects.toThrow(expected);
      }
      expect(cold.contexts).toEqual([]);
      await change(true);
      const restored = await createSession({ ...dirs, store, ...cold, resumeId: session.id });
      try {
        expect(JSON.stringify(restored.messages)).toContain("record a real prompt");
        expect(restored.checkpoints()).toEqual(directory ? session.checkpoints() : []);
        expect(cold.contexts).toEqual([]);
      } finally {
        await restored.close();
      }
    } finally {
      await session.close();
      await dirs.cleanup();
    }
  },
);

test("a malformed new Session index fails listing and opening without repair, then releases its lease", async () => {
  const dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const session = await createSession({ ...dirs, store, ...fakeModel([]) });
  const rawMetadata = defineDoc<Record<string, JsonValue>>({
    kind: SessionMetadataDoc.definition.kind,
    version: SessionMetadataDoc.definition.version,
    scope: "session",
    initial: () => ({}),
  });
  try {
    await session.rename("Valid index");
    await session.close();
    async function title(value: JsonValue) {
      const lease = await store.open({ id: session.id }, BACKGROUND_CONTEXT);
      const native = createNativeSession(lease.storage);
      try {
        await native.commit(async (tx) => {
          (await tx.doc(rawMetadata)).title = value;
        }, BACKGROUND_CONTEXT);
      } finally {
        await native.close(BACKGROUND_CONTEXT);
        await lease.release();
      }
    }
    await title(42);
    const main = join(store.key(session.id), "main.jsonl");
    const before = await Bun.file(main).bytes();
    await expect(listSessions({ ...dirs, store })).rejects.toThrow("Invalid Session metadata");
    const cold = fakeModel([]);
    await expect(createSession({ ...dirs, store, ...cold, resumeId: session.id })).rejects.toThrow(
      "Invalid Session metadata",
    );
    expect(cold.contexts).toEqual([]);
    expect(await Bun.file(main).bytes()).toEqual(before);
    await title("Repaired index");
    expect(await listSessions({ ...dirs, store })).toMatchObject([
      { id: session.id, title: "Repaired index" },
    ]);
    const restored = await createSession({ ...dirs, store, ...cold, resumeId: session.id });
    await restored.close();
    expect(cold.contexts).toEqual([]);
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});
