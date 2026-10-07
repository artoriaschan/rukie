import { join } from "node:path";
import { withModelStream, withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";
import { afterEach, expect, test } from "bun:test";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createSession as createSessionImpl,
  createJsonlStore,
  type Session,
  type SessionStore,
  type SessionEvent,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { abortingModel } from "../helpers/aborting-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
const storages: MemoryStorage[] = [];
async function createSession(options: Parameters<typeof createSessionImpl>[0]) {
  const session = await createSessionImpl(options);
  sessions.push(session);
  return session;
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await Promise.all(storages.splice(0).map((storage) => storage.close(BACKGROUND_CONTEXT)));
  await dirs?.cleanup();
});

test("a run sends the prompt to the model and returns the final assistant text", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("hello back")]);
  const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, ...fake });

  const result = await session.run("hello");

  expect(result.text).toBe("hello back");
  expect(fake.contexts).toHaveLength(1);
  expect(fake.contexts[0]!.messages.findLast((message) => message.role === "user")).toMatchObject({
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

test("the Run result totals every Turn and publishes execution facts for its registered tool", async () => {
  dirs = await tempDirs();
  const first = fauxAssistantMessage(fauxToolCall("read", { path: "a.ts" }, { id: "call-1" }), {
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
  fake.models = withModelStream(
    fake.models,
    withAuxiliaryRequests((_model, context) => {
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
    }),
  );
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
    requestId: expect.stringMatching(/^human:/),
    usage: { input: 30, output: 7, cacheRead: 7, cacheWrite: 1, totalTokens: 45 },
  });
  expect(events.find((event) => event.type === "run_start")).toMatchObject({
    type: "run_start",
    sessionId: session.id,
  });
  expect(events.find((event) => event.type === "result")).toMatchObject({
    type: "result",
    sessionId: session.id,
    ...result,
  });
  expect(events.find((event) => event.type === "tool_execution_start")).toMatchObject({
    type: "tool_execution_start",
    sessionId: session.id,
    toolCallId: "call-1",
    toolName: "read",
    args: { path: join(dirs.cwd, "a.ts") },
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
  ).rejects.toThrow("Model response ended with stop reason error");
  expect(events.find((event) => event.type === "result")).toMatchObject({
    type: "result",
    sessionId: session.id,
    success: false,
    text: "partial",
    error: "Model response ended with stop reason error",
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
  const expectedPrefix = structuredClone(
    fake.contexts[1]!.messages.filter((message) => message.role !== "system"),
  );
  await session.close();

  const next = fakeModel([fauxAssistantMessage("resumed reply")]);
  const resumed = await createSession({
    cwd: dirs.cwd,
    homeDir: dirs.homeDir,
    ...next,
    resumeId: session.id,
  });
  expect(next.contexts).toHaveLength(0);
  expect(resumed.messages).toEqual(session.messages);
  expect(
    resumed.messages.filter((message) => message.role === "user" || message.role === "assistant"),
  ).toMatchObject([
    { role: "user", content: [{ type: "text", text: prompt }] },
    { role: "assistant", content: [{ type: "text", text: "first reply" }] },
    { role: "user", content: [{ type: "text", text: "second prompt" }] },
    { role: "assistant", content: [{ type: "text", text: "second reply" }] },
  ]);
  await resumed.run("third prompt");

  expect(resumed.id).toBe(session.id);
  const visible = next.contexts[0]!.messages.filter((message) => message.role !== "system");
  expect(visible.slice(0, -2)).toEqual(expectedPrefix);
  expect(visible.at(-2)).toMatchObject({
    role: "assistant",
    content: [{ type: "text", text: "second reply" }],
  });
  expect(visible.at(-1)).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "third prompt" }],
  });
  expect(resumed.messages.slice(-2)).toMatchObject([
    { role: "user", content: [{ type: "text", text: "third prompt" }] },
    { role: "assistant", content: [{ type: "text", text: "resumed reply" }] },
  ]);
  await resumed.close();
  const reopened = await createSession({ ...dirs, ...next, resumeId: session.id });
  expect(reopened.messages).toEqual(resumed.messages);
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
  ).rejects.toMatchObject({
    code: "session-not-found",
    params: { id: "missing" },
    message: "Session not found: missing",
  });
  expect(fake.contexts).toHaveLength(0);
});

test("a supplied native MemoryStorage can persist and resume across host leases", async () => {
  dirs = await tempDirs();
  const storage = new MemoryStorage();
  storages.push(storage);
  const id = crypto.randomUUID();
  const retained = new Proxy(storage, {
    get(target, key) {
      if (key === "close") return async () => {};
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const store: SessionStore = {
    key: (sessionId) => `${id}:${sessionId}`,
    open: async () => ({ id, storage: retained, release: async () => {} }),
    list: async () => [],
  };
  const fake = fakeModel([fauxAssistantMessage("stored reply")]);
  const session = await createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, store, ...fake });
  await session.run("stored prompt");
  await session.close();
  const next = fakeModel([fauxAssistantMessage("next reply")]);
  const resumed = await createSession({
    cwd: dirs.cwd,
    homeDir: dirs.homeDir,
    store,
    ...next,
    resumeId: session.id,
  });
  await resumed.run("next prompt");
  expect(next.contexts[0]!.messages.filter((message) => message.role !== "system")).toMatchObject([
    ...fake.contexts[0]!.messages.filter((message) => message.role !== "system"),
    { role: "assistant", content: [{ type: "text", text: "stored reply" }] },
    { role: "user", content: [{ type: "text", text: "next prompt" }] },
  ]);
});

test("an aborted Run preserves admitted input without treating live partial output as committed history", async () => {
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

  await session.close();
  const next = fakeModel([fauxAssistantMessage("continued")]);
  const resumed = await createSession({
    cwd: dirs.cwd,
    homeDir: dirs.homeDir,
    ...next,
    resumeId: session.id,
  });
  expect(JSON.stringify(resumed.messages)).not.toContain("partial output");
  await resumed.run("continue");
  expect(next.contexts[0]!.messages.filter((message) => message.role !== "system")).toMatchObject([
    {
      role: "user",
      content: [{ type: "text", text: expect.stringContaining("<system-reminder>\ncwd:") }],
    },
    {
      role: "user",
      content: [
        { type: "text", text: expect.stringContaining("<system-reminder>\nCurrent date:") },
      ],
    },
    {
      role: "user",
      content: [
        { type: "text", text: "<system-reminder>\nAvailable skills: none.\n</system-reminder>" },
      ],
    },
    { role: "user", content: [{ type: "text", text: "interrupted prompt" }] },
    { role: "user", content: [{ type: "text", text: "continue" }] },
  ]);
});

test("public idle waits for the owned foreground receipt commit before accepting another Run", async () => {
  dirs = await tempDirs();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const base = createJsonlStore(dirs);
  const store: SessionStore = {
    ...base,
    async open(input, context) {
      const lease = await base.open(input, context);
      const commit = lease.storage.commit.bind(lease.storage);
      let held = false;
      lease.storage.commit = async (writes, context) => {
        if (
          !held &&
          writes.some((write) => write.type === "entry" && write.value.kind === "rukie.run-summary")
        ) {
          held = true;
          entered.resolve();
          await release.promise;
        }
        return commit(writes, context);
      };
      return lease;
    },
  };
  const fake = fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
  const session = await createSession({ ...dirs, ...fake, store });
  const run = session.run("first");
  try {
    await entered.promise;
    expect(session.running).toBe(true);
    let idleSettled = false;
    const idle = session.waitForIdle().then(() => {
      idleSettled = true;
    });
    await Promise.resolve();
    expect(idleSettled).toBe(false);
    release.resolve();
    expect((await run).text).toBe("first");
    await idle;
    expect(session.running).toBe(false);
    expect((await session.run("second")).text).toBe("second");
  } finally {
    release.resolve();
    await run.catch(() => {});
  }
});
