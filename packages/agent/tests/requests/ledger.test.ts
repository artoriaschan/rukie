import { readGoalReceipt } from "../../src/tools/goal/index.ts";
import { readSubagentReceipt } from "../../src/tools/subagents/index.ts";
import { expect, test } from "bun:test";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  defineTask,
  hook,
  GenerationTask,
} from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRequestLedger } from "../../src/requests/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";

test("Ledger binds and settles one accepted Request once for concurrent waiters", async () => {
  const fake = fakeModel([fauxAssistantMessage("answer")]);
  const storage = new MemoryStorage();
  const harness = await Harness.open(
    storage,
    { models: fake.models, registry: createRegistry() },
    BACKGROUND_CONTEXT,
  );
  const conversation = await harness.root(BACKGROUND_CONTEXT, {
    agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
  });
  const events: string[] = [];
  const ledger = createRequestLedger({
    harness,
    storage,
    context: BACKGROUND_CONTEXT,
    conversation: () => conversation,
    history: async () => [...(await conversation.context(BACKGROUND_CONTEXT)).entries],
    flush: async () => {},
    updateContext: () => {},
    goalReceipt: readGoalReceipt,
    subagentReceipt: readSubagentReceipt,
    fault: new Promise<never>(() => {}),
    assertAvailable: () => {},
    publish: (result) => {
      events.push(result.text);
    },
  });
  try {
    const input = await conversation.submit(
      { type: "input", content: "question", requestId: "human:h" },
      BACKGROUND_CONTEXT,
    );
    await ledger.registerSubmission("human:h", input.id);
    const first = ledger.waitForRequest("human:h");
    expect(ledger.waitForRequest("human:h")).toBe(first);
    expect(await first).toMatchObject({ requestId: "human:h", text: "answer", success: true });
    expect(events).toEqual(["answer"]);
    expect(await ledger.waitForRequest("human:h")).toMatchObject({ text: "answer" });
    await harness.commit((tx) => ledger.bind(tx, "human:h", { taskId: 12 }), BACKGROUND_CONTEXT);
    expect((await ledger.readRequest("human:h"))?.tasks).toEqual([12]);
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
});

test("Goal activation settlement unions linked rounds without duplicating provider usage", async () => {
  const fake = fakeModel([
    fauxAssistantMessage("human"),
    fauxAssistantMessage("first round"),
    fauxAssistantMessage("last round"),
  ]);
  const storage = new MemoryStorage();
  const registry = createRegistry();
  let ledger: ReturnType<typeof createRequestLedger>;
  let conversation: Awaited<ReturnType<Harness["root"]>>;
  const driver = defineTask<
    { requestId: string },
    { phase: "run" },
    {
      text: string;
      success: boolean;
      durationMs: number;
      usage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        totalTokens: number;
      };
    }
  >({
    name: "rukie.goal-driver",
    version: 1,
    abort: async () => {},
    initial: () => ({ phase: "run" }),
    phases: {
      run: async (task, runtime, ctx) => {
        for (const round of [1, 2]) {
          const id = `goal:g:activation:a:round:${task.id}:${round}`;
          const submission = await conversation.submit(
            { type: "input", content: "round", requestId: id },
            ctx,
          );
          await ledger.registerSubmission(id, submission.id);
          await ledger.waitForRequest(id);
        }
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: {
              status: "completed",
              result: {
                text: "last round",
                success: true,
                durationMs: 2,
                usage: { input: 10, output: 16, cacheRead: 0, cacheWrite: 0, totalTokens: 26 },
              },
            },
          }),
          ctx,
        );
      },
    },
  });
  registry.install({ name: "goal", tasks: [driver] });
  const harness = await Harness.open(
    storage,
    { models: fake.models, registry },
    BACKGROUND_CONTEXT,
  );
  conversation = await harness.root(BACKGROUND_CONTEXT, {
    agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
  });
  const events: string[] = [];
  ledger = createRequestLedger({
    harness,
    storage,
    context: BACKGROUND_CONTEXT,
    conversation: () => conversation,
    history: async () => [...(await conversation.context(BACKGROUND_CONTEXT)).entries],
    flush: async () => {},
    updateContext: () => {},
    fault: new Promise<never>(() => {}),
    assertAvailable: () => {},
    publish: (r) => {
      events.push(r.requestId);
    },
    goalReceipt: readGoalReceipt,
    subagentReceipt: readSubagentReceipt,
  });
  try {
    const human = await conversation.submit(
      { type: "input", content: "activate goal", requestId: "human:h" },
      BACKGROUND_CONTEXT,
    );
    await ledger.registerSubmission("human:h", human.id);
    await human.wait(BACKGROUND_CONTEXT);
    await harness.commit(async (tx) => {
      const id = await tx.createTask(
        driver,
        { requestId: "goal:g:activation:a" },
        { ownership: { kind: "conversation" }, conversationId: conversation.id },
      );
      await ledger.bind(tx, "goal:g:activation:a", { taskId: Number(id) });
      await ledger.bind(tx, "human:h", { taskId: Number(id) });
    }, BACKGROUND_CONTEXT);
    const result = await ledger.waitForRequest("goal:g:activation:a");
    expect(result).toMatchObject({
      text: "last round",
      success: true,
      usage: { input: 10, output: 16, cacheRead: 0, cacheWrite: 0, totalTokens: 26 },
    });
    expect(events).toEqual(["goal:g:activation:a"]);
    // The native faux transcript spends 68 tokens; the task receipt's 26-token fixture
    // is not an independent bucket when the Human Request already includes its round entries.
    expect(await ledger.waitForRequest("human:h")).toMatchObject({
      text: "last round",
      success: true,
      usage: { input: 21, output: 8, cacheRead: 17, cacheWrite: 22, totalTokens: 68 },
    });
    expect(fake.contexts).toHaveLength(3);
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
});

test("causal ownership includes native send inputs and recovery prefers their active Human Request", async () => {
  const fake = fakeModel([]);
  const storage = new MemoryStorage();
  const registry = createRegistry();
  const driver = defineTask<{ originToolTaskId?: number }, { phase: "finish" }, null>({
    name: "rukie.subagent-driver",
    version: 1,
    abort: async () => {},
    initial: () => ({ phase: "finish" }),
    phases: {
      finish: async (_task, runtime, ctx) => {
        await runtime.commit(
          () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
          ctx,
        );
      },
    },
  });
  registry.install({ name: "drivers", tasks: [driver] });
  const harness = await Harness.open(
    storage,
    { models: fake.models, registry },
    BACKGROUND_CONTEXT,
  );
  const conversation = await harness.root(BACKGROUND_CONTEXT);
  const ledger = createRequestLedger({
    harness,
    storage,
    context: BACKGROUND_CONTEXT,
    conversation: () => conversation,
    history: async () => [],
    flush: async () => {},
    updateContext: () => {},
    fault: new Promise<never>(() => {}),
    assertAvailable: () => {},
    publish: () => {},
    goalReceipt: readGoalReceipt,
    subagentReceipt: readSubagentReceipt,
  });
  try {
    const id = await harness.commit(async (tx) => {
      const origin = await tx.createTask(
        driver,
        {},
        { ownership: { kind: "conversation" }, conversationId: conversation.id },
      );
      const send = await tx.createTask(
        driver,
        {},
        { ownership: { kind: "conversation" }, conversationId: conversation.id },
      );
      const child = await tx.createTask(
        driver,
        { originToolTaskId: Number(origin) },
        { ownership: { kind: "conversation" }, conversationId: conversation.id },
      );
      const childConversation = await tx.createConversation({
        ownership: { kind: "task", taskId: child },
      });
      await tx.createSubmission({
        type: "input",
        status: "queued",
        conversationId: childConversation.id,
        requestId: `subagent-send:${send}`,
      });
      await ledger.bind(tx, "human:origin", { taskId: Number(origin) });
      await ledger.bind(tx, "human:send", { taskId: Number(send) });
      return child;
    }, BACKGROUND_CONTEXT);
    const tasks = (await storage.scanTasks({}, 100, undefined, BACKGROUND_CONTEXT)).items;
    const child = tasks.find((task) => task.id === id)!;
    const causes = await ledger.requestCausesForTasks(tasks);
    expect([...causes(child)].sort()).toEqual(["human:origin", "human:send"]);
    const recovery = await harness.inspect(BACKGROUND_CONTEXT);
    await ledger.recover(recovery, Number(id), "goal:g:activation:a");
    expect(ledger.currentRequestId).toBe("goal:g:activation:a");
    await harness.commit(
      (tx) => ledger.bind(tx, "human:send", { taskId: Number(id) }),
      BACKGROUND_CONTEXT,
    );
    await ledger.recover(recovery, Number(id), "goal:g:activation:a");
    expect(ledger.currentRequestId).toBe("human:send");
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
});

test.each(["hook-stop", "plan-takeover"] as const)(
  "Ledger records %s with the caller's notice transaction",
  async (kind) => {
    const fake = fakeModel([fauxAssistantMessage("visible answer")]);
    const storage = new MemoryStorage();
    const registry = createRegistry();
    let ledger: ReturnType<typeof createRequestLedger>;
    let conversation: Awaited<ReturnType<Harness["root"]>>;
    registry.install({
      name: "outcome",
      hooks: [
        hook(GenerationTask, {
          beforeRequest: async (_request, _api, ctx) => {
            await conversation.commit(async (tx) => {
              await ledger.recordOutcome(
                tx,
                conversation.id,
                kind === "hook-stop" ? { kind, reason: "Stopped deliberately" } : { kind },
                ctx,
              );
              await tx.appendEntry(conversation.id, {
                kind: "rukie.notice",
                data: { reason: "Stopped deliberately" },
              });
            }, ctx);
          },
        }),
      ],
    });
    const harness = await Harness.open(
      storage,
      { models: fake.models, registry },
      BACKGROUND_CONTEXT,
    );
    conversation = await harness.root(BACKGROUND_CONTEXT, {
      agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
    });
    ledger = createRequestLedger({
      harness,
      storage,
      context: BACKGROUND_CONTEXT,
      conversation: () => conversation,
      history: async () => [...(await conversation.context(BACKGROUND_CONTEXT)).entries],
      flush: async () => {},
      updateContext: () => {},
      fault: new Promise<never>(() => {}),
      assertAvailable: () => {},
      publish: () => {},
      goalReceipt: readGoalReceipt,
      subagentReceipt: readSubagentReceipt,
    });
    try {
      const input = await conversation.submit(
        { type: "input", content: "question", requestId: "human:stop" },
        BACKGROUND_CONTEXT,
      );
      await ledger.registerSubmission("human:stop", input.id);
      const result = await ledger.waitForRequest("human:stop");
      expect(result).toMatchObject(
        kind === "hook-stop"
          ? {
              text: "visible answer",
              success: true,
              stopReason: "hook_stopped",
              reason: "Stopped deliberately",
            }
          : { text: "", success: true },
      );
      expect(
        (await conversation.context(BACKGROUND_CONTEXT)).entries.filter(
          (entry) => entry.kind === "rukie.notice",
        ),
      ).toHaveLength(1);
    } finally {
      await harness.close(BACKGROUND_CONTEXT);
    }
  },
);
