import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import type { Storage } from "@earendil-works/pi-durable";
import { join } from "node:path";
import {
  createJsonlStore,
  createSession as createSessionImpl,
  type Session,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { crashedSubagents, runRequest } from "../helpers/crashed-subagents.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
function childIds(session: Session) {
  const children = session.toolState("subagents");
  if (!Array.isArray(children)) throw new Error("Subagent identities are missing");
  return children.map((value: unknown) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("id" in value) ||
      typeof value.id !== "string"
    )
      throw new Error("Invalid committed subagent identity");
    return value.id;
  });
}
async function createSession(options: Parameters<typeof createSessionImpl>[0]) {
  const session = await createSessionImpl(options);
  sessions.push(session);
  return session;
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await dirs?.cleanup();
});

test.each(["completed", "aborted", "error"] as const)(
  "cold observation preserves committed child %s without authorizing another Run",
  async (outcome) => {
    dirs = await tempDirs();
    const fixture = await crashedSubagents(dirs);
    const child = await fixture.child("Settled", outcome);
    await fixture.save();
    const fake = fakeModel([fauxAssistantMessage("new answer")]);
    const restored = await createSession({ ...dirs, ...fake, resumeId: fixture.parentId });
    expect(fake.contexts).toHaveLength(0);
    expect(restored.toolState("subagents")).toMatchObject([
      { id: child.metadata.id, active: false, latestRun: { id: child.run.id, outcome } },
    ]);
    expect(restored.checkpoints()).toHaveLength(1);
    await restored.run("new accepted work");
    expect(fake.contexts).toHaveLength(1);
    expect(restored.checkpoints()).toHaveLength(2);
    expect(restored.toolState("subagents")).toMatchObject([
      { id: child.metadata.id, active: false, latestRun: { id: child.run.id, outcome } },
    ]);
  },
);

test("close waits for an active child provider, then cold resume continues the same accepted work", async () => {
  dirs = await tempDirs();
  const entered = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const reply: Parameters<typeof fakeModel>[0][number] = async (context, options) => {
    if (
      getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
        (tool) => tool.name === "subagent",
      )
    )
      return fauxAssistantMessage("parent idle");
    entered.resolve();
    if (!options?.signal) throw new Error("native child provider lacks cancellation signal");
    if (!options.signal.aborted)
      await new Promise<void>((resolve) =>
        options.signal!.addEventListener("abort", () => resolve(), { once: true }),
      );
    cancelled.resolve();
    await release.promise;
    return fauxAssistantMessage("", { stopReason: "aborted" });
  };
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", { description: "Active", prompt: "accepted child work" }),
      { stopReason: "toolUse" },
    ),
    reply,
    reply,
  ]);
  const session = await createSession({ ...dirs, ...fake });
  let closing: Promise<void> | undefined;
  try {
    expect(await session.run("delegate")).toMatchObject({ text: "parent idle" });
    await entered.promise;
    const requestId = session.currentRequestId;
    if (!requestId) throw new Error("accepted parent request is missing");
    const identities = childIds(session);
    let closed = false;
    closing = session.close().then(() => {
      closed = true;
    });
    await cancelled.promise;
    expect(closed).toBe(false);
    release.resolve();
    await closing;
    const replies = fakeModel(
      Array.from(
        { length: 5 },
        () => (context) =>
          fauxAssistantMessage(
            getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
              (tool) => tool.name === "subagent",
            )
              ? "parent restored"
              : "child restored",
          ),
      ),
    );
    const restored = await createSession({ ...dirs, ...replies, resumeId: session.id });
    expect(await restored.waitForRequest(requestId)).toMatchObject({
      success: true,
      text: "parent restored",
    });
    const children = restored.toolState("subagents");
    expect(children).toHaveLength(1);
    expect(children).toMatchObject([{ active: false, latestRun: { outcome: "completed" } }]);
    expect(childIds(restored)).toEqual(identities);
    expect(
      replies.contexts.filter(
        (context) =>
          !getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
            (tool) => tool.name === "subagent",
          ),
      ),
    ).toHaveLength(1);
    expect(
      restored.messages.filter(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("(Active) finished."),
      ),
    ).toHaveLength(1);
  } finally {
    release.resolve();
    await closing;
  }
});

test.each(["child-answer", "parent-notification"] as const)(
  "failed %s commit leaves only committed facts and cold recovery settles the original child once",
  async (phase) => {
    dirs = await tempDirs();
    const store = createJsonlStore(dirs);
    let reject = true;
    const failingStore = {
      ...store,
      async open(...args: Parameters<typeof store.open>) {
        const lease = await store.open(...args);
        return {
          ...lease,
          storage: new Proxy(lease.storage, {
            get(target, key) {
              if (key === "commit")
                return async (...args: Parameters<Storage["commit"]>) => {
                  const hit = args[0].some(
                    (write) =>
                      write.type === "entry" &&
                      write.value.model?.some((message) =>
                        phase === "child-answer"
                          ? message.role === "assistant" &&
                            JSON.stringify(message.content).includes("saved child answer")
                          : message.role === "user" &&
                            JSON.stringify(message.content).includes("(Fault child) finished."),
                      ),
                  );
                  if (reject && hit) {
                    reject = false;
                    throw new Error(`injected ${phase} failure`);
                  }
                  return target.commit(...args);
                };
              const value = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            },
          }),
        };
      },
    };
    const reply: Parameters<typeof fakeModel>[0][number] = (context) =>
      fauxAssistantMessage(
        getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
          (tool) => tool.name === "subagent",
        )
          ? "parent settled"
          : "saved child answer",
      );
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", { description: "Fault child", prompt: "accepted fault child" }),
        { stopReason: "toolUse" },
      ),
      ...Array.from({ length: 5 }, () => reply),
    ]);
    const session = await createSession({ ...dirs, ...fake, store: failingStore, onWarning() {} });
    await expect(runRequest(session, "delegate")).rejects.toThrow(`injected ${phase} failure`);
    expect(reject).toBe(false);
    const requestId = session.currentRequestId;
    if (!requestId) throw new Error("accepted request lost before failed commit");
    const childId = childIds(session)[0];
    expect(childId).toBeDefined();
    expect(
      session.messages.filter(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("(Fault child) finished."),
      ),
    ).toHaveLength(0);
    await session.close();
    const replies = fakeModel(Array.from({ length: 6 }, () => reply));
    const restored = await createSession({ ...dirs, ...replies, store, resumeId: session.id });
    expect(await restored.waitForRequest(requestId)).toMatchObject({
      success: true,
      text: "parent settled",
    });
    expect(restored.toolState("subagents")).toMatchObject([
      { id: childId, active: false, latestRun: { outcome: "completed" } },
    ]);
    expect(
      restored.messages.filter(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("(Fault child) finished."),
      ),
    ).toHaveLength(1);
    expect(
      replies.contexts.filter(
        (context) =>
          !getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
            (tool) => tool.name === "subagent",
          ),
      ),
    ).toHaveLength(phase === "child-answer" ? 1 : 0);
    await restored.close();
    const untouched = fakeModel([]);
    const again = await createSession({ ...dirs, ...untouched, store, resumeId: session.id });
    expect(await again.waitForRequest(requestId)).toMatchObject({ success: true });
    expect(untouched.contexts).toHaveLength(0);
    expect(again.toolState("subagents")).toHaveLength(1);
  },
);

test("resume Hook autoruns do not create Human Prompt Checkpoints; blocked prompts remain unaccepted", async () => {
  dirs = await tempDirs();
  const original = await createSession({ ...dirs, ...fakeModel([]) });
  await original.close();
  const finished = Promise.withResolvers<void>();
  const fake = fakeModel([
    fauxAssistantMessage("internal hook answer"),
    fauxAssistantMessage("real answer"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    resumeId: original.id,
    settings: {
      hooks: {
        SessionStart: [
          {
            matcher: "resume",
            hooks: [
              {
                type: "command",
                command: "printf 'internal startup work' >&2; exit 2",
                asyncRewake: true,
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: `cat >/dev/null; if [ ! -f attempted ]; then touch attempted; printf '{"decision":"block","reason":"rejected first prompt"}'; fi`,
              },
            ],
          },
        ],
      },
    },
  });
  session.subscribe((event) => {
    if (event.type === "result") finished.resolve();
  });
  await finished.promise;
  await session.waitForIdle();
  expect(fake.contexts).toHaveLength(1);
  expect(JSON.stringify(fake.contexts[0]!.messages)).toContain("internal startup work");
  expect(session.checkpoints()).toHaveLength(0);
  expect(await session.run("rejected real prompt")).toMatchObject({ stopReason: "hook_blocked" });
  expect(session.checkpoints()).toHaveLength(0);
  expect(fake.contexts).toHaveLength(1);
  await session.run("accepted real prompt");
  expect(session.checkpoints()).toHaveLength(1);
  expect(fake.contexts).toHaveLength(2);
});

test("close waits for Hook autorun cancellation and preserves its accepted input for cold recovery", async () => {
  dirs = await tempDirs();
  const original = await createSession({ ...dirs, ...fakeModel([]) });
  await original.close();
  const started = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fake = fakeModel([
    async (_context, options) => {
      started.resolve();
      if (!options?.signal) throw new Error("Hook autorun lacks a cancellation signal");
      if (!options.signal.aborted)
        await new Promise<void>((resolve) =>
          options.signal!.addEventListener("abort", () => resolve(), { once: true }),
        );
      aborted.resolve();
      await release.promise;
      return fauxAssistantMessage("", { stopReason: "aborted" });
    },
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    resumeId: original.id,
    settings: {
      hooks: {
        SessionStart: [
          {
            matcher: "resume",
            hooks: [
              {
                type: "command",
                command: "printf 'accepted internal follow-up' >&2; exit 2",
                asyncRewake: true,
              },
            ],
          },
        ],
      },
    },
  });
  let closing: Promise<void> | undefined;
  try {
    await started.promise;
    expect(session.checkpoints()).toHaveLength(0);
    let closed = false;
    closing = session.close().then(() => {
      closed = true;
    });
    await aborted.promise;
    expect(closed).toBe(false);
    release.resolve();
    await closing;
    const replies = fakeModel([fauxAssistantMessage("internal work recovered")]);
    const restored = await createSession({ ...dirs, ...replies, resumeId: session.id });
    await restored.waitForIdle();
    expect(replies.contexts).toHaveLength(1);
    expect(JSON.stringify(replies.contexts[0]!.messages)).toContain("accepted internal follow-up");
    expect(restored.checkpoints()).toHaveLength(0);
    await restored.close();
    const untouched = fakeModel([]);
    await createSession({ ...dirs, ...untouched, resumeId: session.id });
    expect(untouched.contexts).toHaveLength(0);
  } finally {
    release.resolve();
    await closing;
  }
});

test("completed child resume keeps authorized file Checkpoints without executing historic work", async () => {
  dirs = await tempDirs();
  const first = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Complete",
        prompt: "work",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("child done"),
    fauxAssistantMessage("parent done"),
  ]);
  const original = await createSession({ ...dirs, ...first });
  await original.run("delegate");
  await original.close();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("write", { path: "new.txt", content: "new work" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const resumed = await createSession({
    ...dirs,
    ...fake,
    resumeId: original.id,
    permissionMode: "full-access",
  });
  expect(fake.contexts).toHaveLength(0);
  await resumed.run("write new work");
  expect(JSON.stringify(fake.contexts)).not.toContain("Session Resume:");
  expect(resumed.checkpoints()).toHaveLength(2);
  await resumed.rewind(resumed.checkpoints()[1]!.promptEntryId, { code: true, conversation: true });
  expect(await Bun.file(join(dirs.cwd, "new.txt")).exists()).toBe(false);
  await resumed.close();
});
