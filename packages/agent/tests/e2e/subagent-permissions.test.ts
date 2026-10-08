import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import {
  createSession as createSessionImpl,
  type Session,
  type PermissionAskRequest,
  type QuestionRequest,
  type QuestionReply,
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

const delegate = (toolName = "subagent") =>
  fauxAssistantMessage(
    fauxToolCall(toolName, {
      description: "Inspect permissions",
      prompt: "child",
      run_in_background: false,
    }),
    { stopReason: "toolUse" },
  );
const bash = () =>
  fauxAssistantMessage(
    fauxToolCall("bash", { description: "Run test command", command: "printf shared-grant" }),
    {
      stopReason: "toolUse",
    },
  );

test.each(["subagent", "subagent_fork"])(
  "child permission origin reaches the parent callback and session grant covers the parent's next call (%s)",
  async (toolName) => {
    dirs = await tempDirs();
    const asks: PermissionAskRequest[] = [];
    const fake = fakeModel([
      delegate(toolName),
      bash(),
      fauxAssistantMessage("child done"),
      bash(),
      (context) => {
        expect(
          structuredClone(context.messages.findLast((message) => message.role !== "system")),
        ).toMatchObject({
          isError: false,
          content: [{ type: "text", text: "shared-grant" }],
        });
        return fauxAssistantMessage("parent done");
      },
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      onPermissionAsk: async (request) => {
        asks.push(request);
        return "allow-session";
      },
    });
    const childIds: string[] = [];
    await session.run("delegate", {
      onEvent(event) {
        if (event.type === "subagent_event" && event.event.type === "run_start")
          childIds.push(event.agentId);
      },
    });
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({
      origin: { agentId: childIds[0], description: "Inspect permissions" },
    });
  },
);

test("a child session grant withdraws a matching parent approval already in the FIFO", async () => {
  dirs = await tempDirs();
  const parentAsked = Promise.withResolvers<void>();
  const parentReply = Promise.withResolvers<"deny">();
  let parentSignal: AbortSignal | undefined;
  let parentCalls = 0;
  let childCalls = 0;
  const response: Parameters<typeof fakeModel>[0][number] = async (context) => {
    const parent = getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
      (tool) => tool.name === "subagent",
    );
    if (parent) {
      if (parentCalls++ === 0) return bash();
      expect(
        context.messages.filter(
          (message) => message.role === "toolResult" && message.toolName === "bash",
        ),
      ).toMatchObject([{ isError: false }]);
      return fauxAssistantMessage("parent done");
    }
    if (childCalls++ === 0) {
      await parentAsked.promise;
      return bash();
    }
    parentReply.resolve("deny");
    expect(parentSignal?.aborted).toBe(true);
    return fauxAssistantMessage("child done");
  };
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", { description: "Inspect permissions", prompt: "child" }),
      { stopReason: "toolUse" },
    ),
    ...Array.from({ length: 8 }, () => response),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onPermissionAsk: async (request) => {
      if (request.origin) {
        await parentAsked.promise;
        return "allow-session";
      }
      parentSignal = request.signal;
      parentAsked.resolve();
      return parentReply.promise;
    },
  });
  await session.run("delegate");
});

test.each(["subagent", "subagent_fork"])(
  "a running child reads parent mode changes on each next tool call (%s)",
  async (toolName) => {
    dirs = await tempDirs();
    let session: Awaited<ReturnType<typeof createSession>>;
    let asked = 0;
    const fake = fakeModel([
      delegate(toolName),
      bash(),
      () => {
        session.setPermissionMode("full-access");
        return bash();
      },
      (context) => {
        expect(
          structuredClone(context.messages.findLast((message) => message.role !== "system")),
        ).toMatchObject({ isError: false });
        expect(asked).toBe(1);
        session.setPermissionMode("ask");
        return bash();
      },
      fauxAssistantMessage("child done"),
      fauxAssistantMessage("parent done"),
    ]);
    session = await createSession({
      ...dirs,
      ...fake,
      onPermissionAsk: async (request) => {
        expect(request.mode).toBe("ask");
        asked++;
        return "allow";
      },
    });
    await session.run("delegate");
    expect(asked).toBe(2);
  },
);

test.each(["subagent", "subagent_fork"])(
  "headless child denies asks and has no question tool (%s)",
  async (toolName) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      delegate(toolName),
      (context) => {
        const tools = context.messages.flatMap((message) =>
          message.role === "system" ? (message.toolsAdded?.map((tool) => tool.name) ?? []) : [],
        );
        expect(tools).not.toContain("ask_user_question");
        return bash();
      },
      (context) => {
        expect(
          structuredClone(context.messages.findLast((message) => message.role !== "system")),
        ).toMatchObject({
          isError: true,
          content: [{ type: "text", text: "Tool not authorized: bash" }],
        });
        return fauxAssistantMessage("child denied");
      },
      fauxAssistantMessage("parent done"),
    ]);
    await (await createSession({ ...dirs, ...fake })).run("delegate");
  },
);

const question = {
  question: "Proceed?",
  header: "Next",
  options: [
    { label: "Yes", description: "Proceed" },
    { label: "No", description: "Stop" },
  ],
};
const askQuestion = () =>
  fauxAssistantMessage(fauxToolCall("ask_user_question", { questions: [question] }), {
    stopReason: "toolUse",
  });

test("child question uses the parent callback with origin and parent questions have no origin", async () => {
  dirs = await tempDirs();
  const asks: QuestionRequest[] = [];
  const fake = fakeModel([
    delegate(),
    askQuestion(),
    (context) => {
      expect(
        structuredClone(context.messages.findLast((message) => message.role !== "system")),
      ).toMatchObject({
        content: [{ type: "text", text: '"Proceed?" → Yes' }],
      });
      return fauxAssistantMessage("child done");
    },
    askQuestion(),
    fauxAssistantMessage("parent done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onQuestion: async (request) => {
      asks.push(request);
      return { answers: [{ selected: ["Yes"] }] };
    },
  });
  let childId: string | undefined;
  await session.run("delegate", {
    onEvent(event) {
      if (event.type === "subagent_event") childId = event.agentId;
    },
  });
  expect(asks).toHaveLength(2);
  expect(asks[0]?.origin).toEqual({ agentId: childId!, description: "Inspect permissions" });
  expect(asks[1]?.origin).toBeUndefined();
});

test("session grants from one child also cover sibling calls", async () => {
  dirs = await tempDirs();
  let asked = 0;
  const fake = fakeModel([
    delegate(),
    bash(),
    fauxAssistantMessage("first done"),
    delegate(),
    bash(),
    (context) => {
      expect(
        structuredClone(context.messages.findLast((message) => message.role !== "system")),
      ).toMatchObject({ isError: false });
      return fauxAssistantMessage("second done");
    },
    fauxAssistantMessage("parent done"),
  ]);
  await (
    await createSession({
      ...dirs,
      ...fake,
      onPermissionAsk: async () => {
        asked++;
        return "allow-session";
      },
    })
  ).run("delegate");
  expect(asked).toBe(1);
});

test("a child's pending Question cold-reopens with the same origin and fresh callback ownership", async () => {
  dirs = await tempDirs();
  const entered = Promise.withResolvers<QuestionRequest>();
  const oldReply = Promise.withResolvers<QuestionReply>();
  const session = await createSession({
    ...dirs,
    ...fakeModel([delegate(), askQuestion()]),
    onQuestion: (request) => {
      entered.resolve(request);
      return oldReply.promise;
    },
  });
  const running = session.run("delegated question before restart").catch(() => undefined);
  const old = await entered.promise;
  await session.close();
  await running;
  let replacement: QuestionRequest | undefined;
  const cold = fakeModel([
    fauxAssistantMessage("child replacement complete"),
    fauxAssistantMessage("parent received replacement"),
  ]);
  const resumed = await createSession({
    ...dirs,
    ...cold,
    resumeId: session.id,
    onQuestion: async (request) => {
      replacement = request;
      oldReply.resolve({ answers: [{ selected: ["No"] }] });
      return { answers: [{ selected: ["Yes"] }] };
    },
  });
  await resumed.waitForIdle();
  expect(replacement?.origin).toEqual(old.origin);
  expect(replacement?.identity.requestId).toBe(old.identity.requestId);
  expect(replacement?.identity.epoch).not.toBe(old.identity.epoch);
  expect(old.signal.aborted).toBe(true);
  const child = await resumed.readSubagent(old.origin!.agentId);
  expect(JSON.stringify(child?.messages)).toContain("→ Yes");
  expect(JSON.stringify(child?.messages)).not.toContain("→ No");
  expect(
    resumed.messages.filter(
      (message) => message.role === "toolResult" && message.toolName === "subagent",
    ),
  ).toHaveLength(1);
});
