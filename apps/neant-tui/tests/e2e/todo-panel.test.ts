import { expect, test } from "bun:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession } from "@neant/agent";
import { dark } from "@neant/tui";
import { start } from "../helpers/app";

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
  "a %s dialog hides the panel until the interaction closes",
  async (kind) => {
    const app = await start(["plan"]);
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("todo_write", { todos: [{ content: "open", status: "pending" }] });
      await app.waitFor(() => app.calls.length === 2 && app.screen().includes("  ▾ ✓ 0/1"));
      if (kind === "permission") app.calls[1]!.tool("bash", { command: "printf approved" });
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
      expect(app.screen().some((line) => line.includes("▾ ✓"))).toBe(false);
      expect(app.screen()).not.toContain("  └─ ○ open");
      app.stdin.write("\x1b");
      await app.waitFor(() => app.calls.length === 3 && app.screen().includes("  ▾ ✓ 0/1"));
      expect(app.screen()).toContain("  └─ ○ open");
    } finally {
      await app.cleanup();
    }
  },
);

test("resume shows the English Todo List immediately, counts hidden completed rows, and bounds visible overflow", async () => {
  const argv: string[] = [];
  const original = createFauxCore({ api: "faux", provider: "faux" });
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
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: original.getModel(),
        streamFn: (model, context, options) => original.streamSimple(model, context, options),
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
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => app.screen().some((line) => line.includes("回到底部")));
    expect(app.screen()).toContain("  ▾ ✓ 0/10");
    expect(app.screen()).toContain("  └─ … 还有 10 项");
    expect(app.screen()).toContain("❯");
    expect(app.screen().at(-1)).toContain("esc");
  } finally {
    await app.cleanup();
  }
});
