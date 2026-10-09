import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { awaitWithContext } from "@earendil-works/chord/context";
import { Type } from "typebox";
import { Harness, MemoryStorage, createRegistry } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createSubagentController } from "../../../src/tools/subagents/controller.ts";
import { createSubagentTools } from "../../../src/tools/subagents/tools.ts";
import { subagentsState } from "../../../src/tools/subagents/state.ts";
import { fakeModel } from "../../helpers/fake-model.ts";

test.each(["stop", "error", "aborted", "length"] as const)(
  "foreground delegation preserves %s native child outcome and retains an idle directory identity",
  async (stopReason) => {
    const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Inspect file",
          prompt: "child work",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("child answer", {
        stopReason,
        ...(stopReason === "error" ? { errorMessage: "provider failure" } : {}),
      }),
      fauxAssistantMessage("parent answer"),
    ]);
    const registry = createRegistry();
    const harness = await Harness.open(
      new MemoryStorage(),
      { models: fake.models, registry },
      context,
    );
    try {
      const parent = await harness.root(context, {
        agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
      });
      let cleaned = false;
      const controller = createSubagentController({
        harness,
        parent,
        parentSessionId: "product",
        state: subagentsState("product"),
        models: fake.models,
        parentModel: () => fake.model,
        afterRun: async (request, child, result) => {
          expect(request.agentId).toBe(controller.list()[0]!.id);
          expect(Number(child.id)).toBe(controller.list()[0]!.conversationId);
          expect(result.outcome).toBe(stopReason === "stop" ? "completed" : stopReason);
          expect(result.text).toBe("child answer");
          expect(controller.list()[0]!.active).toBe(true);
          expect(
            (await parent.context(context)).entries.some((entry) =>
              entry.model?.some((item) => item.role === "toolResult"),
            ),
          ).toBe(false);
          cleaned = true;
        },
        childAgent: async () => ({
          model: { provider: fake.model.provider, modelId: fake.model.id },
          extensions: [],
          tools: [],
        }),
      });
      controller.setTypes(
        new Map([
          ["general-purpose", { name: "general-purpose", description: "General", prompt: "" }],
        ]),
      );
      registry.install(controller.extension);
      const tools = createSubagentTools(controller);
      registry.install({ name: "subagent-tools", tools: Object.values(tools) });
      const request = await parent.submit({ type: "input", content: "delegate" }, context);
      expect((await request.wait(context)).status).toBe("done");
      await parent.waitForIdle(context);
      expect(cleaned).toBe(true);
      const rows = controller.list();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        description: "Inspect file",
        active: false,
        latestRun: {
          outcome: stopReason === "stop" ? "completed" : stopReason,
          parentSessionId: "product",
        },
      });
      expect(controller.count).toBe(0);
      const child = await controller.readChild(rows[0]!.id, context);
      expect(child?.messages.at(-1)).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: "child answer" }],
      });
      expect(
        (await parent.context(context)).messages.find((message) => message.role === "toolResult"),
      ).toMatchObject({
        isError: stopReason !== "stop",
        content: [{ type: "text", text: "child answer" }],
      });
      expect((await harness.inspect(context)).tasks).toHaveLength(0);
      if (stopReason === "stop") {
        const completed = (await parent.context(context)).entries.findLast((entry) =>
          entry.model?.some(
            (message) => message.role === "assistant" && message.stopReason === "stop",
          ),
        );
        if (!completed) throw new Error("Missing committed closing parent answer.");
        const saved = await controller.snapshotForRewind(completed.id, context);
        const restored = await parent.commit(async (tx) => {
          const fork = await tx.forkConversation(parent.id, completed.id, {
            ownership: { kind: "ownerless" },
          });
          await controller.restoreFork(tx, fork.id, saved);
          return fork;
        }, context);
        const retained = await harness.conversation(restored.id, context);
        if (!retained) throw new Error("Missing restored root fork.");
        expect(
          await harness.snapshot(subagentsState("product").document, retained.id, context),
        ).toEqual({ value: rows });
        const anchor = (await parent.context(context)).entries.find((entry) =>
          entry.model?.some((message) => message.role === "user"),
        );
        if (!anchor) throw new Error("Missing committed parent prompt.");
        const rewound = await parent.fork(anchor.id, { ownership: { kind: "ownerless" } }, context);
        await controller.rebindParent(rewound, context);
        expect(controller.list()).toEqual([]);
        await parent.commit(async (tx) => {
          const doc = await tx.doc(subagentsState("product").document, parent.id);
          doc.value = [];
        }, context);
        expect(controller.list()).toEqual([]);
        await rewound.commit(async (tx) => {
          const doc = await tx.doc(subagentsState("product").document, rewound.id);
          doc.value = rows;
        }, context);
        expect(controller.list()).toEqual(rows);
      }
      controller.close();
    } finally {
      await harness.close(context);
    }
  },
);

test("interrupt explicitly aborts a native background child and commits its outcome", async () => {
  const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let parentCalls = 0;
  const response: Parameters<typeof fakeModel>[0][number] = (request) => {
    const last = request.messages.findLast((message) => message.role === "user");
    const text =
      last?.role === "user"
        ? typeof last.content === "string"
          ? last.content
          : last.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")
        : "";
    if (text === "hold child")
      return fauxAssistantMessage(fauxToolCall("hold", {}), { stopReason: "toolUse" });
    parentCalls++;
    return parentCalls === 1
      ? fauxAssistantMessage(
          fauxToolCall("subagent", { description: "Held child", prompt: "hold child" }),
          { stopReason: "toolUse" },
        )
      : fauxAssistantMessage("parent idle");
  };
  const fake = fakeModel([response, response, response, response]);
  const registry = createRegistry();
  const hold = {
    name: "hold",
    description: "Wait for release",
    parameters: Type.Object({}),
    async execute(_args: unknown, _api: unknown, ctx: Parameters<typeof awaitWithContext>[1]) {
      entered.resolve();
      await awaitWithContext(release.promise, ctx);
      return { content: [{ type: "text" as const, text: "released" }] };
    },
  };
  registry.install({ name: "hold-tool", tools: [hold] });
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: fake.models, registry },
    context,
  );
  try {
    const parent = await harness.root(context, {
      agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
    });
    const controller = createSubagentController({
      harness,
      parent,
      parentSessionId: "product",
      state: subagentsState("product"),
      models: fake.models,
      parentModel: () => fake.model,
      afterRun: async (_request, _child, result) => {
        expect(result.outcome).toBe("aborted");
        expect(controller.list()[0]!.active).toBe(true);
        expect(
          (await parent.context(context)).messages.filter((message) => message.role === "user"),
        ).toHaveLength(1);
      },
      childAgent: async () => ({
        model: { provider: fake.model.provider, modelId: fake.model.id },
        extensions: [{ name: "hold-tool", tools: [hold] }],
        tools: [hold],
      }),
    });
    controller.setTypes(
      new Map([
        ["general-purpose", { name: "general-purpose", description: "General", prompt: "" }],
      ]),
    );
    registry.install(controller.extension);
    registry.install({ name: "tools", tools: Object.values(createSubagentTools(controller)) });
    await (await parent.submit({ type: "input", content: "delegate" }, context)).wait(context);
    await parent.waitForIdle(context);
    await entered.promise;
    const row = controller.list()[0]!;
    const driver = (await harness.inspect(context)).tasks.find(
      (task) => task.record.kind === "rukie.subagent-driver",
    );
    if (!driver) throw new Error("Native driver is missing.");
    await controller.interrupt(row.id, context);
    const receipt = await harness.waitForTask(driver.record.id, context);
    expect(receipt.state).toMatchObject({
      outcome: {
        status: "aborted",
        result: { parentSubmissionId: expect.any(Number), parentAnswer: expect.any(Number) },
      },
    });
    expect(
      (await parent.context(context)).messages.filter(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("(Held child) aborted."),
      ),
    ).toHaveLength(1);
    expect(controller.list()[0]).toMatchObject({
      active: false,
      latestRun: { outcome: "aborted" },
    });
    expect(controller.count).toBe(0);
    expect((await harness.inspect(context)).tasks).toHaveLength(0);
    controller.close();
  } finally {
    release.resolve();
    await harness.close(context);
  }
});

test("idle send keeps logical identity and runs an owned native fork with prior history", async () => {
  const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
  let agentId = "";
  let parentCalls = 0;
  const response: Parameters<typeof fakeModel>[0][number] = (request) => {
    const last = request.messages.findLast((message) => message.role === "user");
    const text =
      last?.role === "user"
        ? typeof last.content === "string"
          ? last.content
          : last.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")
        : "";
    if (text === "child work") return fauxAssistantMessage("first child answer");
    if (text === "more child") return fauxAssistantMessage("second child answer");
    if (text.startsWith("Subagent ")) return fauxAssistantMessage("report handled");
    parentCalls++;
    if (parentCalls === 1)
      return fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Child",
          prompt: "child work",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      );
    if (parentCalls === 3)
      return fauxAssistantMessage(
        fauxToolCall("send_message", { agent_id: agentId, message: "more child" }),
        { stopReason: "toolUse" },
      );
    return fauxAssistantMessage("parent idle");
  };
  const fake = fakeModel([response, response, response, response, response, response, response]);
  const registry = createRegistry();
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: fake.models, registry },
    context,
  );
  try {
    const parent = await harness.root(context, {
      agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
    });
    let configurations = 0;
    const controller = createSubagentController({
      harness,
      parent,
      parentSessionId: "product",
      state: subagentsState("product"),
      models: fake.models,
      parentModel: () => fake.model,
      childAgent: async () => ({
        model: {
          provider: fake.model.provider,
          modelId: ++configurations === 1 ? fake.model.id : "root-model-changed",
        },
        extensions: [],
        tools: [],
      }),
    });
    controller.setTypes(
      new Map([
        ["general-purpose", { name: "general-purpose", description: "General", prompt: "" }],
      ]),
    );
    registry.install(controller.extension);
    registry.install({ name: "tools", tools: Object.values(createSubagentTools(controller)) });
    await (await parent.submit({ type: "input", content: "delegate" }, context)).wait(context);
    await parent.waitForIdle(context);
    const first = controller.list()[0]!;
    agentId = first.id;
    await (
      await parent.submit({ type: "input", content: "continue child" }, context)
    ).wait(context);
    const tasks = (await harness.inspect(context)).tasks;
    for (const task of tasks)
      if (task.record.kind === "rukie.subagent-driver")
        await harness.waitForTask(task.record.id, context);
    await parent.waitForIdle(context);
    const row = controller.list()[0]!;
    expect(row.id).toBe(first.id);
    expect(row.conversationId).not.toBe(first.conversationId);
    expect(row.active).toBe(false);
    // The controller validates saved conversation IDs as positive native integers.
    const ownedFork = await harness.conversation(
      Number(row.conversationId) as typeof parent.id,
      context,
    );
    if (!ownedFork) throw new Error("Missing admitted child fork.");
    expect(
      await harness.snapshot(subagentsState("product").document, ownedFork.id, context),
    ).toEqual({ value: [] });
    const child = await controller.readChild(agentId, context);
    expect(
      child?.messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.content),
    ).toEqual([
      [{ type: "text", text: "first child answer" }],
      [{ type: "text", text: "second child answer" }],
    ]);
    expect(child?.run?.outcome).toBe("completed");
    expect(
      child?.historyMessages
        .filter((message) => message.role === "assistant")
        .map((message) => message.content),
    ).toEqual([[{ type: "text", text: "first child answer" }]]);
    controller.close();
  } finally {
    await harness.close(context);
  }
});

test("background native child survives ordinary parent abort and its durable reporter settles", async () => {
  const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let parentCalls = 0;
  const response: Parameters<typeof fakeModel>[0][number] = async (request) => {
    const last = request.messages.findLast((message) => message.role === "user");
    const text =
      last?.role === "user"
        ? typeof last.content === "string"
          ? last.content
          : last.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")
        : "";
    if (text === "slow child") {
      entered.resolve();
      await release.promise;
      return fauxAssistantMessage("child completed");
    }
    if (text.startsWith("Subagent ")) return fauxAssistantMessage("report handled");
    parentCalls++;
    return parentCalls === 1
      ? fauxAssistantMessage(
          fauxToolCall("subagent", { description: "Background work", prompt: "slow child" }),
          { stopReason: "toolUse" },
        )
      : fauxAssistantMessage("parent idle");
  };
  const fake = fakeModel([response, response, response, response]);
  const registry = createRegistry();
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: fake.models, registry },
    context,
  );
  try {
    const parent = await harness.root(context, {
      agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
    });
    const controller = createSubagentController({
      harness,
      parent,
      parentSessionId: "product",
      state: subagentsState("product"),
      models: fake.models,
      parentModel: () => fake.model,
      childAgent: async () => ({
        model: { provider: fake.model.provider, modelId: fake.model.id },
        extensions: [],
        tools: [],
      }),
    });
    controller.setTypes(
      new Map([
        ["general-purpose", { name: "general-purpose", description: "General", prompt: "" }],
      ]),
    );
    registry.install(controller.extension);
    registry.install({
      name: "subagent-tools",
      tools: Object.values(createSubagentTools(controller)),
    });
    const request = await parent.submit({ type: "input", content: "delegate" }, context);
    await request.wait(context);
    await parent.waitForIdle(context);
    await entered.promise;
    expect(controller.count).toBe(1);
    await parent.abort(context);
    expect(controller.count).toBe(1);
    const driver = (await harness.inspect(context)).tasks.find(
      (task) => task.record.kind === "rukie.subagent-driver" && task.record.background,
    );
    expect(driver).toBeDefined();
    if (!driver) throw new Error("Native background driver missing.");
    release.resolve();
    const settled = await harness.waitForTask(driver.record.id, context);
    expect(settled.state).toMatchObject({
      outcome: {
        result: { parentSubmissionId: expect.any(Number), parentAnswer: expect.any(Number) },
      },
    });
    await parent.waitForIdle(context);
    expect(controller.list()[0]).toMatchObject({
      active: false,
      latestRun: { outcome: "completed" },
    });
    const users = (await parent.context(context)).messages.filter(
      (message) => message.role === "user",
    );
    expect(users).toHaveLength(2);
    expect(users[1]).toMatchObject({ content: expect.stringContaining("child completed") });
    expect((await harness.inspect(context)).tasks).toHaveLength(0);
    controller.close();
  } finally {
    release.resolve();
    await harness.close(context);
  }
});

test.each([false, true])(
  "start policy stops background=%s child before configuration or model admission",
  async (background) => {
    const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Needs review",
          prompt: "child input",
          run_in_background: background,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("parent done"),
      fauxAssistantMessage("report acknowledged"),
    ]);
    const registry = createRegistry();
    const harness = await Harness.open(
      new MemoryStorage(),
      { models: fake.models, registry },
      context,
    );
    try {
      const parent = await harness.root(context, {
        agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
      });
      let configurations = 0;
      const controller = createSubagentController({
        harness,
        parent,
        parentSessionId: "product",
        state: subagentsState("product"),
        models: fake.models,
        parentModel: () => fake.model,
        async beforeStart(request, child) {
          expect(controller.list()[0]?.id).toBe(request.agentId);
          expect((await child.context(context)).entries).toHaveLength(0);
          return { stop: "human review required" };
        },
        async childAgent() {
          configurations++;
          return { tools: [] };
        },
      });
      controller.setTypes(
        new Map([
          ["general-purpose", { name: "general-purpose", description: "General", prompt: "" }],
        ]),
      );
      registry.install(controller.extension);
      registry.install({ name: "tools", tools: Object.values(createSubagentTools(controller)) });
      await (await parent.submit({ type: "input", content: "delegate" }, context)).wait(context);
      for (const task of (await harness.inspect(context)).tasks)
        if (task.record.kind === "rukie.subagent-driver")
          await harness.waitForTask(task.record.id, context);
      expect(configurations).toBe(0);
      expect(controller.list()[0]).toMatchObject({
        active: false,
        latestRun: { outcome: "hook_stopped", reason: "human review required", tokens: 0 },
      });
      expect(
        fake.contexts.every(
          (context) => !JSON.stringify(context.messages).includes('"content":"child input"'),
        ),
      ).toBe(true);
      controller.close();
    } finally {
      await harness.close(context);
    }
  },
);

test.each([false, true])(
  "child cleanup failure produces a failed native driver receipt, background=%s",
  async (background) => {
    const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Cleanup",
          prompt: "child",
          run_in_background: background,
        }),
        { stopReason: "toolUse" },
      ),
      ...Array.from({ length: 4 }, () => fauxAssistantMessage("actual output")),
    ]);
    const registry = createRegistry();
    const harness = await Harness.open(
      new MemoryStorage(),
      { models: fake.models, registry },
      context,
    );
    try {
      const parent = await harness.root(context, {
        agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
      });
      const controller = createSubagentController({
        harness,
        parent,
        parentSessionId: "product",
        state: subagentsState("product"),
        models: fake.models,
        parentModel: () => fake.model,
        childAgent: async () => ({
          model: { provider: fake.model.provider, modelId: fake.model.id },
          tools: [],
        }),
        afterRun: async () => {
          throw new Error("cleanup failed");
        },
      });
      controller.setTypes(
        new Map([
          ["general-purpose", { name: "general-purpose", description: "General", prompt: "" }],
        ]),
      );
      registry.install(controller.extension);
      registry.install({ name: "tools", tools: Object.values(createSubagentTools(controller)) });
      await (await parent.submit({ type: "input", content: "delegate" }, context)).wait(context);
      const row = controller.list()[0]!;
      const driver = await harness.getTask(
        row.driverTaskId as import("@earendil-works/pi-durable").TaskId,
        context,
      );
      if (!driver) throw new Error("Committed native driver is missing.");
      const receipt = await harness.waitForTask(driver.id, context);
      expect(receipt.state).toMatchObject({
        outcome: {
          status: "failed",
          error: { message: "cleanup failed" },
          result: { success: false, text: "actual output", error: "cleanup failed" },
        },
      });
      expect(controller.list()[0]).toMatchObject({
        active: false,
        latestRun: { outcome: "error", error: "cleanup failed" },
      });
      if (background)
        expect(receipt.state.outcome.result).toMatchObject({
          parentAnswer: expect.any(Number),
          parentSubmissionId: expect.any(Number),
        });
      else
        expect(
          (await parent.context(context)).messages.find((message) => message.role === "toolResult"),
        ).toMatchObject({ isError: true, content: [{ type: "text", text: "actual output" }] });
      controller.close();
    } finally {
      await harness.close(context);
    }
  },
);
