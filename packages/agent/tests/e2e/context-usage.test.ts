import {
  withAuxiliaryRequests,
  withModelStream,
  withModelAlias,
} from "../helpers/auxiliary-model.ts";
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

// Supply provider counts verbatim: pi's faux provider otherwise estimates its own usage.
function providerModel(replies: AssistantMessage[]) {
  const fake = fakeModel([]);
  fake.models = withModelStream(
    fake.models,
    withAuxiliaryRequests((_model, context) => {
      fake.contexts.push(structuredClone(context));
      const message = replies.shift()!;
      const stream = createAssistantMessageEventStream();
      stream.push({
        type: "done",
        reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
        message,
      });
      stream.end(message);
      return stream;
    }),
  );
  return fake;
}

test("resume restores provider totals and current tool attribution without a model request", async () => {
  dirs = await tempDirs();
  const reply = fauxAssistantMessage("answer");
  reply.usage = { ...reply.usage, input: 70000, cacheRead: 2000, cacheWrite: 1000 };
  const session = await createSession({ ...dirs, ...providerModel([reply]) });
  await session.run("query");
  const before = session.contextUsage();
  await session.close();
  const fake = providerModel([]);
  const resumed = await createSession({ ...dirs, ...fake, resumeId: session.id });
  try {
    const transcript = structuredClone(resumed.messages);
    expect(resumed.contextUsage().used).toBe(73000);
    expect(resumed.contextUsage().segments.tools).toBe(before.segments.tools);
    expect(resumed.contextUsage().segments.tools).toBeGreaterThan(0);
    expect(resumed.contextReport().used).toBe(73000);
    expect(resumed.messages).toEqual(transcript);
    expect(fake.contexts).toHaveLength(0);
  } finally {
    await resumed.close();
  }
});

test.each(["compaction", "model"])(
  "resume estimates context after %s invalidates provider usage",
  async (invalidation) => {
    dirs = await tempDirs();
    const reply = fauxAssistantMessage("retained answer");
    reply.usage = { ...reply.usage, input: 90000 };
    const fake = providerModel([reply, fauxAssistantMessage("summary")]);
    fake.models = withModelAlias(fake.models, "other", ["small"]);
    const session = await createSession({ ...dirs, ...fake });
    await session.run("question");
    expect(session.contextUsage().used).toBe(90000);
    if (invalidation === "compaction") await session.compact();
    else await session.setModel("other/small");
    await session.close();
    const next = providerModel([]);
    next.models = withModelAlias(next.models, "other", ["small"]);
    const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
    try {
      const usage = resumed.contextUsage();
      expect(usage.used).not.toBe(90000);
      expect(usage.used).toBe(Object.values(usage.segments).reduce((sum, count) => sum + count, 0));
      expect(resumed.contextReport().used).toBe(usage.used);
      expect(next.contexts).toHaveLength(0);
    } finally {
      await resumed.close();
    }
  },
);

test("Context Usage follows Session start and every assistant Turn with that Turn's input usage", async () => {
  dirs = await tempDirs();
  const first = fauxAssistantMessage(fauxToolCall("missing", {}, { id: "call-1" }), {
    stopReason: "toolUse",
  });
  first.usage = {
    ...first.usage,
    input: 10,
    cacheRead: 2,
    cacheWrite: 1,
    output: 300,
    totalTokens: 313,
  };
  const second = fauxAssistantMessage("final reply");
  second.usage = {
    ...second.usage,
    input: 20,
    cacheRead: 5,
    cacheWrite: 4,
    output: 400,
    totalTokens: 429,
  };
  const fake = providerModel([first, second]);
  fake.model.contextWindow = 64_000;
  const session = await createSession({ ...dirs, ...fake });
  const events: SessionEvent[] = [];
  await session.run("hi", {
    onEvent: async (event) => {
      events.push(structuredClone(event));
    },
  });

  const usage = events.filter((event) => event.type === "context_usage");
  expect(usage).toHaveLength(3);
  expect(events[1]).toBe(usage[0]!);
  expect(usage.slice(1)).toMatchObject([
    { used: 13, window: 64_000, sessionId: session.id },
    { used: 29, window: 64_000, sessionId: session.id },
  ]);
  expect(usage[1]!.segments.assistant).toBe(3);
  expect(usage[1]!.segments.tools).toBe(usage[0]!.segments.tools);
  expect(usage[1]!.segments.tools).toBeGreaterThan(0);
  expect(usage[2]!.segments.assistant).toBe(6);
  expect(usage[2]!.segments.tools).toBeGreaterThanOrEqual(usage[1]!.segments.tools);
  for (const [index, event] of events.entries()) {
    if (
      event.type === "message_end" &&
      event.entry.model?.some((message) => message.role === "assistant")
    ) {
      expect(events[index + 1]?.type).toBe("context_usage");
    }
  }
  await session.close();
});

test("the first Run estimates Context Usage and both live and resumed Sessions retain the latest provider count", async () => {
  dirs = await tempDirs();
  const reply = fauxAssistantMessage("abcdefgh");
  reply.usage = { ...reply.usage, input: 90_000 };
  const fake = providerModel([reply, reply]);
  fake.model.contextWindow = 128_000;
  const session = await createSession({ ...dirs, ...fake });
  const first: SessionEvent[] = [];
  await session.run("abcd", {
    onEvent: (event) => {
      first.push(event);
    },
  });
  const initial = first.find((event) => event.type === "context_usage")!;
  expect(initial.window).toBe(128_000);
  expect(initial.used).toBeGreaterThan(0);
  expect(initial.segments).toMatchObject({
    prompt: 0,
    assistant: 0,
    thinking: 0,
  });
  expect(initial.segments.system).toBeGreaterThan(0);
  expect(initial.segments.tools).toBeGreaterThan(0);
  expect(initial.used).toBe(initial.segments.system + initial.segments.tools);

  const continued: SessionEvent[] = [];
  await session.run("efgh", {
    onEvent: (event) => {
      continued.push(event);
    },
  });
  expect(continued[1]).toMatchObject({ type: "context_usage", used: 90_000 });
  expect(session.contextUsage().used).toBe(90_000);

  const next = providerModel([reply]);
  next.model.contextWindow = 128_000;
  await session.close();
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  const snapshot = resumed.contextUsage();
  expect(snapshot.window).toBe(128_000);
  expect(snapshot.used).toBe(90_000);
  expect(snapshot.used).toBe(resumed.contextReport().used);
  expect(snapshot.segments.assistant).toBe(4);
  expect(next.contexts).toHaveLength(0);
  const events: SessionEvent[] = [];
  await resumed.run("ijkl", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  const usage = events.find((event) => event.type === "context_usage")!;
  expect(usage.window).toBe(128_000);
  expect(usage.used).toBe(90_000);
  expect(usage.segments.assistant).toBe(4); // Two eight-character replies.
  expect(usage.segments.prompt).toBeGreaterThan(2); // Includes the persisted reminders.
  await resumed.close();
});

test("Context Usage classifies real reminder, tool call, thinking and tool error contributions", async () => {
  dirs = await tempDirs();
  const assistant = fauxAssistantMessage(
    [
      { type: "text", text: "abcde" },
      { type: "thinking", thinking: "123456789" },
      fauxToolCall("read", { path: "x" }, { id: "call-1" }),
    ],
    { stopReason: "toolUse" },
  );
  assistant.usage = { ...assistant.usage, input: 9999 };
  const fake = providerModel([assistant, fauxAssistantMessage("done")]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    const events: SessionEvent[] = [];
    await session.run("abcdefghi", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const updates = events.filter((event) => event.type === "context_usage");
    expect(updates[1]).toMatchObject({ used: 9999, segments: { assistant: 6, thinking: 3 } });
    const final = updates.at(-1)!;
    expect(final.segments).toMatchObject({ assistant: 7, thinking: 3 });
    expect(final.segments.prompt).toBeGreaterThan(3);
    expect(final.segments.system).toBeGreaterThan(0);
    expect(final.segments.tools).toBeGreaterThan(updates[0]!.segments.tools);
    expect(final.used).toBe(Object.values(final.segments).reduce((sum, count) => sum + count, 0));
    expect(JSON.stringify(fake.contexts.at(-1))).toContain("ENOENT");
  } finally {
    await session.close();
  }
});

test("a Turn without input usage falls back to the current estimates rather than the preceding Turn", async () => {
  dirs = await tempDirs();
  const first = fauxAssistantMessage(fauxToolCall("missing", {}, { id: "call-1" }), {
    stopReason: "toolUse",
  });
  first.usage = { ...first.usage, input: 90_000 };
  const second = fauxAssistantMessage("done");
  second.usage = { ...second.usage, output: 10, totalTokens: 10 };
  const fake = providerModel([first, second]);
  const session = await createSession({ ...dirs, ...fake });
  const events: SessionEvent[] = [];
  await session.run("hi", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  const usage = events.filter((event) => event.type === "context_usage").at(-1)!;
  expect(usage.used).toBe(Object.values(usage.segments).reduce((sum, count) => sum + count, 0));
  expect(usage.used).not.toBe(90_000);
  await session.close();
});

test("Compaction immediately replaces the segment estimates and invalidates provider usage until the next Turn", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "large.txt"), "tool output ".repeat(2500));
  const first = fauxAssistantMessage(
    [
      { type: "text", text: "reading" },
      { type: "thinking", thinking: "inspect the file" },
      fauxToolCall("read", { path: "large.txt" }, { id: "read-1" }),
    ],
    { stopReason: "toolUse" },
  );
  first.usage = { ...first.usage, input: 9000 };
  const summary = fauxAssistantMessage("The file contained large tool output.");
  summary.usage = { ...summary.usage, input: 7777 };
  const final = fauxAssistantMessage("finished");
  final.usage = { ...final.usage, input: 50, cacheRead: 20, cacheWrite: 3 };
  const fake = providerModel([first, summary, final]);
  fake.model.contextWindow = 4000;
  const session = await createSession({
    ...dirs,
    ...fake,
    now: () => new Date("2026-10-01T12:00:00Z"),
  });
  const events: SessionEvent[] = [];
  await session.run("read the file", {
    onEvent: async (event) => {
      events.push(structuredClone(event));
    },
  });
  const endIndex = events.findIndex((event) => event.type === "compaction_end");
  expect(endIndex).toBeGreaterThan(0);
  const end = events[endIndex]!;
  if (end.type !== "compaction_end") throw new Error("Expected a completed Compaction");
  const usage = events[endIndex + 1]!;
  if (usage.type !== "context_usage") throw new Error("Expected Context Usage after Compaction");
  expect(
    fake.contexts
      .at(-1)!
      .messages.slice(2)
      .map((message) => message.content),
  ).toEqual([
    [{ type: "text", text: "<system-reminder>\nCurrent date: 2026-10-01\n</system-reminder>" }],
    [{ type: "text", text: "<system-reminder>\nAvailable skills: none.\n</system-reminder>" }],
  ]);
  expect(usage).toMatchObject({
    window: 4000,
    sessionId: session.id,
    // Compaction restores date and empty skills reminders, six tokens each.
    segments: {
      prompt: expect.any(Number),
      assistant: 0,
      thinking: 0,
    },
  });
  expect(usage.segments.tools).toBeGreaterThan(0);
  expect(usage.used).toBe(usage.segments.system + usage.segments.prompt + usage.segments.tools);
  expect(usage.used).toBeLessThan(9000);
  expect(usage.used).not.toBe(7777);
  const updates = events.filter((event) => event.type === "context_usage");
  expect(updates).toHaveLength(4); // The summary request is not an assistant Turn.
  expect(updates.at(-1)).toMatchObject({
    used: 73,
    segments: { assistant: 2, thinking: 0 },
  });
  expect(updates.at(-1)!.segments.tools).toBe(usage.segments.tools);
  await session.close();
});
