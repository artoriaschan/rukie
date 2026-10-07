import { expect, test } from "bun:test";
import {
  BACKGROUND_CONTEXT,
  awaitWithContext,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { Harness, MemoryStorage, createRegistry, hook, ToolTask } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { createPermissionBatch } from "../../src/permissions/batch.ts";
import { fakeModel } from "../helpers/fake-model.ts";

test.each(["allow", "block", "abort", "invalid"] as const)(
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
      if (decision !== "invalid") expect(effects).toEqual([]);
      if (decision === "abort") await conversation.abort(context);
      release.resolve();
      await submission.wait(context);
      expect(effects).toEqual(
        decision === "abort" ? [] : decision === "allow" ? ["first", "second"] : ["first"],
      );
      expect(entered).toHaveLength(decision === "invalid" ? 1 : 2);
    } finally {
      release.resolve();
      batch.close();
      await harness.close(BACKGROUND_CONTEXT);
    }
  },
);
