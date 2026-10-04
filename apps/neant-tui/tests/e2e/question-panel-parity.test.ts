import { expect, test } from "bun:test";
import { dark } from "@neant/tui";
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

test("questions use the dsh title, chip, two-line choices and permanent custom answer while todos stay visible", async () => {
  const app = await start(["plan"], { rows: 32 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("todo_write", {
      todos: [{ content: "Pick storage", status: "in_progress" }],
    });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.tool("ask_user_question", { questions: [question] });
    await app.waitFor(() => app.screen().some((line) => line.includes("Which storage?")));
    const lines = app.screen();
    expect(lines).toContain("  ▾ ✓ 0/1");
    expect(lines).toContain("  └─ ● Pick storage");
    expect(
      lines.some((line) => line.startsWith("  ─ ▾") && line.includes("📋 提问 · 第 1/1 题")),
    ).toBe(true);
    expect(lines).toContain("  ◈ Storage");
    expect(lines).toContain("  ❯● SQLite");
    expect(lines[lines.indexOf("  ❯● SQLite") + 1]).toBe("     Local database");
    expect(
      lines.some((line) => line.includes("✎ 自定义回答：") && line.includes("直接输入…")),
    ).toBe(true);
    expect(lines.join(" ").replace(/\s+/g, " ")).toContain("Ctrl+K 折叠");
    const selected = lines.indexOf("  ❯● SQLite");
    const cell = app.terminal.buffer.active.getLine(selected)!.getCell(5)!;
    expect(cell.getFgColor()).toBe(Number.parseInt(dark.accent.slice(1), 16));
    expect(cell.isBold()).toBeTruthy();
  } finally {
    await app.cleanup();
  }
});

test("typing on an option attaches an answer; Tab edits it without changing the composer draft", async () => {
  const app = await start(["ask"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("next draft");
    app.calls[0]!.tool("ask_user_question", { questions: [question] });
    await app.waitFor(() => app.screen().some((line) => line.includes("Which storage?")));
    app.stdin.write("cache\t\x1b[Hwith \r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      content: [{ type: "text", text: '"Which storage?" → SQLite; with cache' }],
    });
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen()).toContain("❯ next draft");
  } finally {
    await app.cleanup();
  }
});

test("Esc goes back on a later question and Ctrl+C declines the batch without interrupting the Run", async () => {
  const app = await start(["ask"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", {
      questions: [question, { ...question, question: "Second?", header: "Second" }],
    });
    await app.waitFor(() => app.screen().some((line) => line.includes("Which storage?")));
    app.stdin.write("\x1b[C\x1b[27;1;27~");
    await app.waitFor(() => app.screen().some((line) => line.includes("第 1/2 题")));
    expect(app.calls).toHaveLength(1);
    app.stdin.write("\x1b[C\x03");
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

test("folding preserves question drafts, permits composing, and Esc expands without declining", async () => {
  const app = await start(["ask"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", { questions: [question] });
    await app.waitFor(() => app.screen().some((line) => line.includes("Which storage?")));
    app.stdin.write("cache\t\x1b[H\x0b");
    await app.waitFor(() => app.screen().some((line) => line.includes("正在等你回答")));
    app.stdin.write("next draft");
    await app.waitFor(() => app.screen().includes("❯ next draft"));
    app.stdin.write("\x1b[27;1;27~with \r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      content: [{ type: "text", text: '"Which storage?" → SQLite; with cache' }],
    });
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen()).toContain("❯ next draft");
  } finally {
    await app.cleanup();
  }
});

test("hover and clicks fold the header and submit a single choice with attached text", async () => {
  const app = await start(["ask"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", { questions: [question] });
    await app.waitFor(() => app.screen().some((line) => line.includes("❯● SQLite")));
    const header = app.screen().findIndex((line) => line.includes("─ ▾"));
    const cell = () => app.terminal.buffer.active.getLine(header)!.getCell(2)!;
    app.stdin.write(`\x1b[<35;3;${header + 1}M`);
    await app.waitFor(
      () => cell().getBgColor() === parseInt(dark.badgeHoverBackground.slice(1), 16),
    );
    app.stdin.write(`\x1b[<0;3;${header + 1}M\x1b[<0;3;${header + 1}m`);
    await app.waitFor(() =>
      app.screen().some((line) => line.includes("▸") && line.includes("提问")),
    );
    const folded = app.screen().findIndex((line) => line.includes("▸") && line.includes("提问"));
    app.stdin.write(`\x1b[<0;3;${folded + 1}M\x1b[<0;3;${folded + 1}m`);
    await app.waitFor(() => app.screen().some((line) => line.includes("❯● SQLite")));
    app.stdin.write("with replicas");
    await app.waitFor(() => app.screen().some((line) => line.includes("with replicas")));
    const row = app.screen().findIndex((line) => line.includes("○ Postgres"));
    app.stdin.write(`\x1b[<0;6;${row + 1}M\x1b[<0;6;${row + 1}m`);
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      content: [{ type: "text", text: '"Which storage?" → Postgres; with replicas' }],
    });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test.each(["zh_CN.UTF-8", "en_US.UTF-8"])(
  "long todos and questions remain independently operable through resizing in %s",
  async (lang) => {
    const app = await start(["ask"], { columns: 40, rows: 12, env: { LANG: lang } });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("todo_write", {
        todos: Array.from({ length: 10 }, (_, index) => ({
          content: `task-${index}`,
          status: "pending",
        })),
      });
      await app.waitFor(() => app.calls.length === 2);
      app.calls[1]!.tool("ask_user_question", { questions: [question] });
      await app.waitFor(() => app.screen().some((line) => line.includes("Which storage?")));
      expect(app.screen().some((line) => line.includes("▾ ✓ 0/10"))).toBe(true);
      expect(app.screen().some((line) => line.includes("✎"))).toBe(true);
      expect(app.screen().at(-1)).toContain("esc");
      expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
      app.stdin.write("\x11\x0b");
      await app.waitFor(
        () => app.screen().some((line) => line.includes("▸ ✓ 0/10")) && app.screen().includes("❯"),
      );
      expect(app.screen().at(-1)).toContain("esc");
      app.resize(80, 32);
      await app.waitFor(() =>
        app.screen().some((line) => line.includes("task-0") && line.includes("└─")),
      );
      app.stdin.write("\x0b\x11\x1b[B\r");
      await app.waitFor(() => app.calls.length === 3);
      expect(app.calls[2]!.context.messages.at(-1)).toMatchObject({
        content: [{ type: "text", text: '"Which storage?" → Postgres' }],
      });
      app.calls[2]!.finish();
    } finally {
      await app.cleanup();
    }
  },
);

test("pastes stay inline, never submit, and reject an oversized paste without losing the draft", async () => {
  const app = await start(["ask"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", { questions: [question] });
    await app.waitFor(() => app.screen().some((line) => line.includes("Which storage?")));
    app.stdin.write("\t\x1b[200~Redis\r\nwith\tcache\x1b[201~");
    await app.waitFor(() => app.screen().some((line) => line.includes("Redis with cache")));
    expect(app.calls).toHaveLength(1);
    app.stdin.write(`\x1b[200~${"界".repeat(8001)}\x1b[201~`);
    await app.waitFor(() => app.screen().some((line) => line.includes("8000")));
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      content: [{ type: "text", text: '"Which storage?" → Redis with cache' }],
    });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test.skipIf(process.platform !== "darwin")(
  "Ctrl+V and Alt+V read clipboard text at the caret without submitting",
  async () => {
    const { chmod, mkdir } = await import("node:fs/promises");
    const oldPath = process.env.PATH;
    const app = await start(["ask"], {
      prepare: async (root) => {
        await mkdir(`${root}/bin`);
        await Bun.write(`${root}/bin/pbpaste`, "#!/bin/sh\nprintf 'clip\\nboard'\n");
        await chmod(`${root}/bin/pbpaste`, 0o755);
        process.env.PATH = `${root}/bin:${oldPath}`;
      },
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("ask_user_question", { questions: [question] });
      await app.waitFor(() => app.screen().some((line) => line.includes("Which storage?")));
      app.stdin.write("\tend\x1b[H\x16");
      await app.waitFor(() => app.screen().some((line) => line.includes("clip boardend")));
      expect(app.calls).toHaveLength(1);
      app.stdin.write("\x1b[H\x1bv");
      await app.waitFor(() =>
        app.screen().some((line) => line.includes("clip boardclip boardend")),
      );
      app.stdin.write("\r");
      await app.waitFor(() => app.calls.length === 2);
      expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
        content: [{ type: "text", text: '"Which storage?" → clip boardclip boardend' }],
      });
      app.calls[1]!.finish();
    } finally {
      process.env.PATH = oldPath;
      await app.cleanup();
    }
  },
);

test("question IME anchors keep normal text style on option focus and a block caret on input focus", async () => {
  const app = await start(["ask"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", { questions: [question] });
    await app.waitFor(() => app.screen().some((line) => line.includes("Which storage?")));
    const cell = () =>
      app.terminal.buffer.active
        .getLine(app.terminal.buffer.active.cursorY)!
        .getCell(app.terminal.buffer.active.cursorX)!;
    const customRow = () => app.screen().findIndex((line) => line.includes("✎"));
    expect(app.terminal.buffer.active.cursorY).toBe(customRow());
    expect(cell().isDim()).toBeFalsy();
    expect(cell().getFgColor()).toBe(parseInt(dark.text.slice(1), 16));
    app.stdin.write("中文👩‍💻\t\x1b[D\x7fA\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      content: [{ type: "text", text: '"Which storage?" → SQLite; 中A👩‍💻' }],
    });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test.each([12, 16, 20, 24])(
  "long question copy and many todos fit a %i-row dock at three widths",
  async (rows) => {
    const app = await start(["ask"], { columns: 40, rows });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("todo_write", {
        todos: Array.from({ length: 10 }, (_, index) => ({
          content: `task-${index}`,
          status: "pending",
        })),
      });
      await app.waitFor(() => app.calls.length === 2);
      app.calls[1]!.tool("ask_user_question", {
        questions: [
          {
            ...question,
            question: "Which storage?\n" + "long question ".repeat(30),
            options: Array.from({ length: 4 }, (_, index) => ({
              label: `Option-${index}`,
              description: "Long description ".repeat(30),
            })),
          },
        ],
      });
      await app.waitFor(() => app.screen().some((line) => line.includes("Option-0")));
      for (const columns of [40, 60, 80]) {
        app.resize(columns, rows);
        await app.waitFor(
          () =>
            app.screen().at(-1)!.includes("esc") && app.screen().some((line) => line.includes("✎")),
        );
        expect(app.screen().some((line) => line.includes("▾ ✓ 0/10"))).toBe(true);
        expect(app.screen().some((line) => line.includes("Enter"))).toBe(true);
        expect(app.screen().every((line) => Bun.stringWidth(line) <= columns)).toBe(true);
      }
      app.stdin.write("\t\r");
      await app.waitFor(() => app.screen().some((line) => line.includes("先输入回答")));
      expect(app.screen().at(-1)).toContain("esc");
    } finally {
      await app.cleanup();
    }
  },
);

test("mouse checks and the submit row return checked labels without moving focus", async () => {
  const app = await start(["ask"], { rows: 32 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", { questions: [{ ...question, multiSelect: true }] });
    await app.waitFor(() => app.screen().some((line) => line.includes("❯○ SQLite")));
    const row = app.screen().findIndex((line) => line.includes("○ Postgres"));
    app.stdin.write(`\x1b[<0;6;${row + 1}M\x1b[<0;6;${row + 1}m`);
    await app.waitFor(() => app.screen().some((line) => line.includes("✓ 提交选择")));
    expect(app.screen().join("\n")).toContain("❯○ SQLite");
    expect(app.screen().join("\n")).toContain("◉ Postgres");
    const submit = app.screen().findIndex((line) => line.includes("✓ 提交选择"));
    app.stdin.write(`\x1b[<0;3;${submit + 1}M\x1b[<0;3;${submit + 1}m`);
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      content: [{ type: "text", text: '"Which storage?" → Postgres' }],
    });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("caret arrows edit within an answer; only plain arrows at its boundaries switch questions", async () => {
  const app = await start(["ask"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", {
      questions: [question, { ...question, question: "Second?" }],
    });
    await app.waitFor(() => app.screen().some((line) => line.includes("Which storage?")));
    app.stdin.write("\tab\x1b[DZ\x1b[1;5CX\x1b[H\x1b[D\x1b[F\x1b[C");
    await app.waitFor(() => app.screen().some((line) => line.includes("第 2/2 题")));
    app.stdin.write("\x1b[D");
    await app.waitFor(() => app.screen().some((line) => line.includes("aZbX")));
    app.stdin.write("\r\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      content: [{ type: "text", text: '"Which storage?" → aZbX\n"Second?" → SQLite' }],
    });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});
