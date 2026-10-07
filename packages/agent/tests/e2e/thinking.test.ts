import { expect, test } from "bun:test";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createSession, assistantThinkingDuration } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";

test("observed thinking phase duration stops at first text and survives Session Resume", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("next")]);
  const partial = fauxAssistantMessage([{ type: "thinking", thinking: "saved reasoning" }], {
    stopReason: "pending",
  });
  const stream = createAssistantMessageEventStream();
  let clock = 1000;
  const session = await createSession({
    ...dirs,
    model: fake.model,
    now: () => new Date(clock),
    streamFn: withAuxiliaryRequests(() => {
      stream.push({ type: "start", partial });
      stream.push({ type: "thinking_delta", contentIndex: 0, delta: "saved reasoning", partial });
      return stream;
    }),
  });
  try {
    await session.run("reason", {
      onEvent(event) {
        if (event.type !== "message_update" || event.message.role !== "assistant") return;
        if (event.assistantMessageEvent.type === "thinking_delta") {
          clock = 3500;
          const text = {
            ...partial,
            content: [...partial.content, { type: "text" as const, text: "answer" }],
          };
          stream.push({ type: "text_delta", contentIndex: 1, delta: "answer", partial: text });
        } else if (event.assistantMessageEvent.type === "text_delta") {
          clock = 9000;
          const final = { ...event.message, stopReason: "stop" as const };
          stream.push({ type: "done", reason: "stop", message: final });
          stream.end(final);
        }
      },
    });
    const message = session.messages.find((message) => message.role === "assistant");
    expect(assistantThinkingDuration(message)).toBe(2500);
    const id = session.id;
    await session.dispose();
    const resumed = await createSession({ ...dirs, ...fake, resumeId: id });
    try {
      const restored = resumed.messages.find((message) => message.role === "assistant");
      expect(assistantThinkingDuration(restored)).toBe(2500);
      expect(restored).toMatchObject({
        content: [
          { type: "thinking", thinking: "saved reasoning" },
          { type: "text", text: "answer" },
        ],
      });
      expect(fake.contexts).toHaveLength(0);
      await resumed.run("continue");
      const modelHistory = fake.contexts[0]!.messages.find(
        (message) => message.role === "assistant",
      );
      expect(modelHistory).not.toHaveProperty("neantThinkingDurationMs");
      expect(
        assistantThinkingDuration(resumed.messages.find((message) => message.role === "assistant")),
      ).toBe(2500);
    } finally {
      await resumed.dispose();
    }
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});

test.each(["error", "aborted"] as const)(
  "%s reasoning keeps its measured phase and committed content on resume",
  async (reason) => {
    const dirs = await tempDirs();
    const fake = fakeModel([]);
    const stream = createAssistantMessageEventStream();
    const partial = fauxAssistantMessage(
      [{ type: "thinking", thinking: "committed partial reasoning" }],
      { stopReason: "pending" },
    );
    let clock = 1000;
    const session = await createSession({
      ...dirs,
      model: fake.model,
      now: () => new Date(clock),
      streamFn: withAuxiliaryRequests(() => {
        stream.push({ type: "start", partial });
        stream.push({
          type: "thinking_delta",
          contentIndex: 0,
          delta: "committed partial reasoning",
          partial,
        });
        return stream;
      }),
    });
    try {
      const run = session.run("reason", {
        onEvent(event) {
          if (event.type !== "message_update") return;
          clock = 4000;
          const final = { ...partial, stopReason: reason, errorMessage: "ended while thinking" };
          stream.push({ type: "error", reason, error: final });
          stream.end(final);
        },
      });
      await expect(run).rejects.toThrow("ended while thinking");
      const id = session.id;
      const live = session.messages.find((message) => message.role === "assistant");
      expect(assistantThinkingDuration(live)).toBe(3000);
      await session.dispose();
      const resumed = await createSession({ ...dirs, ...fake, resumeId: id });
      try {
        const restored = resumed.messages.find((message) => message.role === "assistant");
        expect(restored).toEqual(live);
        expect(assistantThinkingDuration(restored)).toBe(3000);
        expect(fake.contexts).toHaveLength(0);
      } finally {
        await resumed.dispose();
      }
    } finally {
      await session.dispose();
      await dirs.cleanup();
    }
  },
);
