import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
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
  fake.streamFn = (_model, context) => {
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
  };
  return fake;
}

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
  expect(usage[1]!.segments).toMatchObject({ assistant: 3, tools: 0 });
  expect(usage[2]!.segments.assistant).toBe(6);
  expect(usage[2]!.segments.tools).toBeGreaterThan(0);
  for (const [index, event] of events.entries()) {
    if (event.type === "message_end" && event.message.role === "assistant") {
      expect(events[index + 1]?.type).toBe("context_usage");
    }
  }
});

test("the first Run and resume estimate Context Usage while continuing a live Session keeps the latest provider count", async () => {
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
  expect(initial.segments).toEqual({
    system: initial.used,
    prompt: 0,
    assistant: 0,
    thinking: 0,
    tools: 0,
  });

  const continued: SessionEvent[] = [];
  await session.run("efgh", {
    onEvent: (event) => {
      continued.push(event);
    },
  });
  expect(continued[1]).toMatchObject({ type: "context_usage", used: 90_000 });

  const next = providerModel([reply]);
  next.model.contextWindow = 128_000;
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  const events: SessionEvent[] = [];
  await resumed.run("ijkl", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  const usage = events.find((event) => event.type === "context_usage")!;
  expect(usage.window).toBe(128_000);
  expect(usage.used).toBe(Object.values(usage.segments).reduce((sum, count) => sum + count, 0));
  expect(usage.used).not.toBe(90_000);
  expect(usage.segments.assistant).toBe(4); // Two eight-character replies.
  expect(usage.segments.prompt).toBeGreaterThan(2); // Includes the persisted reminders.
});

test("Context Usage classifies reminder, tool call, thinking and tool error text into five segments", async () => {
  dirs = await tempDirs();
  const assistant = fauxAssistantMessage([
    { type: "text", text: "abcde" },
    { type: "thinking", thinking: "123456789" },
    fauxToolCall("read", { path: "x" }, { id: "call-1" }),
  ]);
  assistant.usage = { ...assistant.usage, input: 9999 };
  const history: AgentMessage[] = [
    { role: "system", content: "abcdefgh", timestamp: 0 },
    { role: "system-reminder", source: "fixture", content: "12345", timestamp: 1 },
    { role: "user", content: "abcdefghi", timestamp: 2 },
    assistant,
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "text", text: "ENOENT!" }],
      isError: true,
      timestamp: 4,
    },
  ];
  const store = new MemorySessionRepo();
  const stored = await store.create({}, BACKGROUND_CONTEXT);
  const branch = await stored.createBranch("main", null, BACKGROUND_CONTEXT);
  for (const message of history) await branch.appendMessage(message, BACKGROUND_CONTEXT);
  await stored.close(BACKGROUND_CONTEXT);
  const fake = providerModel([fauxAssistantMessage("done")]);
  const session = await createSession({ ...dirs, ...fake, store, resumeId: stored.metadata.id });
  const events: SessionEvent[] = [];
  await session.run("next", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events[1]).toEqual({
    type: "context_usage",
    sessionId: session.id,
    window: fake.model.contextWindow,
    used: 18,
    // read + {"path":"x"} = 16 chars: four tokens; text adds two.
    segments: { system: 2, prompt: 5, assistant: 6, thinking: 3, tools: 2 },
  });
  const final = events.filter((event) => event.type === "context_usage").at(-1)!;
  expect(final.segments).toMatchObject({ system: 2, assistant: 7, thinking: 3, tools: 2 });
  expect(final.used).toBe(Object.values(final.segments).reduce((sum, count) => sum + count, 0));
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
      prompt: Math.ceil(end.summary.length / 4) + 12,
      assistant: 0,
      thinking: 0,
      tools: 0,
    },
  });
  expect(usage.used).toBe(usage.segments.system + usage.segments.prompt);
  expect(usage.used).toBeLessThan(9000);
  expect(usage.used).not.toBe(7777);
  const updates = events.filter((event) => event.type === "context_usage");
  expect(updates).toHaveLength(4); // The summary request is not an assistant Turn.
  expect(updates.at(-1)).toMatchObject({
    used: 73,
    segments: { assistant: 2, thinking: 0, tools: 0 },
  });
});
