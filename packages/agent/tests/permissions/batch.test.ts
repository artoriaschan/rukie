import { expect, test } from "bun:test";
import {
  BACKGROUND_CONTEXT,
  awaitWithContext,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { Harness, MemoryStorage, createRegistry, hook, ToolTask } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import type { Context } from "@earendil-works/chord";
import type { StorageWrite } from "@earendil-works/pi-durable";
import { createPermissionBatch } from "../../src/permissions/batch.ts";
import { fakeModel } from "../helpers/fake-model.ts";

test.each(["allow", "block", "abort", "invalid", "sequential"] as const)(
  "native permission batch coordinates %s without starting a permitted sibling early",
  async (decision) => {
    const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
    const second = fauxToolCall("probe", decision === "invalid" ? {} : { value: "second" });
    const fake = fakeModel([
      fauxAssistantMessage([fauxToolCall("probe", { value: "first" }), second], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const registry = createRegistry();
    const storage = new MemoryStorage();
    const harness = await Harness.open(
      storage,
      { models: fake.models, registry, settings: { toolExecution: "parallel" } },
      context,
    );
    const batch = createPermissionBatch(harness);
    const effects: string[] = [];
    const entered: string[] = [];
    const ready = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    registry.install({
      name: "batch-probe",
      tools: [
        {
          name: "probe",
          description: "record an effect",
          parameters: Type.Object({ value: Type.String() }),
          executionMode: decision === "sequential" ? "sequential" : "parallel",
          execute: async ({ value }) => {
            effects.push(value);
            return { content: [{ type: "text", text: value }] };
          },
        },
      ],
      hooks: [
        hook(ToolTask, {
          beforeTool: batch.wrap(async (call, _api, invocation) => {
            entered.push(String(call.arguments.value));
            if (entered.length === (decision === "invalid" ? 1 : 2)) ready.resolve();
            if (call.arguments.value === "second") {
              if (decision === "sequential") expect(effects).toEqual(["first"]);
              await awaitWithContext(release.promise, invocation);
              if (decision === "block") return { block: "policy blocked" };
            }
          }),
        }),
      ],
    });
    try {
      const conversation = await harness.root(context, {
        agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
      });
      const submission = await conversation.submit(
        { type: "input", content: "run probes" },
        context,
      );
      await awaitWithContext(ready.promise, context);
      if (decision !== "invalid" && decision !== "sequential") expect(effects).toEqual([]);
      if (decision === "abort") await conversation.abort(context);
      release.resolve();
      await submission.wait(context);
      expect(effects).toEqual(
        decision === "abort"
          ? []
          : decision === "allow" || decision === "sequential"
            ? ["first", "second"]
            : ["first"],
      );
      expect(entered).toHaveLength(decision === "invalid" ? 1 : 2);
    } finally {
      release.resolve();
      batch.close();
      await harness.close(BACKGROUND_CONTEXT);
    }
  },
);

test("cold native pending policies acquire fresh decisions before any effect", async () => {
  const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
  class RecordedStorage extends MemoryStorage {
    commits: (readonly StorageWrite[])[] = [];
    override async commit(writes: readonly StorageWrite[], invocation: Context) {
      const seq = await super.commit(writes, invocation);
      this.commits.push(structuredClone(writes));
      return seq;
    }
  }
  const saved = new RecordedStorage();
  const effects: string[] = [];
  const entered = Promise.withResolvers<void>();
  let calls = 0;
  const fake = fakeModel([
    fauxAssistantMessage(
      [fauxToolCall("probe", { value: "one" }), fauxToolCall("probe", { value: "two" })],
      { stopReason: "toolUse" },
    ),
  ]);
  const registry = createRegistry();
  const harness = await Harness.open(saved, { models: fake.models, registry }, context);
  const batch = createPermissionBatch(harness);
  registry.install({
    name: "recovery-probe",
    tools: [
      {
        name: "probe",
        description: "effect",
        parameters: Type.Object({ value: Type.String() }),
        execute: async ({ value }) => {
          effects.push(value);
          return { content: [{ type: "text", text: value }] };
        },
      },
    ],
    hooks: [
      hook(ToolTask, {
        beforeTool: batch.wrap(async (_call, _api, invocation) => {
          if (++calls === 2) entered.resolve();
          await awaitWithContext(new Promise<void>(() => {}), invocation);
        }),
      }),
    ],
  });
  const conversation = await harness.root(context, {
    agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
  });
  const submission = await conversation.submit({ type: "input", content: "two policies" }, context);
  await awaitWithContext(entered.promise, context);
  // Capture only successful public Storage commits at the abrupt-stop boundary.
  // Graceful cleanup afterward is excluded from the independent cold store.
  const checkpoint = saved.commits.slice();
  expect(effects).toEqual([]);
  await conversation.abort(context);
  batch.close();
  await harness.close(BACKGROUND_CONTEXT);

  const cold = new MemoryStorage();
  for (const writes of checkpoint) await cold.commit(writes, context);
  const resumedModel = fakeModel([fauxAssistantMessage("recovered")]);
  const resumedRegistry = createRegistry();
  const resumed = await Harness.open(
    cold,
    { models: resumedModel.models, registry: resumedRegistry },
    context,
  );
  const freshBatch = createPermissionBatch(resumed);
  let decisions = 0;
  resumedRegistry.install({
    name: "recovery-probe",
    tools: [
      {
        name: "probe",
        description: "effect",
        parameters: Type.Object({ value: Type.String() }),
        execute: async ({ value }) => {
          effects.push(value);
          return { content: [{ type: "text", text: value }] };
        },
      },
    ],
    hooks: [
      hook(ToolTask, {
        beforeTool: freshBatch.wrap(() => {
          decisions++;
          return { block: "fresh cold denial" };
        }),
      }),
    ],
  });
  try {
    resumed.resume();
    const restored = await resumed.submission(submission.id, context);
    if (!restored) throw new Error("Missing committed native submission.");
    await restored.wait(context);
    expect(decisions).toBe(2);
    expect(effects).toEqual([]);
  } finally {
    freshBatch.close();
    await resumed.close(BACKGROUND_CONTEXT);
  }
});
