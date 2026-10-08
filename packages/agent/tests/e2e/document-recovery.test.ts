import { expect, test } from "bun:test";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { copyJson, type JsonValue } from "@earendil-works/chord";
import {
  createSession as createNativeSession,
  defineDoc,
  ROOT_CONVERSATION_ID,
} from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
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

const sessionDocumentCases: {
  kind: string;
  valid: Record<string, JsonValue>;
  bad: Record<string, JsonValue>;
  scope?: "session";
  history?: "latest" | "rewindable";
  fork?: "asOf";
}[] = [
  {
    kind: "rukie.hook-continuation",
    valid: { taskId: null, count: 0 },
    bad: { taskId: null, count: "eight" },
    history: "latest",
  },
  {
    kind: "rukie.child-facts",
    valid: { title: "", description: "" },
    bad: { title: 42, description: "" },
    history: "latest",
  },
  {
    kind: "rukie.requests",
    valid: { requests: {} },
    bad: {
      requests: { "human:bad": { submissions: [], tasks: "invalid", startedAt: 0, result: null } },
    },
    scope: "session",
  },
  {
    kind: "rukie.compact-hook-context",
    valid: { pending: [], afterEntry: null },
    bad: { pending: [42], afterEntry: null },
    history: "rewindable",
    fork: "asOf",
  },
  {
    kind: "rukie.hook-yield",
    valid: { runAnchor: null, pending: [] },
    bad: { runAnchor: null, pending: "invalid" },
    history: "rewindable",
  },
  {
    kind: "rukie.job-stops",
    valid: { pending: {} },
    bad: { pending: { job: false } },
    history: "rewindable",
  },
  {
    kind: "rukie.plan-takeovers",
    valid: { requests: {} },
    bad: { requests: { request: false } },
    scope: "session",
  },
  {
    kind: "rukie.hook-stops",
    valid: { requests: {} },
    bad: { requests: { request: 42 } },
    scope: "session",
  },
  {
    kind: "rukie.pending-input-facts",
    valid: { inputs: {} },
    bad: { inputs: { request: [] } },
    history: "latest",
  },
  {
    kind: "rukie.child-hook-context",
    valid: { pending: [] },
    bad: { pending: [{ source: "hook", content: 42 }] },
    history: "rewindable",
  },
];

test.each(sessionDocumentCases)(
  "malformed same-version $kind rejects before startup effects and preserves its native identity",
  async (definition) => {
    const dirs = await tempDirs();
    const store = createJsonlStore(dirs);
    const session = await createSession({
      ...dirs,
      store,
      ...fakeModel([fauxAssistantMessage("saved")]),
    });
    try {
      await session.run("stable accepted request");
      await session.close();
      const sessionToken = defineDoc<Record<string, JsonValue>>({
        kind: definition.kind,
        version: 1,
        scope: "session",
        initial: () => definition.valid,
      });
      const conversationToken =
        definition.history === "latest"
          ? defineDoc<Record<string, JsonValue>>({
              kind: definition.kind,
              version: 1,
              scope: "conversation",
              history: "latest",
              fork: "initial",
              initial: () => definition.valid,
            })
          : defineDoc<Record<string, JsonValue>>({
              kind: definition.kind,
              version: 1,
              scope: "conversation",
              history: "rewindable",
              fork: definition.fork ?? "initial",
              initial: () => definition.valid,
            });
      let saved: Record<string, JsonValue> = definition.valid;
      let documentId = 0;
      async function change(repair: boolean) {
        const lease = await store.open({ id: session.id }, BACKGROUND_CONTEXT);
        const native = createNativeSession(lease.storage);
        try {
          await native.commit(async (tx) => {
            const value =
              definition.scope === "session"
                ? await tx.doc(sessionToken)
                : await tx.doc(conversationToken, ROOT_CONVERSATION_ID);
            if (!repair) {
              const cloned = copyJson(value);
              if (!cloned || typeof cloned !== "object" || Array.isArray(cloned))
                throw new Error("Expected native document object");
              saved = cloned;
            }
            for (const key of Object.keys(value)) delete value[key];
            Object.assign(value, repair ? saved : definition.bad);
          }, BACKGROUND_CONTEXT);
          const records = await lease.storage.scanDocuments(
            {
              scope:
                definition.scope === "session"
                  ? { kind: "session" }
                  : { kind: "conversation", conversationId: ROOT_CONVERSATION_ID },
              at: "current",
              kind: definition.kind,
            },
            1,
            undefined,
            BACKGROUND_CONTEXT,
          );
          if (!repair) documentId = Number(records.items[0]!.id);
          else expect(Number(records.items[0]!.id)).toBe(documentId);
        } finally {
          await native.close(BACKGROUND_CONTEXT);
          await lease.release();
        }
      }
      await change(false);
      const main = join(store.key(session.id), "main.jsonl");
      const before = await Bun.file(main).bytes();
      const cold = fakeModel([fauxAssistantMessage("valid resumed reply")]);
      for (let attempt = 0; attempt < 2; attempt++)
        await expect(
          createSession({
            ...dirs,
            store,
            ...cold,
            resumeId: session.id,
            settings: {
              hooks: {
                SessionStart: [{ hooks: [{ type: "command", command: "touch startup-effect" }] }],
              },
            },
          }),
        ).rejects.toThrow(`Invalid Session document ${definition.kind}`);
      expect(cold.contexts).toEqual([]);
      expect(await Bun.file(join(dirs.cwd, "startup-effect")).exists()).toBe(false);
      expect(await Bun.file(main).bytes()).toEqual(before);
      await change(true);
      const restored = await createSession({ ...dirs, store, ...cold, resumeId: session.id });
      try {
        expect(restored.id).toBe(session.id);
        expect(JSON.stringify(restored.messages)).toContain("stable accepted request");
        expect((await restored.run("valid next request")).text).toBe("valid resumed reply");
      } finally {
        await restored.close();
      }
    } finally {
      await session.close();
      await dirs.cleanup();
    }
  },
);

test("malformed Session-owned child facts reject before root recovery or Hook side effects", async () => {
  const dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const session = await createSession({
    ...dirs,
    store,
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Child",
          prompt: "child",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("child saved"),
      fauxAssistantMessage("parent saved"),
    ]),
  });
  try {
    await session.run("delegate");
    await session.close();
    const lease = await store.open({ id: session.id }, BACKGROUND_CONTEXT);
    const native = createNativeSession(lease.storage);
    try {
      const child = (
        await lease.storage.scanConversations({}, 20, undefined, BACKGROUND_CONTEXT)
      ).items.find((row) => row.id !== ROOT_CONVERSATION_ID)!;
      const raw = defineDoc<Record<string, JsonValue>>({
        kind: "rukie.child-hook-context",
        version: 1,
        scope: "conversation",
        history: "rewindable",
        fork: "initial",
        initial: () => ({}),
      });
      await native.commit(async (tx) => {
        (await tx.doc(raw, child.id)).pending = [{ source: "hook", content: false }];
      }, BACKGROUND_CONTEXT);
    } finally {
      await native.close(BACKGROUND_CONTEXT);
      await lease.release();
    }
    const cold = fakeModel([]);
    await expect(createSession({ ...dirs, store, ...cold, resumeId: session.id })).rejects.toThrow(
      "Invalid Session document rukie.child-hook-context",
    );
    expect(cold.contexts).toEqual([]);
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

test("native child fork rejects malformed asOf Session facts even when current contents were repaired", async () => {
  const dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const initial = await createSession({
    ...dirs,
    store,
    ...fakeModel([fauxAssistantMessage("prior answer")]),
  });
  try {
    await initial.run("prior prompt");
    await initial.close();
    const lease = await store.open({ id: initial.id }, BACKGROUND_CONTEXT);
    const native = createNativeSession(lease.storage);
    const raw = defineDoc<Record<string, JsonValue>>({
      kind: "rukie.compact-hook-context",
      version: 1,
      scope: "conversation",
      history: "rewindable",
      fork: "asOf",
      initial: () => ({}),
    });
    try {
      await native.commit(async (tx) => {
        const value = await tx.doc(raw, ROOT_CONVERSATION_ID);
        value.pending = [42];
        value.afterEntry = null;
        await tx.appendEntry(ROOT_CONVERSATION_ID, {
          kind: "pi.assistant",
          data: {},
          model: [fauxAssistantMessage("historical fork anchor")],
        });
      }, BACKGROUND_CONTEXT);
      await native.commit(async (tx) => {
        (await tx.doc(raw, ROOT_CONVERSATION_ID)).pending = [];
      }, BACKGROUND_CONTEXT);
    } finally {
      await native.close(BACKGROUND_CONTEXT);
      await lease.release();
    }
    const model = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent_fork", {
          description: "Invalid fork",
          prompt: "child must not run",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("fork rejected"),
    ]);
    const resumed = await createSession({ ...dirs, store, ...model, resumeId: initial.id });
    try {
      await expect(resumed.run("fork at historical anchor")).rejects.toThrow(
        "Invalid Session document rukie.compact-hook-context",
      );
      expect(resumed.toolState("subagents")).toBeUndefined();
      expect(model.contexts).toHaveLength(1);
    } finally {
      await resumed.close();
    }
    const inspection = await store.open({ id: initial.id }, BACKGROUND_CONTEXT);
    try {
      expect(
        (await inspection.storage.scanConversations({}, 20, undefined, BACKGROUND_CONTEXT)).items,
      ).toHaveLength(1);
    } finally {
      await inspection.storage.close(BACKGROUND_CONTEXT);
      await inspection.release();
    }
  } finally {
    await initial.close();
    await dirs.cleanup();
  }
});
