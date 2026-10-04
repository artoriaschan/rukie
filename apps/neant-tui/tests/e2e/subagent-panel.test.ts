import { expect, test } from "bun:test";
import { dark } from "@neant/tui";
import { createSession } from "@neant/agent";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { start } from "../helpers/app";

function click(app: Awaited<ReturnType<typeof start>>, text: string) {
  const row = app.screen().findIndex((line) => line.includes(text));
  expect(row).toBeGreaterThanOrEqual(0);
  // Panel headers/nodes always have two columns of outer padding.
  app.stdin.write(`\x1b[<0;3;${row + 1}M\x1b[<0;3;${row + 1}m`);
}

test.each(["completed", "failed", "aborted"] as const)(
  "the %s child remains visible during the parent Run and disappears when idle",
  async (outcome) => {
    const app = await start(["delegate"], { columns: 80, rows: 30 });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("subagent", { description: "Settled child", prompt: "child settled" });
      await app.waitFor(() => app.calls.length === 3);
      const child = app.calls.find((call) =>
        call.context.messages.some(
          (message) =>
            message.role === "user" && JSON.stringify(message.content).includes("child settled"),
        ),
      )!;
      const parent = app.calls.find((call, index) => index > 0 && call !== child)!;
      if (outcome === "completed") child.finish();
      else if (outcome === "failed") child.fail("failed child");
      else {
        click(app, "[general-purpose] Settled child");
        await app.waitFor(() => app.screen().some((line) => line.includes("id ")));
        app.stdin.write("x");
        await app.waitFor(() => child.signal!.aborted);
        app.stdin.write("\x1b");
      }
      await app.waitFor(() => app.screen().includes("  ▾ 子代理 0/1"));
      expect(app.screen().some((line) => line.includes("[general-purpose] Settled child"))).toBe(
        true,
      );
      click(app, "▾ 子代理 0/1");
      await app.waitFor(() => app.screen().includes("  ▸ 子代理 0/1"));
      // Folding only previews running children.
      expect(app.screen().some((line) => line.includes("[general-purpose] Settled child"))).toBe(
        false,
      );
      parent.finish();
      await app.waitFor(() => app.calls.length === 4);
      app.calls[3]!.finish();
      await app.waitFor(() => app.screen().at(-1)?.trim() === "");
      expect(app.screen().some((line) => /[▸▾] 子代理/.test(line))).toBe(false);
    } finally {
      await app.cleanup();
    }
  },
);

test("resume keeps restored idle children visible with English copy and opens their detail", async () => {
  const argv: string[] = [];
  const original = createFauxCore({ api: "faux", provider: "faux" });
  original.setResponses([
    fauxAssistantMessage(
      [fauxToolCall("subagent", { description: "Restored", prompt: "saved child" })],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
    fauxAssistantMessage("done"),
    fauxAssistantMessage("done"),
  ]);
  const app = await start(argv, {
    columns: 80,
    rows: 24,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: original.getModel(),
        streamFn: (model, context, options) => original.streamSimple(model, context, options),
      });
      await session.run("save child");
      argv.push("--resume", session.id);
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("  ▾ Subagents 0/1"));
    expect(app.calls).toHaveLength(0);
    expect(app.screen()).toContain("  └─ · [general-purpose] Restored");
    click(app, "[general-purpose] Restored");
    await app.waitFor(() => app.screen().some((line) => line.includes("id ")));
    expect(app.screen().join("\n")).toContain("idle");
    expect(app.screen().join("\n")).not.toMatch(/\p{Script=Han}/u);
  } finally {
    await app.cleanup();
  }
});

test("two long panels share remaining rows equally and the child panel expands when Todo clears", async () => {
  const app = await start(["delegate"], { columns: 80, rows: 24 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("todo_write", {
      todos: Array.from({ length: 10 }, (_, index) => ({
        content: `parent-${index}`,
        status: "pending",
      })),
    });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.tools(
      Array.from({ length: 8 }, (_, index) => ({
        name: "subagent",
        args: { description: `Child ${index}`, prompt: `child fair ${index}` },
      })),
    );
    await app.waitFor(() => app.calls.length === 11 && app.screen().includes("  ▾ 子代理 8/8"));
    const lines = app.screen();
    const todo = lines.indexOf("  ▾ ✓ 0/10");
    const subagent = lines.indexOf("  ▾ 子代理 8/8");
    expect(lines.slice(todo, subagent).filter(Boolean)).toHaveLength(5);
    expect(lines.slice(subagent, subagent + 5)).toEqual([
      "  ▾ 子代理 8/8",
      expect.stringMatching(/^  ├─ 🟡 \[general-purpose\] Child \d$/),
      expect.stringMatching(/^  ├─ 🟡 \[general-purpose\] Child \d$/),
      expect.stringMatching(/^  ├─ 🟡 \[general-purpose\] Child \d$/),
      "  └─ … 还有 5 项",
    ]);
    expect(lines.at(-1)).toContain("esc");
    const parent = app.calls.find(
      (call, index) =>
        index > 1 &&
        !call.context.messages.some(
          (message) =>
            message.role === "user" && JSON.stringify(message.content).includes("child fair"),
        ),
    )!;
    parent.tool("todo_write", { todos: [] });
    await app.waitFor(
      () =>
        app.calls.length === 12 &&
        app.screen().filter((line) => line.includes("[general-purpose] Child")).length === 8,
    );
    expect(app.screen().some((line) => line.includes("▾ ✓"))).toBe(false);
    expect(app.screen().some((line) => line.includes("还有 5 项"))).toBe(false);
    expect(app.screen()).toContain("❯");
  } finally {
    await app.cleanup();
  }
});

test("Subagent panel follows Todo, has independent mouse folding and opens child detail", async () => {
  const app = await start(["delegate"], { columns: 80, rows: 40 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("todo_write", {
      todos: [{ content: "parent work", status: "in_progress" }],
    });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.tools([
      { name: "subagent", args: { description: "First child", prompt: "first" } },
      { name: "subagent", args: { description: "Second child", prompt: "second" } },
    ]);
    await app.waitFor(() => app.calls.length === 5);
    expect(app.screen()).toContain("  ▾ 子代理 2/2");
    const header = app.screen().indexOf("  ▾ 子代理 2/2");
    expect(header).toBeGreaterThan(app.screen().indexOf("  └─ ● parent work"));
    const first = app.screen()[header + 1]!.includes("First child")
      ? "First child"
      : "Second child";
    const second = first === "First child" ? "Second child" : "First child";
    expect(app.screen()[header + 1]).toBe(`  ├─ 🟡 [general-purpose] ${first}`);
    expect(app.screen()[header + 2]).toBe(`  └─ 🟡 [general-purpose] ${second}`);
    const cell = () => app.terminal.buffer.active.getLine(header)!.getCell(2)!;
    app.stdin.write(`\x1b[<35;3;${header + 1}M`);
    await app.waitFor(
      () => cell().getBgColor() === Number.parseInt(dark.badgeHoverBackground.slice(1), 16),
    );
    click(app, "▾ 子代理 2/2");
    await app.waitFor(() => app.screen().includes("  ▸ 子代理 2/2"));
    expect(app.screen()).toContain(`  └─ 🟡 [general-purpose] ${first}`);
    expect(app.screen()).not.toContain(`  └─ 🟡 [general-purpose] ${second}`);
    expect(app.screen()).toContain("  ▾ ✓ 0/1");
    app.stdin.write("\x11");
    await app.waitFor(() => app.screen().includes("  ▸ ✓ 0/1"));
    expect(app.screen()).toContain("  ▸ 子代理 2/2");
    click(app, "▸ 子代理 2/2");
    await app.waitFor(() => app.screen().includes("  ▾ 子代理 2/2"));
    expect(app.screen()).toContain("  ▸ ✓ 0/1");
    click(app, "[general-purpose] Second child");
    await app.waitFor(() => app.screen().some((line) => line.includes("id ")));
    expect(app.screen().join("\n")).toContain("子代理：Second child");
    app.stdin.write("\x1b");
    await app.waitFor(() => app.screen().includes("  ▾ 子代理 2/2"));
    expect(app.screen()).toContain("  ▸ ✓ 0/1");
    app.resize(80, 12);
    await app.waitFor(() => app.screen().some((line) => line.includes("▸ 子代理 2/2  🟡")));
    const previewRow = app.screen().findIndex((line) => line.includes("▸ 子代理 2/2"));
    const previewLine = app.screen()[previewRow]!;
    const previewColumn =
      Bun.stringWidth(previewLine.slice(0, previewLine.indexOf("[general-purpose]"))) + 1;
    app.stdin.write(
      `\x1b[<0;${previewColumn};${previewRow + 1}M\x1b[<0;${previewColumn};${previewRow + 1}m`,
    );
    await app.waitFor(() => app.screen().some((line) => line.includes("id ")));
    expect(app.screen().join("\n")).toContain(`子代理：${first}`);
    app.stdin.write("\x1b");
    app.resize(80, 40);
    await app.waitFor(() => app.screen().includes("  ▾ 子代理 2/2"));
    expect(app.screen()).toContain("  ▸ ✓ 0/1");
  } finally {
    await app.cleanup();
  }
});

for (const kind of ["permission", "question"] as const) {
  for (const [columns, rows] of [
    [40, 12],
    [60, 12],
    [80, 12],
    [60, 24],
  ] as const) {
    test(`${kind} at ${columns} columns by ${rows} rows preserves both previews, usable dialog, draft and status`, async () => {
      const app = await start(["delegate"], { columns, rows });
      const draft = "草稿一\n草稿二\n草稿三";
      try {
        await app.waitFor(() => app.calls.length === 1);
        app.calls[0]!.tool("todo_write", {
          todos: [{ content: "父任务", status: "in_progress" }],
        });
        await app.waitFor(() => app.calls.length === 2);
        app.calls[1]!.tool("subagent", {
          description: "子任务",
          prompt: "child task",
          subagent_type: "explore",
        });
        await app.waitFor(() => app.calls.length === 4);
        const child = app.calls.find((call) =>
          call.context.messages.some(
            (message) =>
              message.role === "user" && JSON.stringify(message.content).includes("child task"),
          ),
        )!;
        const parent = app.calls.find((call, index) => index > 1 && call !== child)!;
        app.stdin.write(`\x1b[200~${draft}\x1b[201~`);
        await app.waitFor(() => app.screen().some((line) => line.includes("草稿三")));
        if (kind === "permission") parent.tool("bash", { command: "printf approved" });
        else
          parent.tool("ask_user_question", {
            questions: [
              {
                question: "选哪项？",
                header: "选项",
                multiSelect: false,
                options: [
                  { label: "第一项", description: "说明一" },
                  { label: "第二项", description: "说明二" },
                ],
              },
            ],
          });
        await app.waitFor(() =>
          app
            .screen()
            .some((line) => line.includes(kind === "permission" ? "等待审批" : "选哪项？")),
        );
        const lines = app.screen();
        const todoLabel = rows === 12 ? "  ▸ ✓ 0/1  ● 父任务" : "  ▾ ✓ 0/1";
        expect(lines).toContain(todoLabel);
        const subagent = lines.findIndex((line) =>
          line.includes(rows === 12 ? "▸ 子代理 1/1" : "▾ 子代理 1/1"),
        );
        expect(subagent).toBeGreaterThan(lines.indexOf(todoLabel));
        expect(lines[rows === 12 ? subagent : subagent + 1]).toContain("[explore] 子任务");
        const dialog = lines.findIndex((line) =>
          line.includes(kind === "permission" ? "等待审批" : "📋 提问"),
        );
        expect(dialog).toBeGreaterThan(subagent);
        expect(
          lines.findIndex((line, index) => index > dialog && line.includes("草稿一")),
        ).toBeGreaterThan(dialog);
        expect(lines.at(-1)).toContain("esc");
        expect(lines.some((line) => line.includes("ctx"))).toBe(true);
        if (kind === "permission") {
          expect(lines).toContain("    printf approved");
          expect(lines.some((line) => line.includes("1. 允许（仅本次）"))).toBe(true);
          expect(lines.some((line) => line.includes("2. 本 session 允许此命令"))).toBe(true);
          expect(lines.some((line) => line.includes("3. 拒绝"))).toBe(true);
          app.stdin.write("\x1b");
        } else {
          expect(lines.some((line) => line.includes("第一项"))).toBe(true);
          app.stdin.write("\x1b[B");
          await app.waitFor(() =>
            app.screen().some((line) => line.includes("❯") && line.includes("第二项")),
          );
          app.stdin.write("\r");
        }
        await app.waitFor(() => app.calls.length === 5);
        child.finish();
        app.calls[4]!.finish();
        await app.waitFor(() => app.calls.length === 6);
        app.calls[5]!.finish();
        await app.waitFor(() => app.screen().at(-1)?.trim() === "");
        app.stdin.write("\r");
        await app.waitFor(() => app.calls.length === 7);
        expect(app.calls[6]!.context.messages.at(-1)).toMatchObject({
          role: "user",
          content: [{ type: "text", text: draft }],
        });
      } finally {
        await app.cleanup();
      }
    });
  }
}
