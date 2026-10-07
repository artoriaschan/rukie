import { afterEach, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { branchTip } from "@earendil-works/pi-agent-core/harness/session";
import {
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentTools,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
  createJsonlStore,
  createSession,
  type Session,
  type SessionEvent,
  type SessionStore,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

/** Store that fails the selected `mutate` calls, to exercise Plan Mode write recovery. */
function failingPlanWrites(backing: SessionStore, fail: (index: number) => boolean): SessionStore {
  let mutates = 0;
  return {
    create: backing.create.bind(backing),
    list: backing.list.bind(backing),
    async open(metadata, context) {
      const stored = await backing.open(metadata, context);
      return new Proxy(stored, {
        get(target, property) {
          if (property === "mutate")
            return (...args: Parameters<typeof stored.mutate>) => {
              if (fail(mutates++)) throw new Error("snapshot unavailable");
              return stored.mutate(...args);
            };
          const member = Reflect.get(target, property);
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
    },
  };
}

test("Plan Mode persists outside a Run and injects changed guidance once", async () => {
  dirs = await tempDirs();
  const fake = fakeModel(Array.from({ length: 5 }, () => fauxAssistantMessage("done")));
  const session = await createSession({ ...dirs, ...fake });
  expect(session.planMode).toBe(false);
  await session.run("ordinary");
  expect(JSON.stringify(fake.contexts[0])).not.toContain("Plan Mode");
  await session.setPlanMode(true);
  expect(session.planMode).toBe(true);
  expect(session.toolState("plan")).toEqual({ active: true });
  const events: SessionEvent[] = [];
  await session.run("plan", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(JSON.stringify(fake.contexts[1])).toContain("You are in Plan Mode");
  expect(JSON.stringify(fake.contexts[1])).toContain("markdown");
  expect(JSON.stringify(fake.contexts[1])).toContain("Permissions still apply");
  const next = fakeModel(Array.from({ length: 3 }, () => fauxAssistantMessage("resumed")));
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
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
  expect(
    events.flatMap((event) =>
      event.type === "reminder_injected" && event.source === "plan-mode" ? [event.content] : [],
    ),
  ).toEqual([
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
      expect(JSON.stringify(context.messages.at(-1))).toContain("You have exited Plan Mode");
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
        expect(JSON.stringify(context.messages.at(-1))).toContain("You have exited Plan Mode");
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
  const work = () =>
    fauxAssistantMessage(
      [{ type: "text", text: "old work ".repeat(2500) }, fauxToolCall("todo_write", { todos: [] })],
      { stopReason: "toolUse" },
    );
  const fake = fakeModel([
    fauxAssistantMessage("saved"),
    work(),
    fauxAssistantMessage("First summary."),
    fauxAssistantMessage("continued"),
    fauxAssistantMessage("execute"),
    work(),
    fauxAssistantMessage("Second summary."),
    fauxAssistantMessage("done"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({ ...dirs, ...fake });
  await session.setPlanMode(true);
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await session.run("plan", { onEvent });
  await session.run("work", { onEvent });
  expect(
    events.filter((event) => event.type === "reminder_injected" && event.source === "plan-mode"),
  ).toHaveLength(2);
  expect(JSON.stringify(fake.contexts[3])).toContain("You are in Plan Mode");
  await session.setPlanMode(false);
  await session.run("execute", { onEvent });
  await session.run("more", { onEvent });
  expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(2);
  expect(
    events
      .flatMap((event) =>
        event.type === "reminder_injected" && event.source === "plan-mode" ? [event.content] : [],
      )
      .filter((text) => text.includes("exited")),
  ).toHaveLength(1);
});

test("rewind restores Plan Mode from the snapshot at the selected transcript point", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const session = await createSession({ ...dirs, ...fakeModel([]), store });
  await session.setPlanMode(true);
  const metadata = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT))[0]!;
  const stored = await store.open(metadata, BACKGROUND_CONTEXT);
  const point = await (await stored.branch("main", BACKGROUND_CONTEXT))!.getTipId(
    BACKGROUND_CONTEXT,
  );
  await stored.close(BACKGROUND_CONTEXT);
  await session.setPlanMode(false);
  const rewind = await store.open(metadata, BACKGROUND_CONTEXT);
  await rewind.setValue(branchTip("main"), point, BACKGROUND_CONTEXT);
  await rewind.close(BACKGROUND_CONTEXT);
  const fake = fakeModel([fauxAssistantMessage("planning")]);
  const resumed = await createSession({ ...dirs, ...fake, store, resumeId: session.id });
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
      if ((event.value as { active: boolean }).active) await session.setPlanMode(false);
    },
  });
  expect(values).toEqual([{ active: true }, { active: false }]);
  expect(session.planMode).toBe(false);
}, 1000);

test("a rejected Plan Mode snapshot closes the Run store, rolls back and can be retried", async () => {
  dirs = await tempDirs();
  const backing = createJsonlStore(dirs);
  let rejectWrite = false;
  let opened = 0;
  let closed = 0;
  const store: typeof backing = {
    create: backing.create.bind(backing),
    list: backing.list.bind(backing),
    async open(metadata, context) {
      const stored = await backing.open(metadata, context);
      opened++;
      return new Proxy(stored, {
        get(target, property) {
          if (property === "mutate")
            return (...args: Parameters<typeof stored.mutate>) => {
              if (rejectWrite) {
                rejectWrite = false;
                throw new Error("snapshot unavailable");
              }
              return stored.mutate(...args);
            };
          if (property === "close")
            return async (ctx: typeof context) => {
              await stored.close(ctx);
              closed++;
            };
          const member = Reflect.get(target, property);
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
    },
  };
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("todo_write", { todos: [] }), { stopReason: "toolUse" }),
    fauxAssistantMessage("retried"),
  ]);
  const session = await createSession({ ...dirs, ...fake, store });
  await expect(
    session.run("work", {
      onEvent: async (event) => {
        if (event.type === "tool_execution_end") {
          rejectWrite = true;
          await session.setPlanMode(true);
        }
      },
    }),
  ).rejects.toThrow("snapshot unavailable");
  expect(closed).toBe(opened);
  expect(session.planMode).toBe(false);
  await session.setPlanMode(true);
  expect(session.planMode).toBe(true);
  expect((await session.run("retry")).success).toBe(true);
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.planMode).toBe(true);
});

test("pending Plan Mode revisions keep the latest state, report their own failure and stay writable", async () => {
  /** Both revisions are queued before either write settles, so the queue holds two. */
  const withFailures = async (
    fail: (index: number) => boolean,
    scenario: (session: Session) => Promise<void>,
  ) => {
    dirs = await tempDirs();
    const store = failingPlanWrites(createJsonlStore(dirs), fail);
    const session = await createSession({
      ...dirs,
      ...fakeModel([fauxAssistantMessage("done")]),
      store,
    });
    try {
      await scenario(session);
    } finally {
      await session.dispose();
    }
  };
  /** Plan Mode guidance the next Run injects, which follows the entered/exited history. */
  const planGuidance = async (session: Session) => {
    const events: SessionEvent[] = [];
    await session.run("continue", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    return events.flatMap((event) =>
      event.type === "reminder_injected" && event.source === "plan-mode" ? [event.content] : [],
    );
  };
  // Earlier failure, later success: the failing revision reports its own error and does
  // not roll back the revision that replaced it.
  await withFailures(
    (index) => index === 0,
    async (session) => {
      const failed = session.setPlanMode(true);
      const succeeded = session.setPlanMode(false);
      await expect(failed).rejects.toThrow("snapshot unavailable");
      await succeeded;
      expect(session.planMode).toBe(false);
      expect(await planGuidance(session)).toEqual([
        expect.stringContaining("You have exited Plan Mode"),
      ]);
      const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
      expect(resumed.planMode).toBe(false);
    },
  );
  // Earlier success, later failure: the failed revision rolls back to the state the
  // earlier write persisted, and the Session still accepts the next change.
  await withFailures(
    (index) => index === 1,
    async (session) => {
      const succeeded = session.setPlanMode(true);
      const failed = session.setPlanMode(false);
      await succeeded;
      await expect(failed).rejects.toThrow("snapshot unavailable");
      expect(session.planMode).toBe(true);
      expect(await planGuidance(session)).toEqual([
        expect.stringContaining("You are in Plan Mode"),
      ]);
      await session.setPlanMode(false);
      expect(session.planMode).toBe(false);
      const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
      expect(resumed.planMode).toBe(false);
    },
  );
});

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
    if (event.event.type === "session_start") childIds.add((childId = event.agentId));
    if (event.event.type === "result") childResult.resolve();
    if (event.event.type === "tool_state_changed" && event.event.name === "plan")
      childPlanEvents.push(event.event);
  };
  await session.run("first", { onEvent });
  // Entering Plan Mode after the child exists and leaving it again makes the rewind
  // change the state a continued child has to project.
  await session.setPlanMode(true);
  await session.run("second", { onEvent });
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
  await session.run("continue the child", { onEvent });
  // The parent addressed the child Session that already existed, not a new one.
  expect([...childIds]).toEqual([childId]);
  expect(
    session.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "send_message",
    ),
  ).toMatchObject({
    isError: false,
    content: [{ type: "text", text: `delivered to ${childId}` }],
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
  /** Hold the store handle the queued Plan Mode write is about to use. */
  const store: SessionStore = {
    create: backing.create.bind(backing),
    list: backing.list.bind(backing),
    async open(metadata, context) {
      if (gated) {
        gated = false;
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      return backing.open(metadata, context);
    },
  };
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
  await new Promise((resolve) => setTimeout(resolve, 0));
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
  // The original caller still waits for its own notification.
  expect(enteredSettled).toBe(false);
  expect(session.planMode).toBe(false);
  release.resolve();
  await run;
  notificationRelease.resolve();
  await entered;
  expect(enteredSettled).toBe(true);
});

test("dispose keeps the Run store open until queued Plan Mode writes settle", async () => {
  dirs = await tempDirs();
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const backing = createJsonlStore(dirs);
  const order: string[] = [];
  const writeStarted = Promise.withResolvers<void>();
  const releaseWrite = Promise.withResolvers<void>();
  let planCommits = 0;
  let openedHandles = 0;
  /** Record the Plan Mode commits and store closes, and hold the first commit. */
  const store: SessionStore = {
    create: backing.create.bind(backing),
    list: backing.list.bind(backing),
    async open(metadata, context) {
      const stored = await backing.open(metadata, context);
      const handle = ++openedHandles;
      return new Proxy(stored, {
        get(target, property) {
          if (property === "mutate")
            return (
              mutation: Parameters<typeof stored.mutate>[0],
              ctx: Parameters<typeof stored.mutate>[1],
            ) =>
              target.mutate(async (mutator, inner) => {
                const commit: typeof mutator = new Proxy(mutator, {
                  get(member, key) {
                    if (key === "commit")
                      return async (
                        writes: Parameters<typeof mutator.commit>[0],
                        commitContext: Parameters<typeof mutator.commit>[1],
                      ) => {
                        const plan = writes.some(
                          (write) =>
                            write.kind === "entry" &&
                            write.entry.type === "custom" &&
                            write.entry.customType === "tool-state/plan",
                        );
                        const step = plan ? ++planCommits : 0;
                        if (plan) order.push(`plan-write-${step}`);
                        if (step === 1) {
                          writeStarted.resolve();
                          await releaseWrite.promise;
                        }
                        const result = await member.commit(writes, commitContext);
                        if (plan) order.push(`plan-write-${step}-committed`);
                        return result;
                      };
                    const value: unknown = Reflect.get(member, key);
                    return typeof value === "function" ? value.bind(member) : value;
                  },
                });
                return mutation(commit, inner);
              }, ctx);
          if (property === "close")
            return async (ctx: Parameters<typeof stored.close>[0]) => {
              order.push(`store-${handle}-closed`);
              await target.close(ctx);
            };
          const member: unknown = Reflect.get(target, property);
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
    },
  };
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      async () => {
        ready.resolve();
        await release.promise;
        return fauxAssistantMessage("done");
      },
    ]),
    store,
  });
  const run = session.run("work").catch((error: unknown) => error);
  await ready.promise;
  const entered = session.setPlanMode(true);
  await writeStarted.promise;
  const exited = session.setPlanMode(false);
  const writes = Promise.all([entered, exited]);
  const disposing = session.dispose();
  release.resolve();
  releaseWrite.resolve();
  await writes;
  expect(await run).toBeInstanceOf(Error);
  await disposing;
  // The Run handle closes after both queued writes. A separate recovery handle
  // reads the committed branch after the abort; the summary write uses its own handle.
  expect(order.slice(order.indexOf("plan-write-1"))).toEqual([
    "plan-write-1",
    "plan-write-1-committed",
    "plan-write-2",
    "plan-write-2-committed",
    "store-1-closed",
    "store-2-closed",
    "store-3-closed",
  ]);
  expect(session.planMode).toBe(false);
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.planMode).toBe(false);
});

test("an unsupported or malformed Plan Mode snapshot is ignored on resume", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const session = await createSession({ ...dirs, ...fakeModel([]), store });
  const metadata = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT))[0]!;
  const stored = await store.open(metadata, BACKGROUND_CONTEXT);
  const branch = (await stored.branch("main", BACKGROUND_CONTEXT))!;
  await branch.appendCustomEntry(
    "tool-state/plan",
    { version: 2, value: { active: true } },
    BACKGROUND_CONTEXT,
  );
  await branch.appendCustomEntry(
    "tool-state/plan",
    { version: 1, value: { active: "yes" } },
    BACKGROUND_CONTEXT,
  );
  await stored.close(BACKGROUND_CONTEXT);
  const warnings: string[] = [];
  const resumed = await createSession({
    ...dirs,
    ...fakeModel([]),
    store,
    resumeId: session.id,
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });
  expect(resumed.planMode).toBe(false);
  expect(resumed.toolState("plan")).toBeUndefined();
  expect(warnings.join("\n")).toContain("Unsupported plan version: 2");
  expect(warnings.join("\n")).toContain("Invalid Plan Mode snapshot.");
  await session.dispose();
  await resumed.dispose();
});

test("the first Plan Mode write saves the Session baseline before the snapshot", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const session = await createSession({ ...dirs, ...fakeModel([]), store });
  await session.setPlanMode(true);
  const metadata = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT))[0]!;
  const stored = await store.open(metadata, BACKGROUND_CONTEXT);
  const entries = await (await stored.branch("main", BACKGROUND_CONTEXT))!.findEntries(
    { order: "oldestFirst" },
    BACKGROUND_CONTEXT,
  );
  await stored.close(BACKGROUND_CONTEXT);
  const plan = entries.findIndex(
    (entry) => entry.type === "custom" && entry.customType === "tool-state/plan",
  );
  expect(plan).toBeGreaterThan(0);
  expect(entries.slice(0, plan).some((entry) => entry.type === "message")).toBe(true);
  await session.dispose();
});
