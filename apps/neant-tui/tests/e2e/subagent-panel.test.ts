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
  "the %s child closes the panel while the parent Run is still working",
  async (outcome) => {
    const app = await start(["delegate"], { columns: 80, rows: 30 });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("subagent", { description: "Settled child", prompt: "child settled" });
      await app.waitFor(() => app.calls.length === 3 && app.screen().includes("  ▾ 子代理 1/1"));
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
        await app.waitFor(() => !app.screen().some((line) => line.includes("id ")));
      }
      await app.waitFor(() => !app.screen().some((line) => /[▸▾] 子代理/.test(line)));
      expect(app.calls).toHaveLength(3);
      expect(parent.signal!.aborted).toBe(false);
      app.stdin.write("\x01");
      await app.waitFor(() => app.screen().some((line) => line.includes("─ 子代理 ")));
      app.stdin.write("\r");
      await app.waitFor(() => app.screen().some((line) => line.includes("id ")));
      expect(app.screen().join("\n")).toContain(
        outcome === "completed" ? "Run 正常结束" : outcome === "failed" ? "Run 错误结束" : "已中止",
      );
      app.stdin.write("\x1b");
      await app.waitFor(() => app.screen().some((line) => line.includes("─ 子代理 ")));
      app.stdin.write("\x1b");
      await app.waitFor(() => app.screen().includes("❯"));
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

async function resumeWithChild(checkpoint = false) {
  const argv: string[] = [];
  const original = createFauxCore({ api: "faux", provider: "faux" });
  original.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("subagent", { description: "Restored", prompt: "saved child" }),
        fauxToolCall("todo_write", {
          todos: Array.from({ length: 10 }, (_, index) => ({
            content: `saved todo ${index}`,
            status: "pending",
          })),
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
    fauxAssistantMessage("done"),
    fauxAssistantMessage("done"),
    fauxAssistantMessage("done"),
  ]);
  return start(argv, {
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
      if (checkpoint) await session.run("later parent");
      argv.push("--resume", session.id);
    },
  });
}

test("resume hides the automatic panel but keeps historical children in the English dashboard", async () => {
  const app = await resumeWithChild();
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    expect(app.calls).toHaveLength(0);
    expect(app.screen().some((line) => /[▸▾] Subagents/.test(line))).toBe(false);
    expect(app.screen().filter((line) => line.includes("○ saved todo"))).toHaveLength(8);
    expect(app.screen().join("\n")).toContain("2 more");
    app.stdin.write("\x01");
    await app.waitFor(() => app.screen().some((line) => line.includes("Subagent: Restored")));
    app.stdin.write("\r");
    await app.waitFor(() => app.screen().some((line) => line.includes("id ")));
    expect(app.screen().join("\n")).toContain("Run ended normally");
    expect(app.screen().join("\n")).not.toMatch(/\p{Script=Han}/u);
  } finally {
    await app.cleanup();
  }
});

test("resumed history stays hidden through a parent prompt and list_agents, then send_message opens the live panel", async () => {
  const app = await resumeWithChild();
  const hasPanel = () => app.screen().some((line) => /[▸▾] Subagents/.test(line));
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("continue parent work\r");
    await app.waitFor(() => app.calls.length === 1 && app.isWorking());
    expect(hasPanel()).toBe(false);
    app.calls[0]!.tool("list_agents", {});
    await app.waitFor(() => app.calls.length === 2);
    const result = app.calls[1]!.context.messages.at(-1)!;
    expect(result).toMatchObject({ role: "toolResult", toolName: "list_agents", isError: false });
    const agentId = JSON.stringify(result).match(/([\da-f-]{36}) \[idle\] — Restored/)?.[1];
    expect(agentId).toBeDefined();
    expect(hasPanel()).toBe(false);
    app.calls[1]!.tool("send_message", { agent_id: agentId!, message: "resume saved child" });
    await app.waitFor(() => app.calls.length === 4 && hasPanel());
    expect(app.screen()).toContain("  ▾ Subagents 1/1");
    expect(app.screen()).toContain("  └─ 🟡 [general-purpose] Restored");
    const child = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("resume saved child"),
      ),
    )!;
    const parent = app.calls.find((call, index) => index > 1 && call !== child)!;
    child.finish();
    await app.waitFor(() => !hasPanel());
    expect(app.calls).toHaveLength(4);
    expect(parent.signal!.aborted).toBe(false);
    expect(app.screen().filter((line) => line.includes("○ saved todo"))).toHaveLength(8);
    parent.finish();
    await app.waitFor(() => app.calls.length === 5);
    app.calls[4]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(hasPanel()).toBe(false);
  } finally {
    await app.cleanup();
  }
});

test("conversation rewind retains a historical child without reopening the automatic panel", async () => {
  const app = await resumeWithChild(true);
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("\x1b");
    await app.waitFor(() => app.screen().join("\n").includes("Press Esc again to rewind"));
    app.stdin.write("\x1b");
    await app.waitFor(() => app.screen().join("\n").includes("Pick a message to rewind to"));
    app.stdin.write("\r");
    await app.waitFor(() => app.screen().join("\n").includes("Rewind to this message?"));
    app.stdin.write("\r");
    await app.waitFor(() => app.screen().join("\n").includes("Rewound — edit"));
    expect(app.screen().some((line) => /[▸▾] Subagents/.test(line))).toBe(false);
    expect(app.screen().filter((line) => line.includes("○ saved todo"))).toHaveLength(8);
    app.stdin.write("\x01");
    await app.waitFor(() => app.screen().some((line) => line.includes("Subagent: Restored")));
    app.stdin.write("\r");
    await app.waitFor(() => app.screen().some((line) => line.includes("id ")));
    expect(app.screen().join("\n")).toContain("Run ended normally");
  } finally {
    await app.cleanup();
  }
});

test("the panel keeps settled context while another child runs and stays visible while the parent waits", async () => {
  const app = await start(["delegate"], { columns: 100, rows: 30 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools([
      { name: "subagent", args: { description: "Finished sibling", prompt: "sibling finished" } },
      { name: "subagent", args: { description: "Live sibling", prompt: "sibling live" } },
    ]);
    await app.waitFor(() => app.calls.length === 4 && app.screen().includes("  ▾ 子代理 2/2"));
    const children = app.calls.filter((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("sibling "),
      ),
    );
    const finished = children.find((call) =>
      JSON.stringify(call.context.messages).includes("sibling finished"),
    )!;
    const live = children.find((call) => call !== finished)!;
    const parent = app.calls.find((call, index) => index > 0 && !children.includes(call))!;
    finished.finish();
    await app.waitFor(() => app.screen().includes("  ▾ 子代理 1/2"));
    expect(
      app.screen().some((line) => line.includes("🟢 [general-purpose] Finished sibling")),
    ).toBe(true);
    expect(app.screen().some((line) => line.includes("🟡 [general-purpose] Live sibling"))).toBe(
      true,
    );
    parent.finish();
    await app.waitFor(() => app.calls.length === 5);
    app.calls[4]!.finish();
    await app.waitFor(() => app.screen().some((line) => line.includes("等待 1 个子代理")));
    expect(app.screen()).toContain("  ▾ 子代理 1/2");
    live.finish();
    await app.waitFor(() => app.calls.length === 6);
    await app.waitFor(() => !app.screen().some((line) => /[▸▾] 子代理/.test(line)));
    expect(app.calls[5]!.signal!.aborted).toBe(false);
    app.calls[5]!.finish();
    await app.waitFor(() => !app.isWorking());
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
    const children = app.calls.filter((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" &&
          typeof message.content !== "string" &&
          message.content.some(
            (part) => part.type === "text" && (part.text === "first" || part.text === "second"),
          ),
      ),
    );
    expect(children).toHaveLength(2);
    expect(children.every((call) => !call.signal!.aborted)).toBe(true);
    // Child model requests can precede React's coalesced session_start render.
    // Assert the panel only when its two live Runs are actually visible.
    await app.waitFor(() => app.screen().includes("  ▾ 子代理 2/2"));
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

for (const [lang, label, completed, unknown, error] of [
  ["en_US.UTF-8", "Subagents", "Run ended normally", "Run outcome unknown", "Run ended with error"],
  ["zh_CN.UTF-8", "子代理", "Run 正常结束", "Run 结束原因未知", "Run 错误结束"],
] as const) {
  test(`${lang} restored Run outcomes remain readable in a 40x12 history view without activity`, async () => {
    const argv: string[] = [];
    const app = await start(argv, {
      columns: 40,
      rows: 12,
      env: { LANG: lang },
      prepare: async (root) => {
        const fake = createFauxCore({ api: "faux", provider: "faux" });
        fake.setResponses([
          fauxAssistantMessage(
            fauxToolCall("subagent", {
              description: "Normal",
              prompt: "child",
              run_in_background: false,
            }),
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage("done"),
          fauxAssistantMessage(
            fauxToolCall("subagent", {
              description: "Error",
              prompt: "failed child",
              run_in_background: false,
            }),
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage("partial", { stopReason: "error", errorMessage: "saved failure" }),
          fauxAssistantMessage("parent done"),
        ]);
        const parent = await createSession({
          cwd: root,
          homeDir: root,
          model: fake.getModel(),
          streamFn: (model, context, options) => fake.streamSimple(model, context, options),
        });
        await parent.run("delegate");
        await parent.dispose();
        // Native JSONL fixture: append an old identity to the latest saved parent snapshot.
        for await (const path of new Bun.Glob(`**/*_${parent.id}.jsonl`).scan({
          cwd: `${root}/.neant/sessions`,
          absolute: true,
        })) {
          const records = (await Bun.file(path).text())
            .trimEnd()
            .split("\n")
            .map((line) => JSON.parse(line));
          const snapshots = records
            .flatMap((record) => (Array.isArray(record) ? record : [record]))
            .filter((entry) => entry.customType === "tool-state/subagents");
          snapshots.at(-1).data.value.push({
            id: "legacy-child",
            description: "Legacy",
            type: "general-purpose",
          });
          await Bun.write(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
        }
        argv.push("--resume", parent.id);
      },
    });
    const screen = () => app.screen().join("\n");
    try {
      await app.waitFor(() => screen().includes("❯"));
      expect(app.calls).toHaveLength(0);
      expect(screen()).not.toMatch(/[▸▾] (Subagents|子代理)/);
      app.stdin.write("\x01");
      await app.waitFor(() => screen().includes(`─ ${label} `));
      app.stdin.write("\r");
      await app.waitFor(() => !screen().includes(`─ ${label} `) && screen().includes(completed));
      for (const [description, outcome] of [
        ["Error", error],
        ["Legacy", unknown],
      ]) {
        app.stdin.write("\x1b");
        await app.waitFor(() => screen().includes(`─ ${label} `));
        app.stdin.write("\x1b[B");
        await app.waitFor(() => screen().includes(description!));
        app.stdin.write("\r");
        await app.waitFor(() => !screen().includes(`─ ${label} `) && screen().includes(outcome!));
      }
      app.stdin.write("\x1b");
      await app.waitFor(() => screen().includes(`─ ${label} `));
      app.stdin.write("\x1b");
      await app.waitFor(() => screen().includes("❯") && !screen().includes(`─ ${label} `));
      expect(app.calls).toHaveLength(0);
    } finally {
      await app.cleanup();
    }
  });
}

test("the manual history view distinguishes a Hook-stopped Run while the parent remains active", async () => {
  const app = await start(["delegate"], {
    columns: 80,
    rows: 24,
    env: { LANG: "en_US.UTF-8" },
    session: {
      settings: {
        hooks: {
          SubagentStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: `echo '{"continue":false,"stopReason":"human review required"}'`,
                },
              ],
            },
          ],
        },
      },
    },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("subagent", {
      description: "Hook stopped",
      prompt: "child",
      run_in_background: false,
    });
    await app.waitFor(() => app.calls.length === 2);
    app.stdin.write("\x01");
    await app.waitFor(() => screen().includes("─ Subagents "));
    app.stdin.write("\r");
    await app.waitFor(() => screen().includes("id "));
    expect(screen()).toContain("Run stopped by Hook");
    expect(screen().match(/human review required/g)).toHaveLength(1);
    expect(app.calls).toHaveLength(2);
  } finally {
    await app.cleanup();
  }
});
