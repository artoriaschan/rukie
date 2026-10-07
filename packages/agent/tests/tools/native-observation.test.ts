import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { Harness, MemoryStorage, createRegistry, defineDoc } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { createConversationObservation } from "../../src/session/observation.ts";
import type { SessionEvent } from "../../src/session/events.ts";
import type { PresentedTool } from "../../src/tools/presentation.ts";
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
    expect(delivered.at(-1)).toMatchObject({
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
