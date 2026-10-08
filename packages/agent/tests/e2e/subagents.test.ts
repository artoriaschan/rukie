import { runRequest } from "../helpers/crashed-subagents.ts";
import { withAuxiliaryRequests, modelStream, withModelStream } from "../helpers/auxiliary-model.ts";
import { afterEach, expect, test } from "bun:test";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemMessage,
} from "@earendil-works/pi-ai";
import {
  createSession,
  createJsonlStore,
  type SubagentIdentity,
  type SessionEvent,
} from "../../src/index.ts";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each(["subagent", "subagent_fork"])(
  "background %s returns its id, finishes through a parent user notification and wraps child events",
  async (toolName) => {
    dirs = await tempDirs();
    const child = Promise.withResolvers<void>();
    const waiting = Promise.withResolvers<void>();
    const response: Parameters<typeof fakeModel>[0][number] = async (context) => {
      if (
        !context.messages.some(
          (message) =>
            message.role === "system" &&
            message.toolsAdded?.some((tool) => tool.name === "subagent"),
        )
      ) {
        expect(
          context.messages.flatMap((message) =>
            message.role === "system" ? (message.toolsAdded?.map((tool) => tool.name) ?? []) : [],
          ),
        ).not.toContain("subagent");
        await child.promise;
        return fauxAssistantMessage("child conclusion");
      }
      expect(structuredClone(context.messages.at(-1))).toMatchObject({
        role: "toolResult",
        content: [{ type: "text", text: expect.stringContaining("started subagent ") }],
        details: { agentId: expect.any(String), childSessionId: expect.any(String) },
      });
      return fauxAssistantMessage("parent stopped");
    };
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall(toolName, { description: "Inspect", prompt: "child" }), {
        stopReason: "toolUse",
      }),
      response,
      response,
      (context) => {
        expect(context.messages.at(-1)?.role).toBe("user");
        expect(JSON.stringify(context.messages.at(-1))).toContain(
          "(Inspect) finished. Its closing message:\nchild conclusion".replaceAll("\n", "\\n"),
        );
        return fauxAssistantMessage("parent conclusion");
      },
    ]);
    fake.model.contextWindow = 100_000;
    const events: SessionEvent[] = [];
    const session = await createSession({ ...dirs, ...fake });
    let settled = false;
    const run = runRequest(session, "delegate", {
      onEvent(event) {
        events.push(event);
        if (event.type === "run_end") waiting.resolve();
      },
    }).then((result) => {
      settled = true;
      return result;
    });
    await waiting.promise;
    expect(settled).toBe(false);
    child.resolve();
    expect((await run).text).toBe("parent conclusion");
    const wrapped = events.filter((event) => event.type === "subagent_event");
    expect(wrapped.length).toBeGreaterThan(0);
    const childId = wrapped[0]!.event.sessionId;
    expect(
      wrapped.every(
        (event) =>
          event.sessionId === session.id &&
          event.agentId === childId &&
          event.event.sessionId === childId,
      ),
    ).toBe(true);
    expect(wrapped[0]!.event.type).toBe("snapshot");
    expect(wrapped.some((event) => event.event.type === "run_end")).toBe(true);
    const stored = await createJsonlStore(dirs).list(BACKGROUND_CONTEXT);
    expect(stored.map((item) => item.id)).toEqual([session.id]);
    expect((await session.readSubagent(childId))?.run?.parentSessionId).toBe(session.id);
    await expect(createSession({ ...dirs, ...fakeModel([]), resumeId: childId })).rejects.toThrow(
      "Session not found",
    );
  },
);

test.each([false, true])(
  "foreground child returns its closing text with failure=%s and no user notification",
  async (failed) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Foreground",
          prompt: "child",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        expect(
          JSON.stringify(context.messages.filter((message) => message.role === "system")),
        ).toContain("You are a subagent");
        return fauxAssistantMessage(
          "child closing",
          failed ? { stopReason: "error", errorMessage: "child failed" } : undefined,
        );
      },
      (context) => {
        expect(structuredClone(context.messages.at(-1))).toMatchObject({
          role: "toolResult",
          isError: failed,
          content: [{ type: "text", text: "child closing" }],
        });
        expect(
          context.messages
            .filter((message) => message.role === "user")
            .some((message) => JSON.stringify(message.content).includes("Subagent ")),
        ).toBe(false);
        return fauxAssistantMessage("parent final");
      },
    ]);
    const session = await createSession({ ...dirs, ...fake });
    const result = await runRequest(session, "delegate");
    expect(result.text).toBe("parent final");
    expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
  },
);

test.each(["subagent", "subagent_fork"])(
  "eight background %s children run concurrently, a ninth errors and all child usage is included",
  async (toolName) => {
    dirs = await tempDirs();
    const release = Promise.withResolvers<void>();
    const parentWaiting = Promise.withResolvers<void>();
    const allChildrenStarted = Promise.withResolvers<void>();
    let started = 0;
    let received = 0;
    const reply: Parameters<typeof fakeModel>[0][number] = async (context) => {
      const last = context.messages.at(-1)!;
      if (
        !getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
          (tool) => tool.name === "subagent",
        )
      ) {
        started++;
        if (started === 8) allChildrenStarted.resolve();
        await release.promise;
        const message = fauxAssistantMessage("child finished");
        message.usage = {
          ...message.usage,
          input: 2,
          output: 3,
          cacheRead: 4,
          cacheWrite: 5,
          totalTokens: 14,
        };
        return message;
      }
      if (last.role === "toolResult") {
        const results = context.messages.filter((message) => message.role === "toolResult");
        expect(results).toHaveLength(9);
        expect(results.filter((message) => message.isError)).toHaveLength(1);
        expect(JSON.stringify(results.find((message) => message.isError)?.content)).toContain(
          "At most 8",
        );
      } else {
        expect(JSON.stringify(last.content)).toContain("finished. Its closing message:");
        received++;
      }
      const message = fauxAssistantMessage("parent complete");
      message.usage = {
        ...message.usage,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
      };
      return message;
    };
    const initial = fauxAssistantMessage(
      Array.from({ length: 9 }, (_, index) =>
        fauxToolCall(toolName, { description: `Child ${index}`, prompt: "child-prompt" }),
      ),
      { stopReason: "toolUse" },
    );
    initial.usage = {
      ...initial.usage,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
    };
    const fake = fakeModel([initial, ...Array.from({ length: 30 }, () => reply)]);
    const originalStream = modelStream(fake.models);
    fake.models = withModelStream(
      fake.models,
      withAuxiliaryRequests((model, context, options) => {
        const stream = createAssistantMessageEventStream();
        void (async () => {
          const response = await originalStream(model, context, options);
          for await (const event of response) {
            if (event.type === "done") {
              const childReply = event.message.content.some(
                (block) => block.type === "text" && block.text === "child finished",
              );
              event.message.usage = {
                ...event.message.usage,
                input: childReply ? 2 : 0,
                output: childReply ? 3 : 0,
                cacheRead: childReply ? 4 : 0,
                cacheWrite: childReply ? 5 : 0,
                totalTokens: childReply ? 14 : 0,
              };
            }
            stream.push(event);
          }
          stream.end(await response.result());
        })();
        return stream;
      }),
    );
    const session = await createSession({ ...dirs, ...fake });
    const run = runRequest(session, "delegate", {
      onEvent(event) {
        if (event.type === "run_end") parentWaiting.resolve();
      },
    });
    await Promise.all([allChildrenStarted.promise, parentWaiting.promise]);
    release.resolve();
    const result = await run;
    expect(received).toBe(8);
    expect(result.usage).toEqual({
      input: 16,
      output: 24,
      cacheRead: 32,
      cacheWrite: 40,
      totalTokens: 112,
    });
  },
);

test.each(["subagent", "subagent_fork"])(
  "ordinary parent abort retains native %s backgrounds until explicit child interruption",
  async (toolName) => {
    dirs = await tempDirs();
    const started = Promise.withResolvers<void>();
    let childCalls = 0;
    let childAborts = 0;
    const reply: Parameters<typeof fakeModel>[0][number] = async (context, options) => {
      if (
        !getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
          (tool) => tool.name === "subagent",
        )
      ) {
        childCalls++;
        if (childCalls === 2) started.resolve();
        await new Promise<void>((resolve) =>
          options!.signal!.addEventListener(
            "abort",
            () => {
              childAborts++;
              resolve();
            },
            { once: true },
          ),
        );
        return fauxAssistantMessage("", { stopReason: "aborted" });
      }
      return fauxAssistantMessage("parent response");
    };
    const fake = fakeModel([
      fauxAssistantMessage(
        [
          fauxToolCall(toolName, { description: "One", prompt: "child-prompt" }),
          fauxToolCall(toolName, { description: "Two", prompt: "child-prompt" }),
        ],
        { stopReason: "toolUse" },
      ),
      ...Array.from({ length: 12 }, () => reply),
    ]);
    const session = await createSession({ ...dirs, ...fake });
    const events: SessionEvent[] = [];
    const off = session.subscribe((event) => events.push(event));
    try {
      await session.run("delegate");
      await started.promise;
      const requestId = session.currentRequestId!;
      await session.abort();
      expect(childAborts).toBe(0);
      expect(
        (session.toolState("subagents") as { active: boolean }[]).filter((row) => row.active),
      ).toHaveLength(2);
      expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
      const rows = session.toolState("subagents") as { id: string }[];
      for (const row of rows) session.interruptSubagent(row.id);
      await session.waitForRequest(requestId);
      expect(childAborts).toBe(2);
      expect(
        events.filter((event) => event.type === "subagent_event" && event.event.type === "run_end"),
      ).toHaveLength(2);
      expect(
        (session.toolState("subagents") as { active: boolean }[]).some((row) => row.active),
      ).toBe(false);
      expect((await runRequest(session, "next prompt")).text).toBe("parent response");
    } finally {
      off();
      await session.close();
    }
  },
);

test.each(["stop", "error"] as const)(
  "closing text survives an empty final child assistant (%s)",
  async (stopReason) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Foreground",
          prompt: "child",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [{ type: "text", text: "last nonempty" }, fauxToolCall("todo_write", { todos: [] })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("", {
        stopReason,
        ...(stopReason === "error" && { errorMessage: "failure" }),
      }),
      (context) => {
        expect(structuredClone(context.messages.at(-1))).toMatchObject({
          content: [{ type: "text", text: "last nonempty" }],
          isError: stopReason === "error",
        });
        return fauxAssistantMessage("parent done");
      },
    ]);
    expect((await (await createSession({ ...dirs, ...fake })).run("delegate")).text).toBe(
      "parent done",
    );
  },
);

test.each(["subagent", "subagent_fork"])(
  "a background %s failure steers the active parent after its existing tool has finished",
  async (toolName) => {
    dirs = await tempDirs();
    const childEnded = Promise.withResolvers<void>();
    const releaseChild = Promise.withResolvers<void>();
    let toolFinished = false;
    const question = {
      question: "Continue?",
      header: "Next",
      multiSelect: false,
      options: [
        { label: "Yes", description: "Continue" },
        { label: "No", description: "Stop" },
      ],
    };
    const initial = fauxAssistantMessage(
      [
        fauxToolCall(toolName, { description: "Failing", prompt: "child-prompt" }),
        fauxToolCall("ask_user_question", { questions: [question] }),
      ],
      { stopReason: "toolUse" },
    );
    let parentReplies = 0;
    const reply: Parameters<typeof fakeModel>[0][number] = async (context) => {
      if (
        !getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
          (tool) => tool.name === "subagent",
        )
      ) {
        await releaseChild.promise;
        return fauxAssistantMessage("partial child text", {
          stopReason: "error",
          errorMessage: "model failure",
        });
      }
      expect(toolFinished).toBe(true);
      parentReplies++;
      if (parentReplies === 1) return fauxAssistantMessage("parent waiting");
      expect(context.messages.filter((message) => message.role === "toolResult")).toHaveLength(2);
      expect(
        context.messages.some(
          (message) =>
            message.role === "user" &&
            JSON.stringify(message.content).includes(
              "(Failing) failed: model failure. Its closing message:",
            ),
        ),
      ).toBe(true);
      return fauxAssistantMessage("parent continues");
    };
    const fake = fakeModel([initial, reply, reply, reply]);
    const session = await createSession({
      ...dirs,
      ...fake,
      onQuestion: async () => {
        releaseChild.resolve();
        await childEnded.promise;
        return { answers: [{ selected: ["Yes"] }] };
      },
    });
    const events: SessionEvent[] = [];
    expect(
      (
        await runRequest(session, "delegate", {
          onEvent(event) {
            events.push(event);
            if (event.type === "subagent_event" && event.event.type === "run_end")
              childEnded.resolve();
            if (event.type === "tool_execution_end" && event.toolName === "ask_user_question")
              toolFinished = true;
          },
        })
      ).text,
    ).toBe("parent continues");
    expect(events.filter((event) => event.type === "run_start")).toHaveLength(2);
  },
);

test.each([
  ["deny", "subagent"],
  ["ask", "subagent"],
  ["deny", "subagent_fork"],
  ["ask", "subagent_fork"],
] as const)(
  "explicit %s %s permission rules still control delegation",
  async (decision, toolName) => {
    dirs = await tempDirs();
    let asked = 0;
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall(toolName, { description: "Forbidden", prompt: "child" }), {
        stopReason: "toolUse",
      }),
      (context) => {
        expect(structuredClone(context.messages.at(-1))).toMatchObject({
          role: "toolResult",
          isError: true,
        });
        return fauxAssistantMessage("denied");
      },
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: { permissions: { [decision]: [toolName] } },
      onPermissionAsk: async () => {
        asked++;
        return "deny";
      },
    });
    const events: SessionEvent[] = [];
    await runRequest(session, "delegate", {
      onEvent(event) {
        events.push(event);
      },
    });
    expect(asked).toBe(decision === "ask" ? 1 : 0);
    expect(events.some((event) => event.type === "subagent_event")).toBe(false);
  },
);

test("interruptSubagent aborts only the selected child and delivers an aborted notification while the parent continues", async () => {
  dirs = await tempDirs();
  const started = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  let childId = "";
  const reply: Parameters<typeof fakeModel>[0][number] = async (context, options) => {
    if (
      !getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
        (tool) => tool.name === "subagent",
      )
    ) {
      started.resolve();
      await new Promise<void>((resolve) =>
        options!.signal!.addEventListener("abort", () => resolve(), { once: true }),
      );
      return fauxAssistantMessage("", { stopReason: "aborted" });
    }
    if (context.messages.at(-1)?.role === "user") {
      expect(JSON.stringify(context.messages.at(-1))).toContain("(Interruptible) aborted.");
      return fauxAssistantMessage("parent continues");
    }
    return fauxAssistantMessage("parent waiting");
  };
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", { description: "Interruptible", prompt: "child-prompt" }),
      { stopReason: "toolUse" },
    ),
    reply,
    reply,
    reply,
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await expect(session.interruptSubagent("missing")).rejects.toThrow("Unknown subagent");
  const run = runRequest(session, "delegate", {
    onEvent(event) {
      if (event.type === "subagent_event") childId = event.agentId;
      if (event.type === "run_end") waiting.resolve();
    },
  });
  await Promise.all([started.promise, waiting.promise]);
  await session.interruptSubagent(childId);
  expect((await run).text).toBe("parent continues");
  await session.interruptSubagent(childId);
});

test("failed background child configuration releases every native run slot and reports each failure", async () => {
  dirs = await tempDirs();
  await Bun.write(
    `${dirs.cwd}/.rukie/agents/broken.md`,
    "---\nname: broken\ndescription: Broken\nmodel: missing/type\n---\nBroken instructions",
  );
  let working = false;
  const reply: Parameters<typeof fakeModel>[0][number] = (context) => {
    if (
      !getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
        (tool) => tool.name === "subagent",
      )
    )
      return fauxAssistantMessage("second child answer");
    const user = context.messages.findLast((message) => message.role === "user");
    if (!working && JSON.stringify(user?.content).includes("start working child")) {
      working = true;
      return fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Working",
          prompt: "second child",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      );
    }
    return fauxAssistantMessage("parent final");
  };
  const fake = fakeModel([
    fauxAssistantMessage(
      Array.from({ length: 8 }, () =>
        fauxToolCall("subagent", {
          description: "Broken",
          prompt: "child",
          subagent_type: "broken",
        }),
      ),
      { stopReason: "toolUse" },
    ),
    ...Array.from({ length: 20 }, () => reply),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    await runRequest(session, "delegate");
    const failed = session.toolState("subagents") as SubagentIdentity[];
    expect(failed).toHaveLength(8);
    expect(
      failed.map((row) => ({
        active: row.active,
        outcome: row.latestRun?.outcome,
        error: row.latestRun?.error,
      })),
    ).toEqual(
      Array.from({ length: 8 }, () => ({
        active: false,
        outcome: "error",
        error: "Unknown model: missing/type",
      })),
    );
    expect(
      session.messages.filter(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("(Broken) failed: Unknown model"),
      ),
    ).toHaveLength(8);
    expect(
      fake.contexts.every((context) =>
        getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
          (tool) => tool.name === "subagent",
        ),
      ),
    ).toBe(true);
    expect((await runRequest(session, "start working child")).text).toBe("parent final");
    expect(
      (session.toolState("subagents") as SubagentIdentity[]).find(
        (row) => row.description === "Working",
      ),
    ).toMatchObject({ active: false, latestRun: { outcome: "completed" } });
  } finally {
    await session.close();
  }
});

test("cancellation during native storage admission retains the committed child for cold resume", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const creating = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let gated = false;
  const gatedStore = {
    ...store,
    async open(...args: Parameters<typeof store.open>) {
      const lease = await store.open(...args);
      return {
        ...lease,
        storage: new Proxy(lease.storage, {
          get(target, key) {
            if (key === "commit")
              return async (
                ...commit: Parameters<import("@earendil-works/pi-durable").Storage["commit"]>
              ) => {
                if (
                  gated &&
                  commit[0].some(
                    (write) =>
                      write.type === "task" && write.value.kind === "rukie.subagent-driver",
                  )
                ) {
                  gated = false;
                  creating.resolve();
                  await release.promise;
                }
                return target.commit(...commit);
              };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      };
    },
  };
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("subagent", { description: "Late", prompt: "child" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("child answer"),
    fauxAssistantMessage("parent answer"),
  ]);
  const session = await createSession({ ...dirs, ...fake, store: gatedStore });
  gated = true;
  const signal = new AbortController();
  const rejected = runRequest(session, "delegate", { signal: signal.signal }).catch(
    (error) => error,
  );
  await creating.promise;
  signal.abort();
  release.resolve();
  expect(await rejected).toBeInstanceOf(Error);
  expect(
    fake.contexts.filter((context) =>
      JSON.stringify(context.messages).includes("You are a subagent"),
    ),
  ).toHaveLength(0);
  expect(session.toolState("subagents")).toMatchObject([
    { description: "Late", type: "general-purpose", active: true },
  ]);
  const requestId = session.currentRequestId!;
  await session.close();
  const replies = fakeModel(
    Array.from({ length: 6 }, () => fauxAssistantMessage("resumed after admission")),
  );
  const resumed = await createSession({ ...dirs, ...replies, store, resumeId: session.id });
  try {
    await resumed.waitForRequest(requestId);
    expect(resumed.toolState("subagents")).toMatchObject([
      { description: "Late", active: false, latestRun: { outcome: "completed" } },
    ]);
    expect(
      replies.contexts.some((context) =>
        JSON.stringify(context.messages).includes("You are a subagent"),
      ),
    ).toBe(true);
    expect((await store.list(BACKGROUND_CONTEXT)).map((item) => item.id)).toEqual([session.id]);
  } finally {
    await resumed.close();
  }
});

test("subagent_event forwards the child's terminal Tool Views", async () => {
  dirs = await tempDirs();
  const reply: Parameters<typeof fakeModel>[0][number] = (context) => {
    const child = !context.messages.some(
      (message) =>
        message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
    );
    if (
      child &&
      !context.messages.some(
        (message) => message.role === "toolResult" && message.toolName === "bash",
      )
    )
      return fauxAssistantMessage(
        fauxToolCall("bash", { command: "printf child-view", description: "Print child output" }),
        { stopReason: "toolUse" },
      );
    return fauxAssistantMessage(child ? "child done" : "parent done");
  };
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("subagent", { description: "Inspect", prompt: "child" }), {
      stopReason: "toolUse",
    }),
    reply,
    reply,
    reply,
    reply,
  ]);
  const session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  const events: SessionEvent[] = [];
  try {
    await runRequest(session, "delegate", {
      onEvent(event) {
        events.push(event);
      },
    });
    const childTools = events.flatMap((event) =>
      event.type === "subagent_event" &&
      (event.event.type === "tool_execution_start" || event.event.type === "tool_execution_end")
        ? [event.event]
        : [],
    );
    expect(childTools).toMatchObject([
      { view: { card: "terminal", command: "printf child-view" } },
      { view: { card: "terminal", output: "child-view", exitCode: 0 } },
    ]);
  } finally {
    await session.close();
  }
});
