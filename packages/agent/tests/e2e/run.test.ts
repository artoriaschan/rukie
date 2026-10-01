import { afterEach, expect, test } from "bun:test";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { abortingModel } from "../helpers/aborting-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("a run sends the prompt to the model and returns the final assistant text", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("hello back")]);
  const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake });

  const result = await session.run("hello");

  expect(result.text).toBe("hello back");
  expect(fake.contexts).toHaveLength(1);
  expect(fake.contexts[0]!.messages.at(-1)).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "hello" }],
  });
});

test("a model error fails the run", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("", { stopReason: "error", errorMessage: "boom" })]);
  const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake });

  await expect(session.run("hello")).rejects.toThrow("boom");
});

test("the Run result totals every Turn and forwards tool events without changing their payload", async () => {
  dirs = await tempDirs();
  const first = fauxAssistantMessage(fauxToolCall("missing", { path: "a.ts" }, { id: "call-1" }), {
    stopReason: "toolUse",
  });
  first.usage = {
    input: 10,
    output: 3,
    cacheRead: 2,
    cacheWrite: 1,
    totalTokens: 16,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const second = fauxAssistantMessage("final reply");
  second.usage = {
    input: 20,
    output: 4,
    cacheRead: 5,
    cacheWrite: 0,
    totalTokens: 29,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  // pi's faux provider estimates usage itself; this boundary supplies known provider counts.
  const fake = fakeModel([]);
  const replies = [first, second];
  fake.streamFn = (_model, context) => {
    fake.contexts.push(context);
    const stream = createAssistantMessageEventStream();
    const message = replies.shift()!;
    stream.push({
      type: "done",
      reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
      message,
    });
    stream.end(message);
    return stream;
  };
  const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake });
  const events: SessionEvent[] = [];
  const result = await session.run("hi", {
    onEvent: (event) => {
      events.push(structuredClone(event));
    },
  });

  expect(result).toEqual({
    text: "final reply",
    success: true,
    durationMs: expect.any(Number),
    usage: { input: 30, output: 7, cacheRead: 7, cacheWrite: 1, totalTokens: 45 },
  });
  expect(events[0]).toMatchObject({ type: "session_start", sessionId: session.id });
  expect(events.at(-1)).toEqual({ type: "result", sessionId: session.id, ...result });
  expect(events.find((event) => event.type === "tool_execution_start")).toEqual({
    type: "tool_execution_start",
    sessionId: session.id,
    toolCallId: "call-1",
    toolName: "missing",
    args: { path: "a.ts" },
  });
  expect(fake.contexts).toHaveLength(2);
});

test("a model error without an error message still emits a failed result and rejects", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("partial", { stopReason: "error" })]);
  const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake });
  const events: SessionEvent[] = [];
  await expect(
    session.run("hi", {
      onEvent: (event) => {
        events.push(structuredClone(event));
      },
    }),
  ).rejects.toThrow("Model stopped: error");
  expect(events.at(-1)).toMatchObject({
    type: "result",
    sessionId: session.id,
    success: false,
    text: "partial",
    error: "Model stopped: error",
  });
});

test("an already-aborted signal stops the run before the model is called", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("unused")]);
  const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake });

  await expect(session.run("hello", { signal: AbortSignal.abort() })).rejects.toThrow();
  expect(fake.contexts).toHaveLength(0);
});

test("aborting an active run reports the caller's abort reason after the model settles", async () => {
  dirs = await tempDirs();
  const controller = new AbortController();
  const reason = new Error("caller cancelled the run");
  const fake = fakeModel([
    () => {
      controller.abort(reason);
      return fauxAssistantMessage("unfinished");
    },
  ]);
  const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake });

  await expect(session.run("hello", { signal: controller.signal })).rejects.toThrow(reason.message);
  expect(fake.contexts).toHaveLength(1);
});

test("resuming a stored session restores the exact context prefix and appends to that session", async () => {
  dirs = await tempDirs();
  const reply = fauxAssistantMessage("first reply", { timestamp: 1234 });
  const fake = fakeModel([reply, fauxAssistantMessage("second reply")]);
  const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake });
  const prompt = "first prompt\n<system-reminder>keep this verbatim</system-reminder>";
  await session.run(prompt);
  await session.run("second prompt");
  const expectedPrefix = structuredClone(fake.contexts[1]!.messages);

  const next = fakeModel([fauxAssistantMessage("resumed reply")]);
  const resumed = await createSession({
    cwd: dirs.cwd,
    homeDir: dirs.homeDir,
    ...next,
    resumeId: session.id,
  });
  await resumed.run("third prompt");

  expect(resumed.id).toBe(session.id);
  expect(next.contexts[0]!.messages.slice(0, -2)).toEqual(expectedPrefix);
  expect(next.contexts[0]!.messages.at(-2)).toMatchObject({
    role: "assistant",
    content: [{ type: "text", text: "second reply" }],
  });
  expect(next.contexts[0]!.messages.at(-1)).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "third prompt" }],
  });
});

test("an unknown resume id fails without calling the model", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("unused")]);
  await expect(
    createSession({
      cwd: dirs.cwd,
      homeDir: dirs.homeDir,
      ...fake,
      resumeId: "missing",
    }),
  ).rejects.toThrow("Session not found: missing");
  expect(fake.contexts).toHaveLength(0);
});

test("a supplied pi repo can persist and resume without the JSONL backend", async () => {
  dirs = await tempDirs();
  const store = new MemorySessionRepo();
  const fake = fakeModel([fauxAssistantMessage("stored reply")]);
  const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, store, ...fake });
  await session.run("stored prompt");
  const next = fakeModel([fauxAssistantMessage("next reply")]);
  const resumed = await createSession({
    cwd: dirs.cwd,
    homeDir: dirs.homeDir,
    store,
    ...next,
    resumeId: session.id,
  });
  await resumed.run("next prompt");
  expect(next.contexts[0]!.messages).toMatchObject([
    { role: "user", content: [{ type: "text", text: "stored prompt" }] },
    { role: "assistant", content: [{ type: "text", text: "stored reply" }] },
    { role: "user", content: [{ type: "text", text: "next prompt" }] },
  ]);
});

test("an aborted Run persists the user message and partial assistant output before rejecting", async () => {
  dirs = await tempDirs();
  const fake = abortingModel();
  const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake });
  const controller = new AbortController();
  const run = session.run("interrupted prompt", { signal: controller.signal });
  // Bun's rejects matcher waits eagerly; attach a handler while arranging the abort.
  void run.catch(() => {});
  await fake.started;
  controller.abort();
  await expect(run).rejects.toThrow();

  const next = fakeModel([fauxAssistantMessage("continued")]);
  const resumed = await createSession({
    cwd: dirs.cwd,
    homeDir: dirs.homeDir,
    ...next,
    resumeId: session.id,
  });
  await resumed.run("continue");
  expect(next.contexts[0]!.messages).toMatchObject([
    { role: "user", content: [{ type: "text", text: "interrupted prompt" }] },
    {
      role: "assistant",
      content: [{ type: "text", text: "partial output" }],
      stopReason: "aborted",
    },
    { role: "user", content: [{ type: "text", text: "continue" }] },
  ]);
});
