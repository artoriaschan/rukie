import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { branchTip, insertEntry, setValue } from "@earendil-works/pi-agent-core/harness/session";
import {
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemMessage,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { createJsonlStore, createSession } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("Session Resume persists an unknown outcome before the next model request without replay or a Checkpoint", async () => {
  dirs = await tempDirs();
  const effect = join(dirs.cwd, "effect.txt");
  await Bun.write(effect, "already happened\n");
  const store = createJsonlStore(dirs);
  const original = await createSession({ ...dirs, ...fakeModel([]), store });
  const metadata = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT))[0]!;
  const stored = await store.open(metadata, BACKGROUND_CONTEXT);
  const branch = (await stored.branch("main", BACKGROUND_CONTEXT))!;
  const call = fauxAssistantMessage(
    fauxToolCall("bash", { command: "printf replay >> effect.txt" }, { id: "lost-bash" }),
    { stopReason: "toolUse" },
  );
  await branch.appendMessage(call, BACKGROUND_CONTEXT);
  await stored.close(BACKGROUND_CONTEXT);
  await original.dispose();

  const fake = fakeModel([
    (context) => {
      const result = context.messages.find(
        (message) => message.role === "toolResult" && message.toolCallId === "lost-bash",
      );
      expect(result).toMatchObject({
        role: "toolResult",
        toolCallId: "lost-bash",
        toolName: "bash",
        isError: false,
        details: { recovery: { type: "unknown-tool-outcome", version: 1 } },
      });
      const text = JSON.stringify(result);
      for (const fact of [
        "unknown",
        "success",
        "failure",
        "not executed",
        "side effects",
        "Verify",
        "retry",
      ])
        expect(text).toContain(fact);
      return fauxAssistantMessage("verify first");
    },
  ]);
  const resumed = await createSession({
    ...dirs,
    ...fake,
    store,
    resumeId: original.id,
    permissionMode: "full-access",
  });
  expect(fake.contexts).toHaveLength(0);
  expect(resumed.checkpoints()).toEqual([]);
  expect(resumed.messages.find((message) => message.role === "assistant")).toEqual(call);
  expect(resumed.messages.filter((message) => message.role === "toolResult")).toHaveLength(1);
  const reopened = await store.open(metadata, BACKGROUND_CONTEXT);
  const persisted = await (await reopened.branch("main", BACKGROUND_CONTEXT))!.findEntries(
    { order: "oldestFirst" },
    BACKGROUND_CONTEXT,
  );
  expect(
    persisted.filter((entry) => entry.type === "message" && entry.message.role === "toolResult"),
  ).toHaveLength(1);
  await reopened.close(BACKGROUND_CONTEXT);
  expect((await resumed.run("check what happened")).text).toBe("verify first");
  expect(await Bun.file(effect).text()).toBe("already happened\n");
  expect(resumed.checkpoints()).toHaveLength(1);
  await resumed.dispose();
});

test("mixed real success, real failure and recovery results survive repeated Session Resume unchanged", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const original = await createSession({ ...dirs, ...fakeModel([]), store });
  const metadata = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT))[0]!;
  const stored = await store.open(metadata, BACKGROUND_CONTEXT);
  const branch = (await stored.branch("main", BACKGROUND_CONTEXT))!;
  await branch.appendMessage(
    fauxAssistantMessage(
      ["success", "failure", "recovered", "missing"].map((id) =>
        fauxToolCall("read", { path: `${id}.txt` }, { id }),
      ),
      { stopReason: "toolUse" },
    ),
    BACKGROUND_CONTEXT,
  );
  const real = [
    {
      role: "toolResult" as const,
      toolCallId: "success",
      toolName: "read",
      content: [{ type: "text" as const, text: "saved output" }],
      isError: false,
      timestamp: 10,
    },
    {
      role: "toolResult" as const,
      toolCallId: "failure",
      toolName: "read",
      content: [{ type: "text" as const, text: "saved failure" }],
      isError: true,
      timestamp: 11,
    },
    {
      role: "toolResult" as const,
      toolCallId: "recovered",
      toolName: "read",
      content: [{ type: "text" as const, text: "previous unknown" }],
      isError: false,
      details: { recovery: { type: "unknown-tool-outcome", version: 1 } },
      timestamp: 12,
    },
  ];
  for (const result of real) await branch.appendMessage(result, BACKGROUND_CONTEXT);
  await stored.close(BACKGROUND_CONTEXT);
  await original.dispose();
  const first = await createSession({ ...dirs, ...fakeModel([]), resumeId: original.id });
  const results = first.messages.filter((message) => message.role === "toolResult");
  // Session.messages adds ephemeral Tool Views; every native result fact stays unchanged.
  const nativeResults = results.map(({ view: _view, ...facts }) => facts);
  expect(nativeResults.slice(0, 3)).toEqual(real);
  for (const [index, result] of results.slice(0, 3).entries())
    expect(result.view).toMatchObject({
      card: "read",
      kind: "read",
      displayKey: "tool.read",
      path: `${real[index]!.toolCallId}.txt`,
      content: real[index]!.content[0]!.text,
    });
  expect(results).toHaveLength(4);
  expect(results.at(-1)).toMatchObject({
    toolCallId: "missing",
    details: { recovery: { type: "unknown-tool-outcome" } },
  });
  const repairedStore = await store.open(metadata, BACKGROUND_CONTEXT);
  const persisted = await (await repairedStore.branch("main", BACKGROUND_CONTEXT))!.findEntries(
    { order: "oldestFirst" },
    BACKGROUND_CONTEXT,
  );
  const persistedResults = persisted.flatMap((entry) =>
    entry.type === "message" && entry.message.role === "toolResult" ? [entry.message] : [],
  );
  expect(persistedResults).toEqual(nativeResults);
  for (const result of persistedResults) expect(Object.hasOwn(result, "view")).toBe(false);
  await repairedStore.close(BACKGROUND_CONTEXT);
  await first.dispose();
  const again = await createSession({ ...dirs, ...fakeModel([]), resumeId: original.id });
  expect(again.messages.filter((message) => message.role === "toolResult")).toEqual(results);
  const finalStore = await store.open(metadata, BACKGROUND_CONTEXT);
  expect(
    await (await finalStore.branch("main", BACKGROUND_CONTEXT))!.findEntries(
      { order: "oldestFirst" },
      BACKGROUND_CONTEXT,
    ),
  ).toEqual(persisted);
  await finalStore.close(BACKGROUND_CONTEXT);
  await again.dispose();
});

test("resuming a parent leaves child Tool calls untouched until send_message resumes the original child", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const first = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Inspect",
        prompt: "child history",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("preserved child answer"),
    fauxAssistantMessage("parent answer"),
  ]);
  first.model.contextWindow = 100000;
  const parent = await createSession({ ...dirs, ...first, store, permissionMode: "full-access" });
  let childId = "";
  await parent.run("delegate", {
    onEvent(event) {
      if (event.type === "subagent_event") childId = event.agentId;
    },
  });
  await parent.dispose();
  const metadata = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT)).find(
    (item) => item.id === childId,
  )!;
  const child = await store.open(metadata, BACKGROUND_CONTEXT);
  const branch = (await child.branch("main", BACKGROUND_CONTEXT))!;
  await branch.appendMessage(
    fauxAssistantMessage(
      fauxToolCall("bash", { command: "printf replay >> effects.txt" }, { id: "lost-child" }),
      { stopReason: "toolUse" },
    ),
    BACKGROUND_CONTEXT,
  );
  const before = await branch.findEntries({ order: "oldestFirst" }, BACKGROUND_CONTEXT);
  await child.close(BACKGROUND_CONTEXT);
  let childRequests = 0;
  const reply = async (context: TranscriptContext) => {
    const isParent = getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
      (tool) => tool.name === "subagent",
    );
    if (isParent) return fauxAssistantMessage("parent continues");
    childRequests++;
    expect(JSON.stringify(context.messages)).toContain("preserved child answer");
    expect(JSON.stringify(context.messages)).toContain("new child instruction");
    expect(
      context.messages.find(
        (message) => message.role === "toolResult" && message.toolCallId === "lost-child",
      ),
    ).toMatchObject({ details: { recovery: { type: "unknown-tool-outcome" } } });
    const reopened = await createJsonlStore(dirs).open(metadata, BACKGROUND_CONTEXT);
    const entries = await (await reopened.branch("main", BACKGROUND_CONTEXT))!.findEntries(
      { order: "oldestFirst" },
      BACKGROUND_CONTEXT,
    );
    expect(
      entries.filter((entry) => entry.type === "message" && entry.message.role === "toolResult"),
    ).toMatchObject([{ message: { toolCallId: "lost-child" } }]);
    await reopened.close(BACKGROUND_CONTEXT);
    return fauxAssistantMessage(
      fauxToolCall("write", { path: "continued.txt", content: "new work" }),
      { stopReason: "toolUse" },
    );
  };
  const finish = (context: TranscriptContext) => {
    if (
      !getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
        (tool) => tool.name === "subagent",
      )
    )
      return fauxAssistantMessage("child continued");
    return fauxAssistantMessage("parent continues");
  };
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("send_message", { agent_id: childId, message: "new child instruction" }),
      { stopReason: "toolUse" },
    ),
    reply,
    reply,
    finish,
    finish,
    finish,
  ]);
  fake.model.contextWindow = 100000;
  const resumed = await createSession({
    ...dirs,
    ...fake,
    store,
    resumeId: parent.id,
    permissionMode: "full-access",
  });
  expect(fake.contexts).toHaveLength(0);
  const untouched = await store.open(metadata, BACKGROUND_CONTEXT);
  expect(
    await (await untouched.branch("main", BACKGROUND_CONTEXT))!.findEntries(
      { order: "oldestFirst" },
      BACKGROUND_CONTEXT,
    ),
  ).toEqual(before);
  await untouched.close(BACKGROUND_CONTEXT);
  const ids: string[] = [];
  expect(
    (
      await resumed.run("continue the original child", {
        onEvent(event) {
          if (event.type === "subagent_event") ids.push(event.agentId);
        },
      })
    ).success,
  ).toBe(true);
  expect(childRequests).toBe(1);
  expect(JSON.stringify(resumed.messages)).toContain("child continued");
  expect(new Set(ids)).toEqual(new Set([childId]));
  expect(await Bun.file(join(dirs.cwd, "effects.txt")).exists()).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "continued.txt")).text()).toBe("new work");
  expect(resumed.checkpoints()).toHaveLength(2);
  expect(resumed.checkpoints().at(-1)!.files).toMatchObject([
    { path: expect.stringContaining("continued.txt"), backup: null },
  ]);
  await resumed.rewind(resumed.checkpoints().at(-1)!.promptEntryId, {
    code: true,
    conversation: false,
  });
  expect(await Bun.file(join(dirs.cwd, "continued.txt")).exists()).toBe(false);
  await resumed.dispose();
});

test("Rewind discards orphan calls and recovery placeholders from the current branch", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const original = await createSession({
    ...dirs,
    ...fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("second")]),
    store,
  });
  await original.run("first prompt");
  await original.run("discard this prompt");
  const anchor = original.checkpoints()[1]!.promptEntryId;
  await original.dispose();
  const metadata = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT))[0]!;
  const stored = await store.open(metadata, BACKGROUND_CONTEXT);
  await (await stored.branch("main", BACKGROUND_CONTEXT))!.appendMessage(
    fauxAssistantMessage(
      fauxToolCall("write", { path: "removed.txt", content: "orphan" }, { id: "discarded" }),
      { stopReason: "toolUse" },
    ),
    BACKGROUND_CONTEXT,
  );
  await stored.close(BACKGROUND_CONTEXT);
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: original.id });
  expect(JSON.stringify(resumed.messages)).toContain("unknown-tool-outcome");
  await resumed.rewind(anchor, { code: false, conversation: true });
  await resumed.dispose();
  const fake = fakeModel([fauxAssistantMessage("new branch answer")]);
  const again = await createSession({ ...dirs, ...fake, resumeId: original.id });
  expect(JSON.stringify(again.messages)).not.toContain("discarded");
  expect(JSON.stringify(again.messages)).not.toContain("unknown-tool-outcome");
  await again.run("new branch prompt");
  expect(JSON.stringify(fake.contexts)).not.toContain("discarded");
  expect(await Bun.file(join(dirs.cwd, "removed.txt")).exists()).toBe(false);
  await again.dispose();
});

test("Compaction retains unknown outcomes without duplicating repair or reviving compacted calls", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const original = await createSession({ ...dirs, ...fakeModel([]), store });
  const metadata = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT))[0]!;
  const stored = await store.open(metadata, BACKGROUND_CONTEXT);
  const branch = (await stored.branch("main", BACKGROUND_CONTEXT))!;
  await branch.appendMessage(
    fauxAssistantMessage(fauxToolCall("bash", { command: "old" }, { id: "compacted-away" }), {
      stopReason: "toolUse",
    }),
    BACKGROUND_CONTEXT,
  );
  const retained = fauxAssistantMessage(
    fauxToolCall("bash", { command: "current" }, { id: "retained" }),
    { stopReason: "toolUse" },
  );
  await branch.appendMessage(retained, BACKGROUND_CONTEXT);
  const id = "compaction-fixture";
  await stored.mutate(async (mutator) => {
    await mutator.commit(
      [
        insertEntry({
          id,
          parentId: (await mutator.getValue(branchTip("main"), BACKGROUND_CONTEXT))?.value ?? null,
          type: "compaction",
          summary: "Prior context summarized",
          retainedTail: [retained],
          tokensBefore: 10000,
          fromHook: false,
        }),
        setValue(branchTip("main"), id),
      ],
      BACKGROUND_CONTEXT,
    );
  }, BACKGROUND_CONTEXT);
  await stored.close(BACKGROUND_CONTEXT);
  await original.dispose();
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: original.id });
  expect(resumed.messages.filter((message) => message.role === "toolResult")).toMatchObject([
    { toolCallId: "retained" },
  ]);
  expect(JSON.stringify(resumed.messages)).not.toContain("compacted-away");
  const repairedStore = await store.open(metadata, BACKGROUND_CONTEXT);
  const persisted = await (await repairedStore.branch("main", BACKGROUND_CONTEXT))!.findEntries(
    { order: "oldestFirst" },
    BACKGROUND_CONTEXT,
  );
  expect(
    persisted.filter((entry) => entry.type === "message" && entry.message.role === "toolResult"),
  ).toMatchObject([
    {
      message: {
        toolCallId: "compacted-away",
        details: { recovery: { type: "unknown-tool-outcome" } },
      },
    },
    {
      message: { toolCallId: "retained", details: { recovery: { type: "unknown-tool-outcome" } } },
    },
  ]);
  await repairedStore.close(BACKGROUND_CONTEXT);
  const repaired = structuredClone(resumed.messages);
  await resumed.dispose();
  const again = await createSession({ ...dirs, ...fakeModel([]), resumeId: original.id });
  expect(again.messages).toEqual(repaired);
  const finalStore = await store.open(metadata, BACKGROUND_CONTEXT);
  expect(
    await (await finalStore.branch("main", BACKGROUND_CONTEXT))!.findEntries(
      { order: "oldestFirst" },
      BACKGROUND_CONTEXT,
    ),
  ).toEqual(persisted);
  await finalStore.close(BACKGROUND_CONTEXT);
  await again.dispose();
  const fake = fakeModel([
    (context) => {
      expect(JSON.stringify(context.messages)).not.toContain("compacted-away");
      expect(context.messages.filter((message) => message.role === "toolResult")).toMatchObject([
        { toolCallId: "retained", details: { recovery: { type: "unknown-tool-outcome" } } },
      ]);
      return fauxAssistantMessage("verify retained call");
    },
  ]);
  const continuing = await createSession({ ...dirs, ...fake, resumeId: original.id });
  expect((await continuing.run("check current state")).text).toBe("verify retained call");
  await continuing.dispose();
});
