import { expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, readSessionNotice } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

test("interruption during a real question persists one canonical ending and never replays the Interaction", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("ask_user_question", {
        questions: [
          {
            question: "Proceed?",
            header: "Choice",
            options: [
              { label: "Yes", description: "Continue" },
              { label: "No", description: "Stop" },
            ],
          },
        ],
      }),
      { stopReason: "toolUse" },
    ),
  ]);
  const abort = new AbortController();
  const asked = Promise.withResolvers<void>();
  const session = await createSession({
    ...dirs,
    ...fake,
    onQuestion(request) {
      asked.resolve();
      return new Promise((resolve) =>
        request.signal.addEventListener("abort", () => resolve("declined"), { once: true }),
      );
    },
  });
  try {
    const run = session.run("ask", { signal: abort.signal });
    void run.catch(() => {});
    await asked.promise;
    abort.abort(new Error("user interrupted"));
    await expect(run).rejects.toThrow("user interrupted");
    expect(
      session.messages.filter(
        (message) =>
          message.role === "toolResult" &&
          message.toolName === "ask_user_question" &&
          message.isError,
      ),
    ).toHaveLength(1);
    expect(
      JSON.stringify(session.messages.find((message) => message.role === "toolResult")),
    ).toContain("Tool ask_user_question was aborted");
    expect(session.messages.find((message) => message.role === "assistant")).toMatchObject({
      stopReason: "toolUse",
    });
    const id = session.id;
    await session.close();
    const replayFake = fakeModel([fauxAssistantMessage("continued")]);
    const resumed = await createSession({ ...dirs, ...replayFake, resumeId: id });
    try {
      expect(
        resumed.messages.filter(
          (message) =>
            message.role === "toolResult" &&
            message.toolName === "ask_user_question" &&
            message.isError,
        ),
      ).toHaveLength(1);
      const receipt = session.messages.find((message) => message.role === "toolResult");
      const restored = resumed.messages.find((message) => message.role === "toolResult");
      if (receipt?.role !== "toolResult") throw new Error("Missing committed question result");
      expect(restored).toMatchObject({
        entryId: receipt.entryId,
        toolCallId: receipt.toolCallId,
        content: receipt.content,
        isError: true,
      });
      expect(replayFake.contexts).toHaveLength(0);
      await resumed.run("continue");
      expect(JSON.stringify(replayFake.contexts[0])).not.toContain("session-notice");
      expect(JSON.stringify(replayFake.contexts[0])).toContain("ask_user_question");
    } finally {
      await resumed.close();
    }
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

test("a blocked prompt stores its visible Hook reason while review input stays out of model history", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage('{"ok":false,"reason":"protected reason"}')]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: { UserPromptSubmit: [{ hooks: [{ type: "prompt", prompt: "Check $ARGUMENTS" }] }] },
    },
  });
  try {
    expect(await session.run("secret input")).toMatchObject({ stopReason: "hook_blocked" });
    expect(session.messages.flatMap((message) => readSessionNotice(message) ?? [])).toEqual([
      { kind: "hook_blocked", reason: "protected reason" },
    ]);
    expect(JSON.stringify(session.messages)).not.toContain("secret input");
    const id = session.id;
    await session.close();
    const follow = fakeModel([fauxAssistantMessage("next")]);
    const resumed = await createSession({ ...dirs, ...follow, resumeId: id });
    try {
      expect(resumed.messages.flatMap((message) => readSessionNotice(message) ?? [])).toEqual([
        { kind: "hook_blocked", reason: "protected reason" },
      ]);
      await resumed.run("next prompt");
      expect(JSON.stringify(follow.contexts[0])).not.toContain("protected reason");
      expect(JSON.stringify(follow.contexts[0])).not.toContain("secret input");
    } finally {
      await resumed.close();
    }
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});
