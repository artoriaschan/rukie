import { expect, test } from "bun:test";
import { start } from "../helpers/app";

const question = {
  question: "Which storage?",
  header: "Storage",
  multiSelect: false,
  options: [
    { label: "SQLite", description: "Local database" },
    { label: "Postgres", description: "Remote database" },
  ],
};

const themeQuestion = {
  ...question,
  header: "Theme",
  question: "Which theme?",
  options: [
    { label: "Light", description: "Bright interface" },
    { label: "Dark", description: "Dim interface" },
  ],
};

async function ask(questions = [question], options: Parameters<typeof start>[1] = {}) {
  const app = await start(["ask"], options);
  await app.waitFor(() => app.calls.length === 1);
  app.calls[0]!.tool("ask_user_question", { questions });
  await app.waitFor(() =>
    app.screen().some((line) => line.includes(questions[0]!.question.split("\n")[0]!)),
  );
  return app;
}
async function answer(app: Awaited<ReturnType<typeof start>>, keys: string, expected: string) {
  app.stdin.write(keys);
  await app.waitFor(() => app.calls.length === 2);
  expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
    isError: false,
    content: [{ type: "text", text: expected }],
  });
  app.calls[1]!.finish();
}

test.each([
  ["\x1b[B\r", "Postgres"],
  ["\x1b[A\x1b[A\r", "Postgres"],
  ["\x1b[B\x1b[A\r", "SQLite"],
])("question selection via %j", async (keys, expected) => {
  const app = await ask();
  try {
    await answer(app, keys!, `"Which storage?" → ${expected}`);
  } finally {
    await app.cleanup();
  }
});

test("ordinary numbers are attached text, rather than numeric selection shortcuts", async () => {
  const app = await ask();
  try {
    await answer(app, "2\r", '"Which storage?" → SQLite; 2');
  } finally {
    await app.cleanup();
  }
});

test.each(["\x1b", "\x03"])(
  "%j declines the first question while the Run continues",
  async (key) => {
    const app = await ask();
    try {
      app.stdin.write(key);
      await app.waitFor(() => app.calls.length === 2);
      expect(app.calls[1]!.signal!.aborted).toBe(false);
      expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
        isError: false,
        content: [{ type: "text", text: expect.stringContaining("The user declined to answer.") }],
      });
      app.calls[1]!.finish();
    } finally {
      await app.cleanup();
    }
  },
);

test("questions and permission approvals share one FIFO; always allow skips only approvals", async () => {
  const app = await start(["mixed calls"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools([
      { name: "bash", args: { command: "printf first-approval" } },
      { name: "ask_user_question", args: { questions: [question] } },
      { name: "bash", args: { command: "printf matching-approval" } },
      { name: "write", args: { path: "last-approval.txt", content: "test" } },
    ]);
    await app.waitFor(() => app.screen().some((line) => line.trim() === "printf first-approval"));
    app.stdin.write("2\r");
    await app.waitFor(() => app.screen().some((line) => line.includes("等待审批 · write")));
    expect(app.calls).toHaveLength(1);
    app.stdin.write("3\r");
    await app.waitFor(() => app.screen().some((line) => line.trim() === "Which storage?"));
    expect(app.calls).toHaveLength(1);
    app.stdin.write("\x1b[B\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(
      app.calls[1]!.context.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([
      { toolName: "bash", isError: false },
      {
        toolName: "ask_user_question",
        isError: false,
        content: [{ type: "text", text: '"Which storage?" → Postgres' }],
      },
      { toolName: "bash", isError: false },
      { toolName: "write", isError: true },
    ]);
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("English question hints use the frontend locale", async () => {
  const app = await ask([question], { env: { LANG: "en_US.UTF-8" } });
  try {
    const text = app.screen().join("\n");
    for (const hint of [
      "↑/↓ select",
      "Type text to attach an answer",
      "Enter submit",
      "Esc cancel",
      "Ctrl+K to fold",
    ])
      expect(text).toContain(hint);
    expect(text).not.toMatch(/\p{Script=Han}/u);
    await answer(app, "\r", '"Which storage?" → SQLite');
  } finally {
    await app.cleanup();
  }
});

test("long options stay inside a short dialog and the window follows keyboard focus", async () => {
  const options = ["One", "Two", "Three", "Four"].map((label) => ({
    label,
    description: "long description ".repeat(20),
  }));
  const app = await ask([{ ...question, options }], { columns: 40, rows: 12 });
  try {
    app.stdin.write("\x1b[B\x1b[B\x1b[B");
    await app.waitFor(() => app.screen().some((line) => line.includes("❯● Four")));
    expect(app.screen()).toHaveLength(12);
    expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
    expect(app.screen().at(-1)).toContain("esc");
    await answer(app, "\r", '"Which storage?" → Four');
  } finally {
    await app.cleanup();
  }
});

test("multiline model copy cannot displace the input or hints on a short terminal", async () => {
  const app = await ask(
    [
      {
        ...question,
        header: "Storage\nextra header",
        question: "Which storage?\nextra question\nlast question",
        options: [
          { label: "SQLite\nExtra label", description: "Local\ndatabase" },
          question.options[1]!,
        ],
      },
    ],
    { columns: 40, rows: 12 },
  );
  try {
    expect(app.screen().join("\n")).toContain("SQLite Extra label");
    expect(app.screen().join("\n")).toContain("Enter 提交");
    expect(app.screen().at(-1)).toContain("esc");
    await answer(app, "\x1b[B\r", '"Which storage?\nextra question\nlast question" → Postgres');
  } finally {
    await app.cleanup();
  }
});

test("Space toggles multiple choices; Enter requires at least one choice or custom text", async () => {
  const app = await ask([{ ...question, multiSelect: true }]);
  try {
    app.stdin.write("\r");
    await app.waitFor(() => app.screen().some((line) => line.includes("至少选择一个选项")));
    expect(app.calls).toHaveLength(1);
    app.stdin.write(" ");
    await app.waitFor(() => app.screen().some((line) => line.includes("◉ SQLite")));
    app.stdin.write("\x1b[B  ");
    await app.waitFor(() => app.screen().some((line) => line.includes("○ Postgres")));
    await answer(app, " \r", '"Which storage?" → SQLite, Postgres');
  } finally {
    await app.cleanup();
  }
});

test("the permanent custom row accepts a custom-only answer and rejects an empty answer", async () => {
  const app = await ask();
  try {
    app.stdin.write("\t\r");
    await app.waitFor(() => app.screen().some((line) => line.includes("先输入回答内容")));
    expect(app.calls).toHaveLength(1);
    await answer(
      app,
      "\x1b[200~Redis\r\nwith cache\x1b[201~\r",
      '"Which storage?" → Redis with cache',
    );
  } finally {
    await app.cleanup();
  }
});

test.each([false, true])(
  "multiSelect %s keeps choices with an attached answer",
  async (multiSelect) => {
    const app = await ask([{ ...question, multiSelect }], { env: { LANG: "en_US.UTF-8" } });
    try {
      await answer(
        app,
        `\x1b[B${multiSelect ? " \t" : ""}use replicas\t\r`,
        '"Which storage?" → Postgres; use replicas',
      );
    } finally {
      await app.cleanup();
    }
  },
);

test("clearing attached text removes the selected-label attachment", async () => {
  const app = await ask();
  try {
    await answer(app, "a\x7f\tRedis\r", '"Which storage?" → Redis');
  } finally {
    await app.cleanup();
  }
});

test.each(["\x1b", "\x03"])(
  "%j from the custom row declines instead of submitting its draft",
  async (key) => {
    const app = await ask();
    try {
      app.stdin.write("\tunsent");
      await app.waitFor(() => app.screen().some((line) => line.includes("unsent")));
      app.stdin.write(key);
      await app.waitFor(() => app.calls.length === 2);
      expect(app.calls[1]!.signal!.aborted).toBe(false);
      expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
        content: [{ type: "text", text: expect.stringContaining("The user declined to answer.") }],
      });
      app.calls[1]!.finish();
    } finally {
      await app.cleanup();
    }
  },
);

test("a long CJK custom response keeps its caret and tail on one row in a short terminal", async () => {
  const app = await ask([question], { columns: 40, rows: 12 });
  const custom = "long response ".repeat(20) + "界👩‍💻 tail";
  try {
    app.stdin.write(`\t\x1b[200~${custom}\x1b[201~`);
    await app.waitFor(() => app.screen().some((line) => line.includes("tail")));
    expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
    expect(app.screen().at(-1)).toContain("esc");
    await answer(app, "\r", `"Which storage?" → ${custom}`);
  } finally {
    await app.cleanup();
  }
});

test("each confirmation advances and submits ordered answers only after the last question", async () => {
  const app = await ask([question, themeQuestion]);
  try {
    app.stdin.write("\x1b[B\r");
    await app.waitFor(() => app.screen().some((line) => line.includes("第 2/2 题")));
    expect(app.calls).toHaveLength(1);
    await answer(app, "\r", '"Which storage?" → Postgres\n"Which theme?" → Light');
  } finally {
    await app.cleanup();
  }
});

test("switching four questions preserves choices, checked sets, text and caret for revision", async () => {
  const app = await ask([
    question,
    { ...question, question: "Which features?", multiSelect: true },
    themeQuestion,
    { ...themeQuestion, question: "Which editor?" },
  ]);
  try {
    app.stdin.write("\x1b[Bcache\x1b[C \x1b[B replicas\x1b[C");
    await app.waitFor(() => app.screen().some((line) => line.includes("第 3/4 题")));
    app.stdin.write("\x1b[D\x1b[D first\r");
    await app.waitFor(() => app.screen().some((line) => line.includes("Which features?")));
    expect(app.screen().join("\n")).toContain("◉ SQLite");
    expect(app.screen().join("\n")).toContain("◉ Postgres");
    expect(app.screen().join("\n")).toContain("replicas");
    app.stdin.write("\x1b[A \r\x1b[B\r");
    await app.waitFor(() => app.screen().some((line) => line.includes("第 4/4 题")));
    app.stdin.write("\x1b[D\x1b[D\x1b[D");
    await app.waitFor(() => app.screen().some((line) => line.includes("cache first")));
    await answer(
      app,
      "\r\r\r\r",
      '"Which storage?" → Postgres; cache first\n"Which features?" → Postgres; replicas\n"Which theme?" → Dark\n"Which editor?" → Light',
    );
  } finally {
    await app.cleanup();
  }
});

test.each([0, 1, 2, 3])("Ctrl+C from question %i cancels the entire batch", async (index) => {
  const app = await ask([question, themeQuestion, question, themeQuestion]);
  try {
    app.stdin.write("\x1b[C".repeat(index) + "discard this\x03");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.signal!.aborted).toBe(false);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("The user declined to answer.") }],
    });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("the last question returns to skipped questions before submitting a batch", async () => {
  const app = await ask([question, themeQuestion]);
  try {
    app.stdin.write("\x1b[B\x1b[C\x1b[B\r");
    await app.waitFor(
      () =>
        app.screen().some((line) => line.includes("第 1/2 题")) &&
        app.screen().some((line) => line.includes("❯● Postgres")),
    );
    expect(app.calls).toHaveLength(1);
    expect(app.screen().join("\n")).toContain("❯● Postgres");
    await answer(app, "\r\r", '"Which storage?" → Postgres\n"Which theme?" → Dark');
  } finally {
    await app.cleanup();
  }
});

test.each(["zh", "en"])(
  "%s progress and switching hints remain usable at 40 by 12",
  async (locale) => {
    const app = await ask([question, themeQuestion], {
      columns: 40,
      rows: 12,
      env: { LANG: locale === "en" ? "en_US.UTF-8" : "zh_CN.UTF-8" },
    });
    try {
      expect(app.screen().join("\n")).toContain(locale === "en" ? "Question 1/2" : "第 1/2 题");
      expect(app.screen().join("\n")).toContain("←→");
      expect(app.screen().join("\n")).toContain(locale === "en" ? "Enter submit" : "Enter 提交");
      if (locale === "en") expect(app.screen().join("\n")).not.toMatch(/\p{Script=Han}/u);
      expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
      await answer(app, "\r\r", '"Which storage?" → SQLite\n"Which theme?" → Light');
    } finally {
      await app.cleanup();
    }
  },
);
