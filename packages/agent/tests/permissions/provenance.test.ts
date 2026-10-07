import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  hook,
  ToolTask,
  type JsonObject,
} from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { permissionDenialFacts, transcriptMessages } from "../../src/session/messages.ts";
import { fakeModel } from "../helpers/fake-model.ts";

const invalidFacts: JsonObject[] = [
  { permissionDenial: { by: "unknown" } },
  { permissionDenial: { by: "rule", rule: 42 } },
  { permissionDenial: { by: "hook", hook: [] } },
  { permissionDenial: { by: "user", reason: false } },
  { toolTaskId: "invalid", permissionDenial: { by: "hook" } },
  { toolTaskId: -1, permissionDenial: { by: "hook" } },
];
test.each(invalidFacts)(
  "native projection ignores malformed permission facts %#",
  async (invalid) => {
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("probe", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    const registry = createRegistry();
    const harness = await Harness.open(
      new MemoryStorage(),
      { models: fake.models, registry },
      BACKGROUND_CONTEXT,
    );
    registry.install({
      name: "denial-probe",
      tools: [
        {
          name: "probe",
          description: "never execute",
          parameters: Type.Object({}),
          execute: async () => {
            throw new Error("Denied tool executed.");
          },
        },
      ],
      hooks: [
        hook(ToolTask, {
          beforeTool: async (call, api, context) => {
            await harness.commit(
              (tx) =>
                tx.appendEntry(api.conversationId, {
                  kind: "rukie.message-facts",
                  data: { toolTaskId: Number(api.taskId), ...invalid },
                }),
              context,
            );
            return { block: "native block without valid owner provenance" };
          },
        }),
      ],
    });
    try {
      const conversation = await harness.root(BACKGROUND_CONTEXT, {
        agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
      });
      const request = await conversation.submit(
        { type: "input", content: "inspect" },
        BACKGROUND_CONTEXT,
      );
      await request.wait(BACKGROUND_CONTEXT);
      const entries = (await conversation.context(BACKGROUND_CONTEXT)).entries;
      const receipt = entries.find((entry) =>
        entry.model?.some((message) => message.role === "toolResult"),
      );
      if (!receipt?.byTaskId) throw new Error("Missing native tool task receipt.");
      const before = transcriptMessages(entries).find((message) => message.role === "toolResult");
      expect(before && "permissionDenial" in before).toBe(false);
      await conversation.commit(
        (tx) =>
          tx.appendEntry(conversation.id, {
            kind: "rukie.message-facts",
            data: permissionDenialFacts(receipt.byTaskId!, {
              type: "permission_denied",
              toolCallId: "irrelevant-provider-id",
              toolName: "probe",
              by: "rule",
              rule: "probe",
            }),
          }),
        BACKGROUND_CONTEXT,
      );
      expect(
        transcriptMessages((await conversation.context(BACKGROUND_CONTEXT)).entries).find(
          (message) => message.role === "toolResult",
        ),
      ).toMatchObject({ permissionDenial: { by: "rule", rule: "probe" }, isError: true });
    } finally {
      await harness.close(BACKGROUND_CONTEXT);
    }
  },
);
