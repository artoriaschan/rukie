import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import {
  createSession,
  type QuestionReply,
  type QuestionRequest,
  type SessionEvent,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());
const question = {
  question: "Which storage?",
  header: "Storage",
  multiSelect: false,
  options: [
    { label: "SQLite", description: "Local" },
    { label: "Postgres", description: "Server" },
  ],
};

test("the frontend answer reaches the next model turn without permission approval", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("ask_user_question", { questions: [question] }, { id: "question-1" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("continued"),
  ]);
  let asked = false;
  const session = await createSession({
    ...dirs,
    ...fake,
    onQuestion: async (request) => {
      asked = true;
      expect(request.toolCallId).toBe("question-1");
      expect(request.questions).toEqual([question]);
      expect(request.signal.aborted).toBe(false);
      return { answers: [{ selected: ["SQLite"] }] };
    },
    onPermissionAsk: async () => {
      throw new Error("unexpected permission approval");
    },
  });
  expect((await session.run("choose storage")).text).toBe("continued");
  expect(asked).toBe(true);
  expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    isError: false,
    content: [{ type: "text", text: '"Which storage?" → SQLite' }],
  });
});

test.each(["ask", "auto-review", "full-access"] as const)(
  "questions bypass permission review in %s mode",
  async (permissionMode) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("ask_user_question", { questions: [question] }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("continued"),
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode,
      onQuestion: async () => ({ answers: [{ selected: ["Postgres"] }] }),
      onPermissionAsk: async () => {
        throw new Error("unexpected approval");
      },
    });
    await session.run("ask", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(fake.contexts).toHaveLength(2);
    expect(
      events.filter(
        (event) => event.type === "permission_review" || event.type === "permission_denied",
      ),
    ).toEqual([]);
    expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({ isError: false });
  },
);

test.each([false, true])(
  "MCP tool rebuilding registers questions only with a callback (%s)",
  async (interactive) => {
    dirs = await tempDirs();
    await Bun.write(join(dirs.homeDir, "manifest"), JSON.stringify({ tools: ["echo"] }));
    await Bun.write(
      join(dirs.homeDir, ".neant/mcp.json"),
      JSON.stringify({
        mcpServers: {
          local: {
            command: process.execPath,
            args: [join(import.meta.dir, "../helpers/mcp-server.ts")],
            env: {
              MCP_MANIFEST: join(dirs.homeDir, "manifest"),
              MCP_PIDS: join(dirs.homeDir, "pids"),
              MCP_CALLS: join(dirs.homeDir, "calls"),
            },
          },
        },
      }),
    );
    const fake = fakeModel([fauxAssistantMessage("done")]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      ...(interactive && { onQuestion: async (): Promise<QuestionReply> => "declined" }),
    });
    await session.run("list tools", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const started = events.find((event) => event.type === "session_start");
    expect(started?.type).toBe("session_start");
    if (started?.type !== "session_start") throw new Error("missing session start");
    expect(started.tools.includes("ask_user_question")).toBe(interactive);
    expect(started.tools).toContain("mcp__local__echo");
  },
);

test.each([
  [
    { answers: [{ selected: ["SQLite", "Postgres"], custom: "both" }] },
    '"Which storage?" → SQLite, Postgres; both',
  ],
  [{ answers: [{ selected: [], custom: "Files" }] }, '"Which storage?" → Files'],
  [
    "declined",
    "The user declined to answer. Proceed with your best judgment or stop and wait for instructions.",
  ],
] satisfies [QuestionReply, string][])(
  "structured answers and refusals continue the Run (%j)",
  async (reply, expected) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("ask_user_question", { questions: [question] }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("continued"),
    ]);
    const session = await createSession({ ...dirs, ...fake, onQuestion: async () => reply });
    expect((await session.run("ask")).text).toBe("continued");
    expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
      isError: false,
      content: [{ type: "text", text: expected }],
    });
  },
);

test("frontend failures return ordinary tool errors", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("ask_user_question", { questions: [question] }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("recovered"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onQuestion: async () => {
      throw new Error("frontend failed");
    },
  });
  expect((await session.run("ask")).text).toBe("recovered");
  expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
    isError: true,
    content: [{ type: "text", text: "frontend failed" }],
  });
});

test.each([
  [[]],
  [Array(5).fill(question)],
  [[{ ...question, options: question.options.slice(0, 1) }]],
  [[{ ...question, options: Array(5).fill(question.options[0]) }]],
])("invalid question bounds never reach the frontend (%j)", async (questions) => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("ask_user_question", { questions }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("retry"),
  ]);
  let called = false;
  const session = await createSession({
    ...dirs,
    ...fake,
    onQuestion: async () => {
      called = true;
      return "declined";
    },
  });
  await session.run("ask");
  expect(called).toBe(false);
  expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({ isError: true });
  expect(JSON.stringify(fake.contexts[1]!.messages.at(-1))).toContain("Validation");
});

test("aborting a pending question cancels its signal and discards late answers", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("ask_user_question", { questions: [question] }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("unused"),
  ]);
  const arrived = Promise.withResolvers<QuestionRequest>();
  const reply = Promise.withResolvers<QuestionReply>();
  const session = await createSession({
    ...dirs,
    ...fake,
    onQuestion: (request) => {
      arrived.resolve(request);
      return reply.promise;
    },
  });
  const controller = new AbortController();
  const run = session.run("ask", { signal: controller.signal });
  void run.catch(() => {});
  const request = await arrived.promise;
  controller.abort(new Error("cancel questions"));
  await expect(run).rejects.toThrow("cancel questions");
  expect(request.signal.aborted).toBe(true);
  reply.resolve({ answers: [{ selected: ["SQLite"] }] });
  await Bun.sleep(10);
  expect(
    JSON.stringify(session.messages.filter((message) => message.role === "toolResult")),
  ).not.toContain("→");
});

test("four questions with four options preserve question order in the result", async () => {
  dirs = await tempDirs();
  const questions = ["First?", "Second?", "Third?", "Fourth?"].map((text) => ({
    ...question,
    question: text,
    options: ["One", "Two", "Three", "Four"].map((label) => ({ label, description: label })),
  }));
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("ask_user_question", { questions }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("continued"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onQuestion: async (request) => {
      expect(request.questions).toEqual(questions);
      return {
        answers: [
          { selected: ["One"] },
          { selected: ["Two"] },
          { selected: ["Three"] },
          { selected: ["Four"] },
        ],
      };
    },
  });
  await session.run("ask");
  expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
    isError: false,
    content: [
      {
        type: "text",
        text: '"First?" → One\n"Second?" → Two\n"Third?" → Three\n"Fourth?" → Four',
      },
    ],
  });
});
