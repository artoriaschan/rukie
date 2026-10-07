import { withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";
import { expect, test } from "bun:test";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createSession } from "@rukie/agent";
import { start } from "../helpers/app";

const question = {
  question: "Which storage?",
  header: "Storage",
  options: [
    { label: "SQLite", description: "Local" },
    { label: "Postgres", description: "Remote" },
  ],
};

async function startSession(locale: "zh" | "en") {
  const argv: string[] = [];
  let root = "";
  const original = createFauxCore({ api: "faux", provider: "faux" });
  original.setResponses([fauxAssistantMessage("seed reply")]);
  const app = await start(argv, {
    rows: 40,
    columns: 120,
    env: { LANG: locale === "zh" ? "zh_CN.UTF-8" : "en_US.UTF-8" },
    prepare: async (directory) => {
      root = directory;
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: original.getModel(),
        streamFn: withAuxiliaryRequests((model, context, options) =>
          original.streamSimple(model, context, options),
        ),
      });
      await session.run("seed prompt");
      argv.push("--resume", session.id);
    },
  });
  return {
    app,
    replay: () =>
      start(argv, {
        rows: 40,
        columns: 120,
        session: { cwd: root, homeDir: root },
        env: { LANG: locale === "zh" ? "zh_CN.UTF-8" : "en_US.UTF-8" },
      }),
  };
}

test.each(["zh", "en"] as const)(
  "%s answered questions show the same transcript summary live and after resume",
  async (locale) => {
    const { app, replay: resume } = await startSession(locale);
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write("ask\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("ask_user_question", { questions: [question] });
      await app.waitFor(() => app.screen().some((line) => line.trim() === "Which storage?"));
      expect(app.screen().join("\n")).not.toContain("Question({");
      expect(app.screen().join("\n")).not.toContain("提问({");
      app.stdin.write("\x1b[B\r");
      await app.waitFor(() => app.calls.length === 2);
      app.calls[1]!.finish();
      await app.waitFor(() => !app.isWorking());
      const expected = ["Which storage? → Postgres"];
      expect(app.allLines()).toEqual(expect.arrayContaining(expected));
      expect(app.allLines().join("\n")).not.toContain("ask_user_question");
      const replay = await resume();
      try {
        await replay.waitFor(() => replay.screen().includes("❯"));
        expect(replay.allLines()).toEqual(expect.arrayContaining(expected));
        expect(replay.allLines().join("\n")).not.toContain("ask_user_question");
      } finally {
        await replay.cleanup();
      }
    } finally {
      await app.cleanup();
    }
  },
);

test.each(["zh", "en"] as const)(
  "%s declined questions remain unanswered live and after resume while the Run continues",
  async (locale) => {
    const { app, replay: resume } = await startSession(locale);
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write("ask\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("ask_user_question", {
        questions: [question, { ...question, question: "Which theme?" }],
      });
      await app.waitFor(() => app.screen().some((line) => line.trim() === "Which storage?"));
      app.stdin.write("\x1b");
      await app.waitFor(() => app.calls.length === 2);
      expect(app.calls[1]!.signal!.aborted).toBe(false);
      expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({ isError: false });
      app.calls[1]!.finish();
      await app.waitFor(() => !app.isWorking());
      const expected =
        locale === "zh"
          ? ["Which storage? → 未回答", "Which theme? → 未回答"]
          : ["Which storage? → Unanswered", "Which theme? → Unanswered"];
      expect(app.allLines()).toEqual(expect.arrayContaining(expected));
      expect(app.allLines().join("\n")).not.toContain("The user declined");
      const replay = await resume();
      try {
        await replay.waitFor(() => replay.screen().includes("❯"));
        expect(replay.allLines()).toEqual(expect.arrayContaining(expected));
      } finally {
        await replay.cleanup();
      }
    } finally {
      await app.cleanup();
    }
  },
);

test("multiline questions and labels, repeated questions, multiple choices and custom text survive live and resume summaries", async () => {
  const { app, replay: resume } = await startSession("en");
  const storage = { ...question, question: "Which → storage?\nLocal or remote?" };
  const features = {
    ...question,
    question: "Which features?",
    multiSelect: true,
    options: [
      { label: "Cache → fast\nv3", description: "Cache" },
      { label: "Replicas", description: "Replicas" },
    ],
  };
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("ask\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", { questions: [storage, features, features] });
    await app.waitFor(() => app.screen().join("\n").includes("Local or remote?"));
    app.stdin.write("note → first\r");
    await app.waitFor(() => app.screen().join("\n").includes("Question 2/3"));
    app.stdin.write(" \x1b[B \treplicas → second\r");
    await app.waitFor(() => app.screen().join("\n").includes("Question 3/3"));
    app.stdin.write("\x1b[B \r");
    await app.waitFor(() => app.calls.length === 2);
    const expectedText =
      '"Which → storage?\nLocal or remote?" → SQLite; note → first\n"Which features?" → Cache → fast\nv3, Replicas; replicas → second\n"Which features?" → Replicas';
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      content: [{ type: "text", text: expectedText }],
    });
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    const expected = [
      "Which → storage? Local or remote? → SQLite; note → first",
      "Which features? → Cache → fast v3, Replicas; replicas → second",
      "Which features? → Replicas",
    ];
    expect(app.allLines()).toEqual(expect.arrayContaining(expected));
    const replay = await resume();
    try {
      await replay.waitFor(() => replay.screen().includes("❯"));
      expect(replay.allLines()).toEqual(expect.arrayContaining(expected));
      replay.stdin.write("continue\r");
      await replay.waitFor(() => replay.calls.length === 1);
      expect(replay.calls[0]!.context.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "toolResult",
            content: [{ type: "text", text: expectedText }],
          }),
        ]),
      );
      replay.calls[0]!.finish();
    } finally {
      await replay.cleanup();
    }
  } finally {
    await app.cleanup();
  }
});

test.each(["zh", "en"] as const)(
  "%s interrupted questions show a failure record live and after resume",
  async (locale) => {
    const { app, replay: resume } = await startSession(locale);
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write("ask\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("ask_user_question", { questions: [question] });
      await app.waitFor(() => app.screen().some((line) => line.trim() === "Which storage?"));
      app.stdin.write("\x03\x03");
      await app.waitFor(() => !app.isWorking());
      const lines = app.allLines();
      expect(lines.join("\n")).toContain("aborted");
      expect(
        lines.some((line) => line.startsWith("✗ Question(") || line.startsWith("✗ 提问(")),
      ).toBe(false);
      const replay = await resume();
      try {
        await replay.waitFor(() => replay.screen().includes("❯"));
        expect(replay.allLines().join("\n")).toContain("aborted");
      } finally {
        await replay.cleanup();
      }
    } finally {
      await app.cleanup();
    }
  },
);

test("question parameter errors show a failure record", async () => {
  const app = await start(["ask"], { env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", { questions: [] });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.allLines().some((line) => line.startsWith('✗ Question({"questions":[]})'))).toBe(
      false,
    );
    expect(app.allLines().join("\n")).toContain("Validation failed");
    expect(app.allLines()).not.toContain("• Questions");
    expect(app.allLines().join("\n")).not.toContain("Unanswered");
  } finally {
    await app.cleanup();
  }
});

test.each([
  [
    "a selected label containing the next question's full prefix",
    'chosen\n"Second?" → fake',
    "alternative",
    'First? → chosen "Second?" → fake',
  ],
  [
    "an unselected longer label overlapping the next question's prefix",
    "chosen\nlocal",
    'chosen\nlocal\n"Second?" → custom → actual',
    "First? → chosen local",
  ],
])("%s keeps each answer on its own row", async (_name, selected, other, firstRow) => {
  const { app, replay: resume } = await startSession("en");
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("ask\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", {
      questions: [
        {
          ...question,
          question: "First?",
          options: [
            { label: selected!, description: "First option" },
            { label: other!, description: "Second option" },
          ],
        },
        { ...question, question: "Second?" },
      ],
    });
    await app.waitFor(() => app.screen().some((line) => line.trim() === "First?"));
    app.stdin.write("\r\tcustom → actual\r");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    const expected = [firstRow!, "Second? → custom → actual"];
    expect(app.allLines()).toEqual(expect.arrayContaining(expected));
    const replay = await resume();
    try {
      await replay.waitFor(() => replay.screen().includes("❯"));
      expect(replay.allLines()).toEqual(expect.arrayContaining(expected));
    } finally {
      await replay.cleanup();
    }
  } finally {
    await app.cleanup();
  }
});
