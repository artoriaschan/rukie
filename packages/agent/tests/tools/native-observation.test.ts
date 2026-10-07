import { createJsonlStore } from "../../src/store/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  defineDoc,
  hook,
  CompactionTask,
  GenerationTask,
  type Conversation,
} from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { createConversationObservation } from "../../src/session/observation.ts";
import type { TranscriptMessage } from "../../src/session/messages.ts";
import type { SessionEvent } from "../../src/session/events.ts";
import type { PresentedTool } from "../../src/tools/presentation.ts";
import { withModelAlias } from "../helpers/auxiliary-model.ts";
import { fakeModel } from "../helpers/fake-model.ts";

test("native observation joins committed transcript and capability facts with stable entry IDs", async () => {
  const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
  const Counter = defineDoc({
    kind: "test.counter",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ count: 0 }),
  });
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("count", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("counted"),
  ]);
  const tool: PresentedTool = {
    name: "count",
    description: "Count once",
    parameters: Type.Object({}),
    presentCall: () => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.todo_write",
      title: "Count",
    }),
    presentResult: () => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.todo_write",
      text: "Counted once",
    }),
    async execute(_args, api, ctx) {
      await api.commit(async (tx) => {
        const state = await tx.doc(Counter, api.conversationId);
        state.count++;
      }, ctx);
      return { content: [{ type: "text", text: "one" }], details: { count: 1 } };
    },
  };
  const registry = createRegistry();
  registry.install({ name: "count", tools: [tool] });
  const harness = await Harness.open(
    new MemoryStorage(),
    {
      models: fake.models,
      registry,
      conversationCreated: async (tx, record) => {
        await tx.doc(Counter, record.id);
      },
    },
    context,
  );
  let count = 0;
  const delivered: SessionEvent[] = [];
  try {
    const conversation = await harness.root(context, {
      agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
    });
    const observation = await createConversationObservation({
      harness,
      conversation,
      sessionId: "product",
      tools: () => [tool],
      adopt: (publication) => {
        for (const change of publication.changes)
          if (
            change.type === "document" &&
            change.record.kind === "test.counter" &&
            typeof change.value?.count === "number"
          )
            count = change.value.count;
      },
      facts: () => ({
        toolStates: { counter: { count } },
        runSummaries: [],
        model: "faux",
        planMode: false,
        background: [],
      }),
      publish: (events) => {
        delivered.push(...events);
      },
    });
    const initial = observation.snapshot();
    const input = await conversation.submit({ type: "input", content: "count once" }, context);
    await input.wait(context);
    await conversation.waitForIdle(context);
    await observation.flush();
    expect(initial.toolStates).toEqual({ counter: { count: 0 } });
    expect(observation.snapshot().toolStates).toEqual({ counter: { count: 1 } });
    expect(observation.running()).toBe(false);
    const captured = observation.snapshot();
    const presented = observation.present(observation.messages());
    expect(presented).toEqual([...observation.messages()]);
    expect(observation.snapshot()).toBe(captured);
    const fresh: TranscriptMessage[] = [
      {
        ...fauxAssistantMessage(fauxToolCall("count", {}, { id: "fresh-call" })),
        entryId: "fresh-assistant",
      },
      {
        role: "toolResult",
        toolCallId: "fresh-call",
        toolName: "count",
        content: [{ type: "text", text: "fresh result" }],
        isError: false,
        timestamp: 0,
        entryId: "fresh-result",
      },
    ];
    const freshResult = observation.present(fresh).find((message) => message.role === "toolResult");
    expect(freshResult).toMatchObject({ entryId: "fresh-result", view: { text: "Counted once" } });
    expect(observation.snapshot()).toBe(captured);
    expect(delivered.filter((event) => event.type === "run_start")).toHaveLength(1);
    expect(delivered.filter((event) => event.type === "run_end")).toHaveLength(1);
    expect(delivered).toContainEqual({
      type: "tool_state_changed",
      sessionId: "product",
      name: "counter",
      value: { count: 1 },
    });
    const end = delivered.find(
      (event) =>
        event.type === "message_end" &&
        event.messages.some((message) => message.role === "toolResult"),
    );
    if (end?.type !== "message_end") throw new Error("Missing committed result");
    expect(end.entryId).toBe(String(end.entry.id));
    expect(end.messages[0]).toMatchObject({
      entryId: end.entryId,
      role: "toolResult",
      view: { text: "Counted once" },
    });
    expect(observation.messages().every((message) => typeof message.entryId === "string")).toBe(
      true,
    );
    const historyBefore = observation.messages();
    await harness.commit(async (tx) => {
      const state = await tx.doc(Counter, conversation.id);
      state.count = 2;
    }, context);
    await observation.flush();
    expect(observation.messages()).toBe(historyBefore);
    await conversation.reset(undefined, context);
    await observation.flush();
    expect(observation.messages()).toEqual([]);
    expect(delivered.findLast((event) => event.type === "snapshot")).toMatchObject({
      type: "snapshot",
      messages: [],
      toolStates: { counter: { count: 2 } },
    });
    await observation.close();
  } finally {
    await harness.close(context);
  }
});

test("closing observation from delivery releases the view without aborting native work", async () => {
  const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("hold", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("finished after view closed"),
  ]);
  const registry = createRegistry();
  registry.install({
    name: "hold",
    tools: [
      {
        name: "hold",
        description: "Hold native work",
        parameters: Type.Object({}),
        async execute(_args, api) {
          started.resolve();
          api.output("started");
          await release.promise;
          return { content: [{ type: "text", text: "completed" }] };
        },
      },
    ],
  });
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: fake.models, registry },
    context,
  );
  try {
    const conversation = await harness.root(context, {
      agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
    });
    const delivered: SessionEvent[] = [];
    const stopped = Promise.withResolvers<void>();
    const observation = await createConversationObservation({
      harness,
      conversation,
      sessionId: "close",
      tools: () => [],
      adopt: () => {},
      facts: () => ({
        toolStates: {},
        runSummaries: [],
        model: "faux",
        planMode: false,
        background: [],
      }),
      publish: (events) => {
        delivered.push(...events);
        if (events.some((event) => event.type === "tool_execution_start"))
          void observation.close().then(() => stopped.resolve());
      },
    });
    const input = await conversation.submit({ type: "input", content: "hold" }, context);
    await started.promise;
    await stopped.promise;
    const before = delivered.length;
    release.resolve();
    expect((await input.wait(context)).status).toBe("done");
    await conversation.waitForIdle(context);
    await observation.flush();
    expect(delivered).toHaveLength(before);
    expect((await conversation.context(context)).messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "finished after view closed" }],
    });
  } finally {
    release.resolve();
    await harness.close(context);
  }
});

test("native interrupted tool receipts project uncertainty live and cold without replay or text matching", async () => {
  const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
  const entered = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  let effects = 0;
  const unsafe: PresentedTool = {
    name: "unsafe_effect",
    description: "Write an unsafe effect",
    parameters: Type.Object({}),
    async execute(_args, _api, ctx) {
      effects++;
      entered.resolve();
      await (await import("@earendil-works/chord/context")).awaitWithContext(held.promise, ctx);
      return { content: [{ type: "text", text: "effect finished" }] };
    },
  };
  const ordinary: PresentedTool = {
    name: "ordinary_error",
    description: "An ordinary tool-supplied error",
    parameters: Type.Object({}),
    async execute() {
      return {
        isError: true,
        content: [
          { type: "text", text: "Tool unsafe_effect was interrupted and may have partially run" },
        ],
        diagnostics: [
          { severity: "error", code: "interrupted", message: "Tool-supplied diagnostic" },
        ],
      };
    },
  };
  const registry = createRegistry();
  registry.install({ name: "effects", tools: [unsafe, ordinary] });
  const dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const firstLease = await store.open({}, context);
  const initial = fakeModel([
    fauxAssistantMessage(fauxToolCall("unsafe_effect", {}), { stopReason: "toolUse" }),
  ]);
  const first = await Harness.open(
    firstLease.storage,
    { models: initial.models, registry },
    context,
  );
  const parent = await first.root(context, {
    agent: {
      model: { provider: initial.model.provider, modelId: initial.model.id },
      tools: [unsafe, ordinary],
    },
  });
  await parent.submit({ type: "input", content: "write effect" }, context);
  await entered.promise;
  await first.close(context);
  await firstLease.release();
  const recovered = fakeModel([
    fauxAssistantMessage("inspected saved effect"),
    fauxAssistantMessage(fauxToolCall("ordinary_error", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("ordinary error handled"),
  ]);
  const secondLease = await store.open({ id: firstLease.id }, context);
  const second = await Harness.open(
    secondLease.storage,
    { models: recovered.models, registry },
    context,
  );
  const child = await second.root(context);
  const events: SessionEvent[] = [];
  const options = {
    harness: second,
    conversation: child,
    sessionId: "product",
    tools: () => [unsafe, ordinary],
    adopt: () => {},
    facts: () => ({
      toolStates: {},
      runSummaries: [],
      model: "faux/faux-1",
      planMode: false,
      background: [],
    }),
    publish: (batch: readonly SessionEvent[]) => {
      events.push(...batch);
    },
  };
  const live = await createConversationObservation(options);
  try {
    await child.waitForIdle(context);
    await live.flush();
    expect(effects).toBe(1);
    const result = live
      .messages()
      .find((message) => message.role === "toolResult" && message.toolName === "unsafe_effect");
    expect(result).toMatchObject({ isError: true, outcomeUnknown: true });
    expect(
      events.some(
        (event) =>
          event.type === "message_end" &&
          event.messages.some(
            (message) =>
              message.role === "toolResult" &&
              "outcomeUnknown" in message &&
              message.outcomeUnknown === true,
          ),
      ),
    ).toBe(true);
    await (
      await child.submit({ type: "input", content: "ordinary failure" }, context)
    ).wait(context);
    await live.flush();
    expect(
      live
        .messages()
        .find((message) => message.role === "toolResult" && message.toolName === "ordinary_error"),
    ).not.toHaveProperty("outcomeUnknown");
  } finally {
    await live.close();
    await second.close(context);
    await secondLease.release();
  }
  const cold = fakeModel([]);
  const thirdLease = await store.open({ id: firstLease.id }, context);
  const third = await Harness.open(thirdLease.storage, { models: cold.models, registry }, context);
  const saved = await third.root(context);
  const observation = await createConversationObservation({
    ...options,
    harness: third,
    conversation: saved,
    publish: () => {},
  });
  try {
    expect(
      observation
        .messages()
        .find((message) => message.role === "toolResult" && message.toolName === "unsafe_effect"),
    ).toMatchObject({ isError: true, outcomeUnknown: true });
    expect(
      observation
        .messages()
        .find((message) => message.role === "toolResult" && message.toolName === "ordinary_error"),
    ).not.toHaveProperty("outcomeUnknown");
    expect(cold.contexts).toHaveLength(0);
    expect(effects).toBe(1);
  } finally {
    await observation.close();
    await third.close(context);
    await thirdLease.release();
    await dirs.cleanup();
  }
});

test("committed application notices publish their projected message with the native entry live", async () => {
  const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
  const fake = fakeModel([]);
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: fake.models, registry: createRegistry() },
    context,
  );
  const conversation = await harness.root(context);
  const events: SessionEvent[] = [];
  const observation = await createConversationObservation({
    harness,
    conversation,
    sessionId: "product",
    tools: () => [],
    adopt: () => {},
    facts: () => ({
      toolStates: {},
      runSummaries: [],
      model: "faux/faux-1",
      planMode: false,
      background: [],
    }),
    publish: (batch) => {
      events.push(...batch);
    },
  });
  try {
    const entry = await conversation.commit(
      (tx) =>
        tx.appendEntry(conversation.id, {
          kind: "rukie.notice",
          data: {
            role: "session-notice",
            notice: { kind: "hook_message", message: "Review the committed Hook note" },
            timestamp: 10,
          },
        }),
      context,
    );
    await observation.flush();
    expect(events.find((event) => event.type === "message_end")).toMatchObject({
      entryId: String(entry.id),
      entry,
      messages: [
        {
          role: "session-notice",
          notice: { kind: "hook_message", message: "Review the committed Hook note" },
          entryId: String(entry.id),
        },
      ],
    });
    expect(observation.messages()).toHaveLength(1);
    expect(
      (await conversation.context(context)).messages.some((message) =>
        JSON.stringify(message).includes("Review the committed Hook note"),
      ),
    ).toBe(false);
    await conversation.commit(
      (tx) =>
        tx.appendEntry(conversation.id, {
          kind: "rukie.notice",
          data: { role: "session-notice", notice: { kind: "hook_message" } },
        }),
      context,
    );
    await observation.flush();
    expect(events.filter((event) => event.type === "message_end")).toHaveLength(1);
  } finally {
    await observation.close();
    await harness.close(context);
  }
});

test("blocking native compaction publishes its committed summary and one terminal frame", async () => {
  const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
  const first = fauxAssistantMessage("old history ".repeat(1800));
  first.usage = { ...first.usage, input: 4000, output: 6000, totalTokens: 10000 };
  const fake = fakeModel([first, fauxAssistantMessage("continued")]);
  fake.models = withModelAlias(fake.models, fake.model.provider, [fake.model.id], {
    contextWindow: 4000,
  });
  const registry = createRegistry();
  registry.install({
    name: "summary",
    hooks: [
      hook(CompactionTask, {
        beforeCompact: async () => ({ summary: "committed native summary" }),
      }),
    ],
  });
  const harness = await Harness.open(
    new MemoryStorage(),
    {
      models: fake.models,
      registry,
      settings: {
        compaction: {
          enabled: true,
          reserveTokens: 1000,
          keepRecentTokens: 100,
          backgroundTokens: 0,
        },
      },
    },
    context,
  );
  try {
    const conversation = await harness.root(context, {
      agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
    });
    const delivered: SessionEvent[] = [];
    const observation = await createConversationObservation({
      harness,
      conversation,
      sessionId: "product",
      tools: () => [],
      adopt: () => {},
      facts: () => ({
        toolStates: {},
        runSummaries: [],
        model: "faux",
        planMode: false,
        background: [],
      }),
      publish: (events) => delivered.push(...events),
    });
    expect(
      await (await conversation.submit({ type: "input", content: "first" }, context)).wait(context),
    ).toMatchObject({ status: "done" });
    expect(
      await (
        await conversation.submit({ type: "input", content: "second" }, context)
      ).wait(context),
    ).toMatchObject({ status: "done" });
    await conversation.waitForIdle(context);
    await observation.flush();
    expect(observation.view().entries.map((entry) => entry.kind)).toContain("pi.compaction");
    expect(
      JSON.stringify(
        observation.view().entries.find((entry) => entry.kind === "pi.compaction")?.model,
      ),
    ).toContain("committed native summary");
    expect(delivered.filter((event) => event.type === "compaction_start")).toHaveLength(1);
    expect(delivered.filter((event) => event.type === "compaction_end")).toHaveLength(1);
    expect(observation.snapshot().compactions).toEqual([]);
    await observation.close();
  } finally {
    await harness.close(context);
  }
});

test("incremental native continuation keeps its committed owner metadata", async () => {
  const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
  const fake = fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("done")]);
  const registry = createRegistry();
  let continued = false;
  let owner: Conversation;
  registry.install({
    name: "continuation",
    hooks: [
      hook(GenerationTask, {
        onYield: async (_answer, api, ctx) => {
          if (continued) return;
          continued = true;
          await owner.commit(
            (tx) =>
              tx.appendEntry(owner.id, {
                kind: "rukie.message-facts",
                data: {
                  taskId: Number(api.taskId),
                  content: "owner continuation",
                  source: "stop_hook",
                },
              }),
            ctx,
          );
          return { continue: "owner continuation" };
        },
      }),
    ],
  });
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: fake.models, registry },
    context,
  );
  try {
    const conversation = await harness.root(context, {
      agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
    });
    owner = conversation;
    const events: SessionEvent[] = [];
    const observation = await createConversationObservation({
      harness,
      conversation,
      sessionId: "product",
      tools: () => [],
      adopt: () => {},
      facts: () => ({
        toolStates: {},
        runSummaries: [],
        model: "faux",
        planMode: false,
        background: [],
      }),
      publish: (batch) => events.push(...batch),
    });
    await (await conversation.submit({ type: "input", content: "start" }, context)).wait(context);
    await conversation.waitForIdle(context);
    await observation.flush();
    const committed = observation
      .messages()
      .find((message) => message.role === "user" && message.source === "stop_hook");
    expect(committed).toBeDefined();
    const incremental = events
      .flatMap((event) => (event.type === "message_end" ? event.messages : []))
      .find((message) => message.entryId === committed?.entryId);
    expect(incremental).toEqual(committed);
    await observation.close();
  } finally {
    await harness.close(context);
  }
});
