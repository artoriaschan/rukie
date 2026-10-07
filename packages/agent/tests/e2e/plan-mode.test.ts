import { afterEach, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createSession as createNativeSession,
  ROOT_CONVERSATION_ID,
  defineDoc,
} from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import { planState } from "../../src/tools/plan-mode/state.ts";
import { withModelAlias } from "../helpers/auxiliary-model.ts";
import {
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentTools,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
  createJsonlStore,
  createSession as createSessionImpl,
  type Session,
  type SessionEvent,
  type SessionStore,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
async function createSession(options: Parameters<typeof createSessionImpl>[0]) {
  const session = await createSessionImpl(options);
  sessions.push(session);
  return session;
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await dirs?.cleanup();
});
function reminders(events: readonly SessionEvent[]) {
  return events.flatMap((event) =>
    event.type === "message_end"
      ? event.messages.flatMap((message) =>
          message.role === "system-reminder" && message.source === "plan-mode"
            ? [message.content]
            : [],
        )
      : [],
  );
}
/** Hold or reject actual native Plan document commits, without replacing Harness execution. */
function planWrites(
  backing: SessionStore,
  before: (index: number) => void | Promise<void>,
  closed?: () => void,
): SessionStore {
  let index = 0;
  return {
    ...backing,
    async open(...args) {
      const lease = await backing.open(...args);
      const docs = await lease.storage.scanDocuments(
        { scope: { kind: "conversation", conversationId: ROOT_CONVERSATION_ID }, at: "current" },
        10000,
        undefined,
        BACKGROUND_CONTEXT,
      );
      const ids = new Set(
        docs.items.filter((doc) => doc.kind === "rukie.plan").map((doc) => doc.id),
      );
      const commit = lease.storage.commit.bind(lease.storage);
      lease.storage.commit = async (writes, context) => {
        const creates = writes.filter(
          (write) => write.type === "document.create" && write.record.kind === "rukie.plan",
        );
        if (
          writes.some((write) =>
            write.type === "document.create"
              ? write.record.kind === "rukie.plan"
              : write.type === "document.change" && ids.has(write.id),
          )
        )
          await before(index++);
        const result = await commit(writes, context);
        for (const write of creates) if (write.type === "document.create") ids.add(write.record.id);
        return result;
      };
      const close = lease.storage.close.bind(lease.storage);
      lease.storage.close = async (context) => {
        await close(context);
        closed?.();
      };
      return lease;
    },
  };
}
async function writePlanDocument(id: string, value: JsonValue) {
  const lease = await createJsonlStore(dirs).open({ id }, BACKGROUND_CONTEXT);
  const native = createNativeSession(lease.storage);
  try {
    await native.commit(async (tx) => {
      (await tx.doc(planState.document, ROOT_CONVERSATION_ID)).value = value;
    }, BACKGROUND_CONTEXT);
  } finally {
    await native.close(BACKGROUND_CONTEXT);
    await lease.release();
  }
}

test("Plan Mode persists outside a Run and injects changed guidance once", async () => {
  dirs = await tempDirs();
  const fake = fakeModel(Array.from({ length: 5 }, () => fauxAssistantMessage("done")));
  const session = await createSession({ ...dirs, ...fake });
  expect(session.planMode).toBe(false);
  await session.run("ordinary");
  expect(JSON.stringify(fake.contexts[0])).not.toContain("Plan Mode");
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  await session.setPlanMode(true);
  expect(session.planMode).toBe(true);
  expect(session.toolState("plan")).toEqual({ active: true });
  await session.run("plan");
  expect(JSON.stringify(fake.contexts[1])).toContain("You are in Plan Mode");
  expect(JSON.stringify(fake.contexts[1])).toContain("markdown");
  expect(JSON.stringify(fake.contexts[1])).toContain("Permissions still apply");
  const next = fakeModel(Array.from({ length: 3 }, () => fauxAssistantMessage("resumed")));
  await session.close();
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  resumed.subscribe((event) => {
    if (event.type === "tool_state_changed") events.push(event);
  });
  expect(resumed.planMode).toBe(true);
  await resumed.run("continue planning");
  expect(JSON.stringify(next.contexts[0])).toContain("You are in Plan Mode");
  expect(JSON.stringify(next.contexts[0])).toContain(
    "give the plan directly as text in your final response",
  );
  // Continue with the resumed handle so the append-only transcript has one writer.

  await resumed.setPlanMode(false);
  await resumed.run("execute", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  await resumed.run("again", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(reminders(events)).toEqual([
    expect.stringContaining("You are in Plan Mode"),
    expect.stringContaining("You have exited Plan Mode"),
  ]);
  expect(
    events.flatMap((event) =>
      event.type === "tool_state_changed" && event.name === "plan" ? [event.value] : [],
    ),
  ).toEqual([{ active: true }, { active: false }]);
});

test("switching during a Run affects the next model call and repeated changes are idempotent", async () => {
  dirs = await tempDirs();
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fake = fakeModel([
    async () => {
      ready.resolve();
      await release.promise;
      return fauxAssistantMessage(fauxToolCall("todo_write", { todos: [] }), {
        stopReason: "toolUse",
      });
    },
    (context) => {
      expect(JSON.stringify(context)).toContain("You are in Plan Mode");
      return fauxAssistantMessage(fauxToolCall("todo_write", { todos: [] }), {
        stopReason: "toolUse",
      });
    },
    (context) => {
      expect(JSON.stringify(context.messages)).toContain("You have exited Plan Mode");
      return fauxAssistantMessage("done");
    },
  ]);
  const session = await createSession({ ...dirs, ...fake });
  const events: SessionEvent[] = [];
  let tools = 0;
  const run = session.run("work", {
    onEvent: async (event) => {
      events.push(structuredClone(event));
      if (event.type === "tool_execution_end" && ++tools === 2) {
        await session.setPlanMode(false);
        await session.setPlanMode(false);
      }
    },
  });
  await ready.promise;
  await session.setPlanMode(true);
  await session.setPlanMode(true);
  expect(JSON.stringify(fake.contexts[0])).not.toContain("Plan Mode");
  release.resolve();
  await run;
  expect(
    events.flatMap((event) =>
      event.type === "tool_state_changed" && event.name === "plan" ? [event.value] : [],
    ),
  ).toEqual([{ active: true }, { active: false }]);
});

test.each(["subagent", "subagent_fork"])(
  "%s reads the parent's live Plan Mode without its own state snapshot",
  async (toolName) => {
    dirs = await tempDirs();
    const childReady = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall(toolName, {
          description: "Inspect",
          prompt: "child",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      async (context) => {
        expect(JSON.stringify(context)).toContain("You are in Plan Mode");
        childReady.resolve();
        await release.promise;
        return fauxAssistantMessage(fauxToolCall("todo_write", { todos: [] }), {
          stopReason: "toolUse",
        });
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("You have exited Plan Mode");
        return fauxAssistantMessage("child done");
      },
      fauxAssistantMessage("parent done"),
    ]);
    const session = await createSession({ ...dirs, ...fake });
    await session.setPlanMode(true);
    const childEvents: SessionEvent[] = [];
    const run = session.run("delegate", {
      onEvent: (event) => {
        if (event.type === "subagent_event") childEvents.push(event.event);
      },
    });
    await childReady.promise;
    await session.setPlanMode(false);
    release.resolve();
    await run;
    expect(
      childEvents.some((event) => event.type === "tool_state_changed" && event.name === "plan"),
    ).toBe(false);
  },
);

test.each(["ask", "auto-review", "full-access"] as const)(
  "Plan Mode preserves bash/edit rules and permission mode in %s",
  async (permissionMode) => {
    dirs = await tempDirs();
    await Bun.write(`${dirs.cwd}/file.txt`, "before");
    const fake = fakeModel([
      fauxAssistantMessage(
        [
          fauxToolCall("bash", { description: "Run test command", command: "printf allowed" }),
          fauxToolCall("edit", {
            path: "file.txt",
            edits: [{ oldText: "before", newText: "after" }],
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    let asked = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode,
      settings: { permissions: { allow: ["bash"], ask: ["edit"] } },
      onPermissionAsk: async () => {
        asked++;
        return "deny";
      },
    });
    await session.setPlanMode(true);
    await session.run("inspect");
    expect(asked).toBe(1);
    expect(session.permissionMode).toBe(permissionMode);
    expect(
      fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([
      { toolName: "bash", isError: false },
      { toolName: "edit", isError: true },
    ]);
    expect(await Bun.file(`${dirs.cwd}/file.txt`).text()).toBe("before");
  },
);

test("Compaction re-injects active guidance and never repeats a consumed exit reminder", async () => {
  dirs = await tempDirs();
  await Bun.write(`${dirs.cwd}/large.txt`, "older evidence ".repeat(6000));
  const work = () =>
    fauxAssistantMessage(
      [fauxToolCall("read", { path: "large.txt" }), fauxToolCall("read", { path: "large.txt" })],
      { stopReason: "toolUse" },
    );
  const fake = fakeModel([
    work(),
    fauxAssistantMessage("older"),
    fauxAssistantMessage("protected"),
    fauxAssistantMessage("First summary."),
    fauxAssistantMessage("continued"),
    fauxAssistantMessage("execute"),
    work(),
    fauxAssistantMessage("older again"),
    fauxAssistantMessage("protected again"),
    fauxAssistantMessage("Second summary."),
    fauxAssistantMessage("done"),
  ]);
  const models = withModelAlias(fake.models, "plan-window", ["large"], { contextWindow: 128000 });
  const provider = models.getProviders().find((provider) => provider.id === "plan-window");
  const large = provider?.getModels()[0];
  if (!provider || !large) throw new Error("Missing fixture model");
  models.setProvider({
    ...provider,
    getModels: () => [large, { ...large, id: "small", contextWindow: 16000 }],
  });
  const session = await createSession({
    ...dirs,
    ...fake,
    models,
    settings: { model: "plan-window/large" },
  });
  await session.setPlanMode(true);
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  await session.run("older");
  await session.run("protected");
  await session.setModel("plan-window/small");
  await session.run("continue");
  expect(reminders(events).filter((text) => text.includes("You are in Plan Mode"))).toHaveLength(2);
  expect(JSON.stringify(fake.contexts.at(-1))).toContain("You are in Plan Mode");
  await session.setPlanMode(false);
  await session.run("execute");
  await session.setModel("plan-window/large");
  await session.run("older again");
  await session.run("protected again");
  await session.setModel("plan-window/small");
  await session.run("more");
  expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(2);
  expect(reminders(events).filter((text) => text.includes("exited"))).toHaveLength(1);
});

test("rewind restores Plan Mode at the selected public checkpoint", async () => {
  dirs = await tempDirs();
  const session = await createSession({
    ...dirs,
    ...fakeModel([fauxAssistantMessage("planning"), fauxAssistantMessage("executing")]),
  });
  await session.setPlanMode(true);
  await session.run("plan");
  await session.setPlanMode(false);
  await session.run("execute");
  await session.rewind(session.checkpoints()[0]!.promptEntryId, {
    code: false,
    conversation: true,
  });
  expect(session.planMode).toBe(true);
  await session.close();
  const fake = fakeModel([fauxAssistantMessage("planning")]);
  const resumed = await createSession({ ...dirs, ...fake, resumeId: session.id });
  expect(resumed.planMode).toBe(true);
  await resumed.run("continue");
  expect(JSON.stringify(fake.contexts[0])).toContain("You are in Plan Mode");
});

test("frontend can await a second Plan Mode change from its state event", async () => {
  dirs = await tempDirs();
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(fauxToolCall("todo_write", { todos: [] }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]),
  });
  const values: unknown[] = [];
  await session.run("plan", {
    onEvent: async (event) => {
      if (event.type === "tool_execution_end") await session.setPlanMode(true);
      if (event.type !== "tool_state_changed" || event.name !== "plan") return;
      values.push(event.value);
      if (
        typeof event.value === "object" &&
        event.value !== null &&
        "active" in event.value &&
        event.value.active === true
      )
        await session.setPlanMode(false);
    },
  });
  expect(values).toEqual([{ active: true }, { active: false }]);
  expect(session.planMode).toBe(false);
}, 1000);

test("a rejected native Plan document rolls back and can be retried after cold reopen", async () => {
  dirs = await tempDirs();
  let reject = true;
  let closed = 0;
  const store = planWrites(
    createJsonlStore(dirs),
    () => {
      if (reject) {
        reject = false;
        throw new Error("snapshot unavailable");
      }
    },
    () => closed++,
  );
  const session = await createSession({ ...dirs, ...fakeModel([]), store });
  await expect(session.setPlanMode(true)).rejects.toThrow("snapshot unavailable");
  expect(session.planMode).toBe(false);
  await session.close();
  expect(closed).toBeGreaterThan(0);
  const resumed = await createSession({
    ...dirs,
    ...fakeModel([fauxAssistantMessage("retried")]),
    store,
    resumeId: session.id,
  });
  expect(resumed.planMode).toBe(false);
  await resumed.setPlanMode(true);
  expect((await resumed.run("retry")).success).toBe(true);
  await resumed.close();
  const saved = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(saved.planMode).toBe(true);
});

test.each([0, 1])(
  "queued Plan revisions preserve their last durable state after rejection %i",
  async (failedIndex) => {
    dirs = await tempDirs();
    const store = planWrites(createJsonlStore(dirs), (index) => {
      if (index === failedIndex) throw new Error("snapshot unavailable");
    });
    const session = await createSession({ ...dirs, ...fakeModel([]), store });
    const entered = session.setPlanMode(true);
    const exited = session.setPlanMode(false);
    const results = await Promise.allSettled([entered, exited]);
    expect(results[failedIndex]!.status).toBe("rejected");
    if (failedIndex === 0) expect(results[1]!.status).toBe("rejected");
    else expect(results[0]!.status).toBe("fulfilled");
    expect(session.planMode).toBe(failedIndex === 1);
    await session.close();
    const resumed = await createSession({
      ...dirs,
      ...fakeModel([fauxAssistantMessage("continued")]),
      resumeId: session.id,
    });
    expect(resumed.planMode).toBe(failedIndex === 1);
    await resumed.setPlanMode(failedIndex === 0);
    await resumed.run("continue");
    expect(resumed.planMode).toBe(failedIndex === 0);
  },
);

test("a child continued after a parent rewind reads the projected Plan Mode without its own snapshot", async () => {
  dirs = await tempDirs();
  let childId = "";
  let childContext: unknown;
  const childPlanEvents: SessionEvent[] = [];
  const childResult = Promise.withResolvers<void>();
  /** Only the parent declares the subagent tools, so a request identifies its Session. */
  const isChildRequest = (context: TranscriptContext) =>
    !getCurrentTools(context.messages).some((tool) => tool.name === "subagent");
  // The parent's closing answer waits for the child's result event, so the parent Run
  // stays active and the child's completion is observed instead of guessed.
  const continued = async (context: TranscriptContext) => {
    if (isChildRequest(context)) {
      childContext = structuredClone(context.messages);
      return fauxAssistantMessage("second child answer");
    }
    await childResult.promise;
    return fauxAssistantMessage("parent finished");
  };
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Inspect",
        prompt: "child",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("first child answer"),
    fauxAssistantMessage("first done"),
    fauxAssistantMessage("second done"),
    (context: TranscriptContext) =>
      isChildRequest(context)
        ? fauxAssistantMessage("second child answer")
        : fauxAssistantMessage(
            fauxToolCall("send_message", { agent_id: childId, message: "continue the inspection" }),
            { stopReason: "toolUse" },
          ),
    continued,
    continued,
    continued,
  ]);
  const session = await createSession({ ...dirs, ...fake });
  const childIds = new Set<string>();
  const onEvent = (event: SessionEvent) => {
    if (event.type !== "subagent_event") return;
    if (event.event.type === "snapshot") childIds.add((childId = event.agentId));
    if (event.event.type === "run_end") childResult.resolve();
    if (event.event.type === "tool_state_changed" && event.event.name === "plan")
      childPlanEvents.push(event.event);
  };
  session.subscribe(onEvent);
  const first = await session.run("first");
  await session.waitForRequest(first.requestId);
  expect(session.toolState("subagents")).toMatchObject([{ id: childId, description: "Inspect" }]);
  // Entering Plan Mode after the child exists and leaving it again makes the rewind
  // change the state a continued child has to project.
  await session.setPlanMode(true);
  await session.run("second", { onEvent });
  expect(session.toolState("subagents")).toMatchObject([{ id: childId, description: "Inspect" }]);
  await session.setPlanMode(false);
  await session.rewind(session.checkpoints()[1]!.promptEntryId, {
    code: false,
    conversation: true,
  });
  // The rewind restored the Plan Mode snapshot recorded before the second prompt.
  expect(session.planMode).toBe(true);
  expect(session.toolState("subagents")).toMatchObject([
    { id: childId, description: "Inspect", type: "general-purpose" },
  ]);
  const continuedRun = await session.run("continue the child");
  await session.waitForRequest(continuedRun.requestId);
  // The parent addressed the child Session that already existed, not a new one.
  expect([...childIds]).toEqual([childId]);
  expect(
    session.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "send_message",
    ),
  ).toMatchObject({
    isError: false,
    content: [{ type: "text", text: expect.stringContaining(childId) }],
  });
  expect(childContext).toBeDefined();
  expect(JSON.stringify(childContext)).toContain("You are in Plan Mode");
  expect(JSON.stringify(childContext)).toContain(
    "give the plan directly as text in your final response",
  );
  expect(JSON.stringify(childContext)).not.toContain("You have exited Plan Mode");
  // The child only reads the parent's controller: it never writes its own snapshot.
  expect(childPlanEvents).toEqual([]);
});

test("a repeated Plan Mode change waits on the pending write", async () => {
  dirs = await tempDirs();
  const backing = createJsonlStore(dirs);
  const writeStarted = Promise.withResolvers<void>();
  const releaseWrite = Promise.withResolvers<void>();
  let gated = false;
  const store = planWrites(backing, async () => {
    if (gated) {
      gated = false;
      writeStarted.resolve();
      await releaseWrite.promise;
    }
  });
  const session = await createSession({ ...dirs, ...fakeModel([]), store });
  gated = true;
  const entered = session.setPlanMode(true);
  await writeStarted.promise;
  let repeated = false;
  const again = session.setPlanMode(true);
  void again.then(
    () => {
      repeated = true;
    },
    () => {
      repeated = true;
    },
  );
  // Drain every pending microtask; only the release can settle the queued write.
  await Promise.resolve();
  // The same-value call returns the pending write queue instead of a settled promise.
  expect(repeated).toBe(false);
  releaseWrite.resolve();
  await again;
  // The write it waited on has persisted the snapshot by then.
  expect(session.toolState("plan")).toEqual({ active: true });
  await entered;
  expect(session.planMode).toBe(true);
  expect(session.toolState("plan")).toEqual({ active: true });
});

test("a pending Plan Mode notification does not hold the write queue", async () => {
  dirs = await tempDirs();
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fake = fakeModel([
    async () => {
      ready.resolve();
      await release.promise;
      return fauxAssistantMessage("done");
    },
  ]);
  const session = await createSession({ ...dirs, ...fake });
  const notificationStarted = Promise.withResolvers<void>();
  const notificationRelease = Promise.withResolvers<void>();
  let held = false;
  const run = session.run("work", {
    onEvent: async (event) => {
      if (event.type !== "tool_state_changed" || event.name !== "plan" || held) return;
      held = true;
      notificationStarted.resolve();
      await notificationRelease.promise;
    },
  });
  await ready.promise;
  const entered = session.setPlanMode(true);
  await notificationStarted.promise;
  // The queue never waits on a notification, so the next change is written and delivered
  // while the first one's notification is still pending.
  await session.setPlanMode(false);
  let enteredSettled = false;
  void entered.then(
    () => {
      enteredSettled = true;
    },
    () => {
      enteredSettled = true;
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  // Public event observers are asynchronous consumers, outside the mutation line.
  expect(enteredSettled).toBe(true);
  expect(session.planMode).toBe(false);
  release.resolve();
  await run;
  notificationRelease.resolve();
  await entered;
  expect(enteredSettled).toBe(true);
});

test("close keeps native storage open until queued Plan writes settle", async () => {
  dirs = await tempDirs();
  const order: string[] = [];
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const store = planWrites(
    createJsonlStore(dirs),
    async (index) => {
      order.push(`write-${index}`);
      if (index === 0) {
        started.resolve();
        await release.promise;
      }
    },
    () => order.push("closed"),
  );
  const ready = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      async () => {
        ready.resolve();
        await finish.promise;
        return fauxAssistantMessage("done");
      },
    ]),
    store,
  });
  const run = session.run("active work").catch((error: unknown) => error);
  await ready.promise;
  const entered = session.setPlanMode(true);
  await started.promise;
  const exited = session.setPlanMode(false);
  const closing = session.close();
  release.resolve();
  finish.resolve();
  await Promise.all([entered, exited]);
  await closing;
  expect(await run).toBeInstanceOf(Error);
  expect(order).toEqual(["write-0", "write-1", "closed"]);
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.planMode).toBe(false);
});

test.each([{ active: "yes" }, { active: true, extra: true }])(
  "cold resume rejects malformed current Plan document: %j",
  async (value) => {
    dirs = await tempDirs();
    const session = await createSession({ ...dirs, ...fakeModel([]) });
    await session.setPlanMode(true);
    await session.close();
    await writePlanDocument(
      session.id,
      value.active === "yes" ? { active: "yes" } : { active: true, extra: true },
    );
    const fake = fakeModel([]);
    await expect(createSession({ ...dirs, ...fake, resumeId: session.id })).rejects.toThrow(
      "Invalid Plan Mode snapshot",
    );
    expect(fake.contexts).toEqual([]);
  },
);

test("cold resume rejects an unsupported native Plan document version", async () => {
  dirs = await tempDirs();
  const session = await createSession({ ...dirs, ...fakeModel([]) });
  await session.close();
  const lease = await createJsonlStore(dirs).open({ id: session.id }, BACKGROUND_CONTEXT);
  const native = createNativeSession(lease.storage);
  const futurePlan = defineDoc({
    kind: "rukie.plan",
    version: 2,
    scope: "conversation",
    history: "rewindable",
    fork: "asOf",
    initial: () => ({ value: { active: true } }),
  });
  try {
    await native.commit(async (tx) => {
      await tx.doc(futurePlan, ROOT_CONVERSATION_ID);
    }, BACKGROUND_CONTEXT);
  } finally {
    await native.close(BACKGROUND_CONTEXT);
    await lease.release();
  }
  const fake = fakeModel([]);
  await expect(createSession({ ...dirs, ...fake, resumeId: session.id })).rejects.toThrow(
    /version/i,
  );
  expect(fake.contexts).toEqual([]);
});

test("the first Plan write persists a Session baseline before any model call", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const fake = fakeModel([]);
  const session = await createSession({ ...dirs, ...fake, store });
  await session.setPlanMode(true);
  expect(fake.contexts).toEqual([]);
  expect(await store.list(BACKGROUND_CONTEXT)).toMatchObject([{ id: session.id }]);
  await session.close();
  const lease = await store.open({ id: session.id }, BACKGROUND_CONTEXT);
  const native = createNativeSession(lease.storage);
  try {
    expect(
      await native.snapshot(planState.document, ROOT_CONVERSATION_ID, BACKGROUND_CONTEXT),
    ).toEqual({ value: { active: true } });
    expect(
      (
        await lease.storage.scanDocuments(
          { scope: { kind: "conversation", conversationId: ROOT_CONVERSATION_ID }, at: "current" },
          10000,
          undefined,
          BACKGROUND_CONTEXT,
        )
      ).items.length,
    ).toBeGreaterThan(1);
  } finally {
    await native.close(BACKGROUND_CONTEXT);
    await lease.release();
  }
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.planMode).toBe(true);
});
