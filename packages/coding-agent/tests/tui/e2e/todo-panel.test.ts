import { startWithClock } from "../helpers/clock-app";
import { auxiliaryModels } from "../helpers/auxiliary-model.ts";
import { expect, test } from "bun:test";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession } from "@rukie/agent";
import { dark } from "../../../src/ink/index.ts";
import { start } from "../helpers/app";

test("Ctrl+Q folds during a Run to the first in-progress row, unfolds, and preserves the idle draft", async () => {
  const app = await start(["plan"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("todo_write", {
      todos: [
        { content: "done", status: "completed" },
        { content: "next", status: "pending" },
        { content: "current", status: "in_progress" },
        { content: "parallel", status: "in_progress" },
      ],
    });
    await app.waitFor(() => app.calls.length === 2 && app.screen().includes("  ▾ ✓ 1/4"));
    app.stdin.write("\x11");
    await app.waitFor(() => app.screen().includes("  ▸ ✓ 1/4"));
    let header = app.screen().indexOf("  ▸ ✓ 1/4");
    expect(app.screen()[header + 1]).toBe("  └─ ● current");
    expect(app.screen()[header + 2]).not.toContain("─");
    expect(app.isWorking()).toBe(true);
    expect(app.calls[1]!.signal!.aborted).toBe(false);
    app.stdin.write("\x11");
    await app.waitFor(() => app.screen().includes("  └─ ● parallel"));
    expect(app.screen()).toContain("  ├─ ○ next");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("draft\x11");
    await app.waitFor(() => app.screen().includes("  ▸ ✓ 1/4"));
    header = app.screen().indexOf("  ▸ ✓ 1/4");
    expect(app.screen()[header + 1]).toBe("  └─ ● current");
    expect(app.screen()).toContain("❯ draft");
    app.stdin.write("\x11\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(app.calls[2]!.context.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "draft" }],
    });
  } finally {
    await app.cleanup();
  }
});

test("the fold header reacts to hover and mouse clicks, previewing the first unfinished row", async () => {
  const app = await start(["plan"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("todo_write", {
      todos: [
        { content: "done", status: "completed" },
        { content: "first", status: "pending" },
        { content: "second", status: "pending" },
      ],
    });
    await app.waitFor(() => app.calls.length === 2 && app.screen().includes("  ▾ ✓ 1/3"));
    const header = app.screen().indexOf("  ▾ ✓ 1/3");
    const cell = () => app.terminal.buffer.active.getLine(header)!.getCell(2)!;
    const original = cell().getBgColor();
    app.stdin.write(`\x1b[<35;3;${header + 1}M`);
    await app.waitFor(() => cell().getBgColor() !== original);
    expect(cell().getBgColor()).toBe(Number.parseInt(dark.badgeHoverBackground.slice(1), 16));
    app.stdin.write("\x1b[<35;1;1M");
    await app.waitFor(() => cell().getBgColor() === original);
    app.stdin.write(`\x1b[<0;3;${header + 1}M\x1b[<0;3;${header + 1}m`);
    await app.waitFor(() => app.screen().includes("  ▸ ✓ 1/3"));
    expect(app.screen()[app.screen().indexOf("  ▸ ✓ 1/3") + 1]).toBe("  └─ ○ first");
    expect(app.screen()).not.toContain("  └─ ○ second");
    const foldedHeader = app.screen().indexOf("  ▸ ✓ 1/3");
    app.stdin.write(`\x1b[<0;3;${foldedHeader + 1}M\x1b[<0;3;${foldedHeader + 1}m`);
    await app.waitFor(() => app.screen().includes("  └─ ○ second"));
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["zh_CN.UTF-8", "Ctrl+Q 折叠"],
  ["en_US.UTF-8", "Ctrl+Q fold"],
])("the expanded fold hint follows Locale %s and disappears when folded", async (lang, hint) => {
  const app = await start(["plan"], { env: { LANG: lang } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("todo_write", { todos: [{ content: "open", status: "pending" }] });
    await app.waitFor(() => app.calls.length === 2 && app.screen().includes(`    ${hint}`));
    const lines = app.screen();
    expect(lines[lines.indexOf("  └─ ○ open") + 1]).toBe(`    ${hint}`);
    app.stdin.write("\x11");
    await app.waitFor(() => app.screen().includes("  ▸ ✓ 0/1"));
    expect(app.screen().some((line) => line.includes("Ctrl+Q"))).toBe(false);
    app.stdin.write("\x11");
    await app.waitFor(() => app.screen().includes(`    ${hint}`));
  } finally {
    await app.cleanup();
  }
});

test("a running Run shows the Todo List as eight ordered tree rows with full progress and overflow", async () => {
  const app = await start(["plan"], { columns: 60, rows: 30 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("todo_write", {
      todos: [
        { content: "finished", status: "completed" },
        { content: "current", status: "in_progress" },
        { content: "next", status: "pending" },
        { content: "long " + "界".repeat(80) + "\nsecond line", status: "pending" },
        ...Array.from({ length: 6 }, (_, index) => ({
          content: `later-${index}`,
          status: "pending",
        })),
      ],
    });
    await app.waitFor(() => app.calls.length === 2 && app.screen().includes("  ▾ ✓ 1/10"));
    const lines = app.screen();
    const header = lines.indexOf("  ▾ ✓ 1/10");
    expect(lines.slice(header + 1, header + 4)).toEqual([
      "  ├─ ✓ finished",
      "  ├─ ● current",
      "  ├─ ○ next",
    ]);
    expect(lines[header + 4]).toStartWith("  ├─ ○ long ");
    expect(lines[header + 5]).toBe("  ├─ ○ later-0");
    expect(lines.slice(header + 6, header + 10)).toEqual([
      "  ├─ ○ later-1",
      "  ├─ ○ later-2",
      "  ├─ ○ later-3",
      "  └─ … 还有 2 项",
    ]);
    const cell = (row: number, column: number) =>
      app.terminal.buffer.active.getLine(row)!.getCell(column)!;
    expect(cell(header + 1, 2).isDim()).toBeTruthy();
    expect(cell(header + 1, 7).isDim()).toBeTruthy();
    expect(cell(header + 2, 2).isDim()).toBeTruthy();
    expect(cell(header + 2, 5).getFgColor()).toBe(Number.parseInt(dark.accent.slice(1), 16));
    expect(cell(header + 2, 7).isDim()).toBeFalsy();
    expect(cell(header + 3, 5).isDim()).toBeTruthy();
  } finally {
    await app.cleanup();
  }
});

test("idle hides completed rows but keeps full counts, and completion or clearing removes the panel", async () => {
  const app = await start(["plan"]);
  const header = () => app.screen().some((line) => line.includes("▾ ✓"));
  try {
    await app.waitFor(() => app.calls.length === 1);
    expect(header()).toBe(false);
    app.calls[0]!.tool("todo_write", {
      todos: [
        { content: "done", status: "completed" },
        { content: "open", status: "pending" },
      ],
    });
    await app.waitFor(() => app.calls.length === 2 && app.screen().includes("  ├─ ✓ done"));
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking() && app.screen().includes("  └─ ○ open"));
    expect(app.screen()).toContain("  ▾ ✓ 1/2");
    expect(app.screen()).not.toContain("  ├─ ✓ done");
    app.stdin.write("finish\r");
    await app.waitFor(() => app.calls.length === 3 && app.screen().includes("  ├─ ✓ done"));
    app.calls[2]!.tool("todo_write", {
      todos: [{ content: "all done", status: "completed" }],
    });
    await app.waitFor(() => app.calls.length === 4 && app.screen().includes("  ▾ ✓ 1/1"));
    expect(app.screen()).toContain("  └─ ✓ all done");
    app.calls[3]!.finish();
    await app.waitFor(() => !app.isWorking() && !header());
    app.stdin.write("clear\r");
    await app.waitFor(() => app.calls.length === 5 && header());
    app.calls[4]!.tool("todo_write", { todos: [] });
    await app.waitFor(() => app.calls.length === 6 && !header());
  } finally {
    await app.cleanup();
  }
});

test.each(["permission", "question"])(
  "a %s dialog keeps the Todo List above the dialog and input",
  async (kind) => {
    const app = await start(["plan"]);
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("todo_write", { todos: [{ content: "open", status: "pending" }] });
      await app.waitFor(() => app.calls.length === 2 && app.screen().includes("  ▾ ✓ 0/1"));
      if (kind === "permission")
        app.calls[1]!.tool("bash", { command: "printf approved", description: "Run test command" });
      else
        app.calls[1]!.tool("ask_user_question", {
          questions: [
            {
              question: "Which option?",
              header: "Options",
              multiSelect: false,
              options: [
                { label: "One", description: "First" },
                { label: "Two", description: "Second" },
              ],
            },
          ],
        });
      await app.waitFor(() =>
        app
          .screen()
          .some((line) => line.includes(kind === "permission" ? "等待审批" : "Which option?")),
      );
      const lines = app.screen();
      expect(lines).toContain("  ▾ ✓ 0/1");
      expect(lines).toContain("  └─ ○ open");
      const dialog = lines.findIndex((line) =>
        line.includes(kind === "permission" ? "等待审批" : "📋 提问"),
      );
      expect(dialog).toBeGreaterThan(lines.indexOf("  └─ ○ open"));
      expect(lines.indexOf("❯")).toBeGreaterThan(dialog);
      expect(lines.at(-1)).toContain("esc");
      if (kind === "permission") {
        expect(
          lines
            .slice(
              lines.indexOf("  ▾ ✓ 0/1"),
              lines.findIndex((line) => line.startsWith("╭")),
            )
            .filter((line) => line.trim())
            .map((line) => (line.includes("等待审批") ? "PermissionDialog" : line.trim())),
        ).toEqual([
          "▾ ✓ 0/1",
          "└─ ○ open",
          "Ctrl+Q 折叠",
          "PermissionDialog",
          "printf approved",
          "要允许这次操作吗？",
          "❯ 1. 允许（仅本次）",
          "2. 本 session 允许此命令",
          "3. 拒绝",
          "↑↓选择 · Enter确认 · Esc拒绝 · Tab详情",
        ]);
      }
      app.stdin.write("\x1b");
      await app.waitFor(() => app.calls.length === 3 && app.screen().includes("  ▾ ✓ 0/1"));
      expect(app.screen()).toContain("  └─ ○ open");
    } finally {
      await app.cleanup();
    }
  },
);

test.each([
  ["permission", 12],
  ["question", 12],
  ["permission", 24],
  ["question", 24],
] as const)(
  "a %s dialog at %i rows preserves a multiline draft and a Todo preview",
  async (kind, rows) => {
    const app = await startWithClock(["plan"], { columns: 40, rows });
    const draft = "first draft\nsecond draft\nlast draft";
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("todo_write", {
        todos: [
          { content: "current", status: "in_progress" },
          { content: "next", status: "pending" },
        ],
      });
      await app.waitFor(() => app.calls.length === 2);
      app.stdin.write(`\x1b[200~${draft}\x1b[201~`);
      await app.waitFor(() => app.screen().some((line) => line.includes("last draft")));
      if (rows === 12) {
        app.stdin.write("\x1b[5~");
        await app.waitFor(() => app.screen().some((line) => line.includes("回到底部")));
      }
      if (kind === "permission")
        app.calls[1]!.tool("bash", { command: "printf approved", description: "Run test command" });
      else
        app.calls[1]!.tool("ask_user_question", {
          questions: [
            {
              question: "Choose?",
              header: "Options",
              multiSelect: false,
              options: [
                { label: "One", description: "First" },
                { label: "Two", description: "Second" },
              ],
            },
          ],
        });
      await app.waitFor(() =>
        app.screen().some((line) => line.includes(kind === "permission" ? "等待审批" : "Choose?")),
      );
      const lines = app.screen();
      const panel = lines.findIndex((line) => line.includes("✓ 0/2"));
      const dialog = lines.findIndex((line) =>
        line.includes(kind === "permission" ? "等待审批" : "📋 提问"),
      );
      const prompt = lines.findIndex(
        (line, index) =>
          index > dialog && line.includes(rows === 12 ? "first draft" : "last draft"),
      );
      expect(panel).toBeGreaterThanOrEqual(0);
      expect(dialog).toBeGreaterThan(panel);
      expect(prompt).toBeGreaterThan(dialog);
      expect(lines.at(-1)).toContain("esc");
      if (rows === 12) {
        expect(lines[panel]).toBe("  ▸ ✓ 0/2  ● current");
        expect(lines[panel + 1]).not.toContain("next");
        expect(lines.some((line) => line.includes("╭"))).toBe(false);
        if (kind === "permission") expect(lines[dialog + 1]).toBe("    printf approved");
      }
      app.stdin.write("ignored\x1b[200~pasted\x1b[201~\x1b");
      await app.waitFor(() => app.calls.length === 3);
      app.calls[2]!.finish();
      // A small terminal can hide ActivityLine while the Run is still active.
      await app.waitFor(() => app.screen().at(-1)?.trim() === "");
      app.stdin.write("\r");
      await app.waitFor(() => app.calls.length === 4);
      expect(app.calls[3]!.context.messages.at(-1)).toMatchObject({
        role: "user",
        content: [{ type: "text", text: draft }],
      });
    } finally {
      await app.cleanup();
    }
  },
);

test("resume shows an expanded English Todo List with full counts and overflow, without persisting folding", async () => {
  const argv: string[] = [];
  let sessionRoot = "";
  const original = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  original.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("todo_write", {
          todos: [
            { content: "done", status: "completed" },
            ...Array.from({ length: 10 }, (_, index) => ({
              content: `open-${index}`,
              status: "pending",
            })),
          ],
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("saved"),
  ]);
  const app = await start(argv, {
    env: { LANG: "en_US.UTF-8" },
    rows: 30,
    prepare: async (root) => {
      sessionRoot = root;
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: original.getModel(),
        models: auxiliaryModels((model, context, options) =>
          original.provider.streamSimple(model, context, options),
        ),
      });
      await session.run("save plan");
      argv.push("--resume", session.id);
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("  ▾ ✓ 1/11"));
    expect(app.calls).toHaveLength(0);
    const lines = app.screen();
    const header = lines.indexOf("  ▾ ✓ 1/11");
    expect(lines[header + 1]).toBe("  ├─ ○ open-0");
    expect(lines[header + 8]).toBe("  ├─ ○ open-7");
    expect(lines[header + 9]).toBe("  └─ … 2 more");
    expect(lines.join("\n")).not.toMatch(/\p{Script=Han}/u);
    app.stdin.write("\x11");
    await app.waitFor(() => app.screen().includes("  ▸ ✓ 1/11"));
    expect(app.screen()).toContain("  └─ ○ open-0");
    app.stdin.write("\x03\x03");
    await app.exit;
    const resumed = await start(argv, {
      session: { cwd: sessionRoot, homeDir: sessionRoot },
      env: { LANG: "en_US.UTF-8" },
      rows: 30,
    });
    try {
      await resumed.waitFor(() => resumed.screen().includes("  ▾ ✓ 1/11"));
      expect(resumed.calls).toHaveLength(0);
      expect(resumed.screen()).toContain("  ├─ ○ open-0");
      expect(resumed.screen()).toContain("    Ctrl+Q fold");
    } finally {
      await resumed.cleanup();
    }
  } finally {
    await app.cleanup();
  }
});

test("a long Todo List leaves the input and status visible at 40 columns by 12 rows", async () => {
  const app = await start(["plan"], { columns: 40, rows: 12 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("todo_write", {
      todos: Array.from({ length: 10 }, (_, index) => ({
        content: `open-${index}`,
        status: "pending",
      })),
    });
    await app.waitFor(
      () => app.calls.length === 2 && app.screen().some((line) => line.includes("▾ ✓ 0/10")),
    );
    expect(app.screen()).toContain("❯");
    expect(app.screen().at(-1)).toContain("esc");
    expect(app.screen().some((line) => line.includes("ctx"))).toBe(true);
    expect(app.screen()).toContain("    Ctrl+Q 折叠");
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => app.screen().some((line) => line.includes("回到底部")));
    expect(app.screen()).toContain("  ▸ ✓ 0/10  ○ open-0");
    expect(app.screen().some((line) => line.includes("还有 10 项"))).toBe(false);
    expect(app.screen()).toContain("❯");
    expect(app.screen().at(-1)).toContain("esc");
    app.stdin.write("\x11");
    app.resize(40, 24);
    await app.waitFor(() => app.screen().includes("  ▸ ✓ 0/10"));
    expect(app.screen()).toContain("  └─ ○ open-0");
    expect(app.screen()).toContain("❯");
    expect(app.screen().at(-1)).toContain("esc");
  } finally {
    await app.cleanup();
  }
});
