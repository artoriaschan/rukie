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

test("single-choice questions show options and return the selected label without changing the draft", async () => {
  const app = await start(["choose storage"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("next draft");
    await app.waitFor(() => app.screen().includes("❯ next draft"));
    app.calls[0]!.tool("ask_user_question", { questions: [question] });
    await app.waitFor(() => app.screen().join("\n").includes("Which storage?"));
    expect(app.screen().join("\n")).toContain("Storage");
    expect(app.screen().join("\n")).toContain("Local database");
    expect(app.screen().join("\n")).toContain("Remote database");
    app.stdin.write("ignored\x1b[200~pasted\x1b[201~\x1b[B\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      isError: false,
      content: [{ type: "text", text: '"Which storage?" → Postgres' }],
    });
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen()).toContain("❯ next draft");
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["2\r", "Postgres"],
  ["\x1b[A\r", "Postgres"],
  ["\x1b[B\x1b[A\r", "SQLite"],
])("question selection via %j", async (keys, expected) => {
  const app = await start(["ask"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", { questions: [question] });
    await app.waitFor(() => app.screen().some((line) => line.trim() === "Which storage?"));
    app.stdin.write(keys!);
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      isError: false,
      content: [{ type: "text", text: `"Which storage?" → ${expected}` }],
    });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("Esc declines the entire question and the Run continues", async () => {
  const app = await start(["ask"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", { questions: [question] });
    await app.waitFor(() => app.screen().some((line) => line.trim() === "Which storage?"));
    app.stdin.write("\x1b");
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
});

test("Ctrl+C cancels a question and restores its untouched prompt draft", async () => {
  const app = await start(["ask"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("next draft");
    await app.waitFor(() => app.screen().includes("❯ next draft"));
    app.calls[0]!.tool("ask_user_question", { questions: [question] });
    await app.waitFor(() => app.screen().some((line) => line.trim() === "Which storage?"));
    app.stdin.write("2\x03");
    await app.waitFor(() => !app.isWorking());
    expect(app.screen()).toContain("❯ next draft");
    expect(app.calls.every((call) => call.signal!.aborted)).toBe(true);
    const next = app.calls.length;
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === next + 1);
    expect(app.calls[next]!.context.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "next draft" }],
    });
    expect(
      JSON.stringify(
        app.calls[next]!.context.messages.filter((message) => message.role === "toolResult"),
      ),
    ).not.toContain("→");
    app.calls[next]!.finish();
  } finally {
    await app.cleanup();
  }
});

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
    app.stdin.write("2\r");
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
  const app = await start(["ask"], { env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", { questions: [question] });
    await app.waitFor(() => app.screen().some((line) => line.trim() === "Which storage?"));
    expect(app.screen().join("\n")).toContain("↑↓/1-9 select · Enter confirm · Esc deny");
    expect(app.screen().join("\n")).not.toMatch(/\p{Script=Han}/u);
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("narrow and short terminals keep long options inside the dialog budget", async () => {
  const app = await start(["ask"], { columns: 40, rows: 12 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    const options = ["One", "Two", "Three", "Four"].map((label) => ({
      label,
      description: "long description ".repeat(20),
    }));
    app.calls[0]!.tool("ask_user_question", { questions: [{ ...question, options }] });
    await app.waitFor(() => app.screen().some((line) => line.trim() === "Which storage?"));
    app.stdin.write("4");
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ 4. Four")));
    expect(app.screen()).toHaveLength(12);
    expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
    expect(app.screen().at(-1)).toContain("esc");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      content: [{ type: "text", text: '"Which storage?" → Four' }],
    });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("multiline model copy cannot displace choices or hints on a short terminal", async () => {
  const app = await start(["ask"], { columns: 40, rows: 12 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", {
      questions: [
        {
          ...question,
          header: "Storage\nextra header\nlast header",
          question: "Which storage?\nextra question\nlast question",
          options: [
            { label: "SQLite\nExtra label", description: "Local\ndatabase" },
            { label: "Postgres", description: "Remote\ndatabase" },
          ],
        },
      ],
    });
    await app.waitFor(() => app.screen().some((line) => line.includes("Storage")));
    expect(app.screen().join("\n")).toContain("1. SQLite");
    expect(app.screen().join("\n")).toContain("2. Postgres");
    expect(app.screen().join("\n")).toContain("Enter确认");
    expect(app.screen().at(-1)).toContain("esc");
    app.stdin.write("2\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      isError: false,
      content: [
        { type: "text", text: '"Which storage?\nextra question\nlast question" → Postgres' },
      ],
    });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});
