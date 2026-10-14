import { expect, test } from "bun:test";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  type EntryDraft,
} from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { inputArrivalContent } from "../../src/session/input-todo-reminders.ts";
import { fakeModel } from "../helpers/fake-model.ts";

// The formatter consumes committed native records; Session placement wiring is covered in queued-input.
test.each([false, true])(
  "interrupted output reports discarded calls only without a receipt (%s)",
  async (receipt) => {
    const fake = fakeModel([]);
    const harness = await Harness.open(
      new MemoryStorage(),
      { models: fake.models, registry: createRegistry() },
      BACKGROUND_CONTEXT,
    );
    const conversation = await harness.root(BACKGROUND_CONTEXT);
    try {
      const call = fauxToolCall("write", { path: "result", content: "value" });
      const entries: EntryDraft[] = [
        {
          kind: "assistant",
          model: [
            fauxAssistantMessage([{ type: "text", text: "partial answer" }, call], {
              stopReason: "aborted",
            }),
          ],
        },
      ];
      if (receipt)
        entries.push({
          kind: "toolResult",
          model: [
            {
              role: "toolResult",
              toolCallId: call.id,
              toolName: "write",
              content: [{ type: "text", text: "aborted" }],
              isError: true,
              timestamp: 1,
            },
          ],
        });
      let inputEntry = 0;
      await conversation.commit(async (tx) => {
        for (const entry of entries) await tx.appendEntry(conversation.id, entry);
        inputEntry = Number(
          (
            await tx.appendEntry(conversation.id, {
              kind: "input",
              model: [{ role: "user", content: "correction", timestamp: 2 }],
            })
          ).id,
        );
      }, BACKGROUND_CONTEXT);
      const history = (await conversation.entries({}, 100, undefined, BACKGROUND_CONTEXT)).items;
      const content = inputArrivalContent(history, inputEntry);
      expect(content).toContain("preceding output was interrupted");
      expect(content).toContain("partial text is not a completed answer");
      expect(content.includes("Unfinished tool calls in that aborted output were discarded")).toBe(
        !receipt,
      );
    } finally {
      await harness.close(BACKGROUND_CONTEXT);
    }
  },
);
