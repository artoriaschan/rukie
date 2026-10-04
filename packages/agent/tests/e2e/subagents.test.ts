import { afterEach, expect, test } from "bun:test";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { createSession, createJsonlStore, type SessionEvent } from "../../src/index.ts";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
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
        expect(structuredClone(context.messages.at(-1))).toMatchObject({
          role: "user",
          content: [
            {
              type: "text",
              text: expect.stringContaining(
                "(Inspect) finished. Its closing message:\nchild conclusion",
              ),
            },
          ],
        });
        return fauxAssistantMessage("parent conclusion");
      },
    ]);
    fake.model.contextWindow = 100_000;
    const events: SessionEvent[] = [];
    const session = await createSession({ ...dirs, ...fake });
    let settled = false;
    const run = session
      .run("delegate", {
        onEvent(event) {
          events.push(event);
          if (event.type === "subagents_waiting") waiting.resolve();
        },
      })
      .then((result) => {
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
    expect(wrapped[0]!.event.type).toBe("session_start");
    expect(wrapped.at(-1)!.event.type).toBe("result");
    const stored = await createJsonlStore(dirs).list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT);
    expect(stored.find((item) => item.id === childId)).toMatchObject({
      parentSessionId: session.id,
    });
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
          context.messages
            .filter((message) => message.role === "system")
            .map((message) => message.content)
            .join("\n"),
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
        expect(context.messages.filter((message) => message.role === "user")).toHaveLength(4);
        return fauxAssistantMessage("parent final");
      },
    ]);
    const session = await createSession({ ...dirs, ...fake });
    const result = await session.run("delegate");
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
      if (last.role === "user" && JSON.stringify(last.content).includes("child-prompt")) {
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
    const originalStream = fake.streamFn;
    fake.streamFn = (model, context, options) => {
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
    };
    const session = await createSession({ ...dirs, ...fake });
    const run = session.run("delegate", {
      onEvent(event) {
        if (event.type === "subagents_waiting") parentWaiting.resolve();
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
  "parent cancellation stops all %s child runs, closes them before the parent result and sends no notification",
  async (toolName) => {
    dirs = await tempDirs();
    const started = Promise.withResolvers<void>();
    const waiting = Promise.withResolvers<void>();
    let childCalls = 0;
    let childAborts = 0;
    const reply: Parameters<typeof fakeModel>[0][number] = async (context, options) => {
      const last = context.messages.at(-1)!;
      if (last.role === "user" && JSON.stringify(last.content).includes("child-prompt")) {
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
      ...Array.from({ length: 10 }, () => reply),
    ]);
    const session = await createSession({ ...dirs, ...fake });
    const events: SessionEvent[] = [];
    const signal = new AbortController();
    const run = session.run("delegate", {
      signal: signal.signal,
      onEvent(event) {
        events.push(event);
        if (event.type === "subagents_waiting") waiting.resolve();
      },
    });
    const rejected = run.catch((error) => error);
    await Promise.all([started.promise, waiting.promise]);
    signal.abort();
    expect(await rejected).toBeInstanceOf(Error);
    expect(childAborts).toBe(2);
    expect(events.at(-1)?.type).toBe("result");
    expect(
      events.filter((event) => event.type === "subagent_event" && event.event.type === "result"),
    ).toHaveLength(2);
    expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect((await session.run("next prompt")).text).toBe("parent response");
    expect(session.messages.filter((message) => message.role === "user")).toHaveLength(2);
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
    const reply: Parameters<typeof fakeModel>[0][number] = async (context) => {
      const last = context.messages.at(-1)!;
      if (last.role === "user" && JSON.stringify(last.content).includes("child-prompt")) {
        await releaseChild.promise;
        return fauxAssistantMessage("partial child text", {
          stopReason: "error",
          errorMessage: "model failure",
        });
      }
      expect(toolFinished).toBe(true);
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
    const fake = fakeModel([initial, reply, reply]);
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
        await session.run("delegate", {
          onEvent(event) {
            events.push(event);
            if (event.type === "subagent_event" && event.event.type === "result")
              childEnded.resolve();
            if (event.type === "tool_execution_end" && event.toolName === "ask_user_question")
              toolFinished = true;
          },
        })
      ).text,
    ).toBe("parent continues");
    expect(events.filter((event) => event.type === "agent_start")).toHaveLength(1);
    expect(events.some((event) => event.type === "subagents_waiting")).toBe(false);
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
    await session.run("delegate", {
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
    if (JSON.stringify(context.messages.at(-1)).includes("child-prompt")) {
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
  session.interruptSubagent("missing");
  const run = session.run("delegate", {
    onEvent(event) {
      if (event.type === "subagent_event") childId = event.agentId;
      if (event.type === "subagents_waiting") waiting.resolve();
    },
  });
  await Promise.all([started.promise, waiting.promise]);
  session.interruptSubagent(childId);
  expect((await run).text).toBe("parent continues");
  session.interruptSubagent(childId);
});
