import { startWithClock } from "../helpers/clock-app";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { start } from "../helpers/app";
import { withAuxiliaryRequests } from "../helpers/auxiliary-model";
import { dark } from "@neant/tui";

test("background bash renders its card and idle job chip without consuming model output", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    columns: 120,
    rows: 32,
    env: { LANG: "en_US.UTF-8" },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command: "printf 'first\\nsecond\\nthird\\n'; while [ ! -e go ]; do sleep 0.01; done",
      description: "Watch fixture output",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 2);
    await app.waitFor(() => screen().includes("● bash-1") && screen().includes("│ third"));
    expect(screen()).toContain("❯ printf");
    expect(screen()).toContain("│ second");
    expect(screen()).not.toContain("│ first");
    expect(app.screen().at(-2)).toContain("● 1");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    const fields = app.screen().at(-2)!;
    const x = Bun.stringWidth(fields.slice(0, fields.indexOf("● 1"))) + 1;
    app.stdin.write(`\x1b[<35;${x};31M`);
    await app.waitFor(() => app.screen().at(-1)?.includes("Watch fixture output") === true);
    const before = app.screen().at(-1)!;
    await app.waitFor(() => app.screen().at(-1) !== before, 2200);
    app.stdin.write("\x1b[<35;120;1M");
    app.stdin.write("collect\r");
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.tool("job_output", { job_id: "bash-1" });
    await app.waitFor(() => app.calls.length === 4);
    expect(JSON.stringify(app.calls[3]!.context.messages)).toContain("first\\nsecond\\nthird");
    await Bun.write(join(app.root, "go"), "");
    await app.waitFor(() => screen().includes("✓ bash-1") && !app.screen().at(-2)?.includes("● 1"));
    expect(screen()).toContain("Background job completed: Watch fixture output");
    app.calls[3]!.finish();
    await app.waitFor(() => app.calls.length === 5);
    app.calls[4]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
}, 15000);

test("job settlement notice coexists with a question and footer at 40×12", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    columns: 40,
    rows: 12,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools([
      {
        name: "bash",
        args: {
          command: "while [ ! -e go ]; do sleep 0.01; done",
          description: "Question notification fixture",
          run_in_background: true,
        },
      },
      { name: "todo_write", args: { todos: [{ content: "Pick fixture", status: "in_progress" }] } },
    ]);
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.tool("ask_user_question", {
      questions: [
        {
          question: "Choose fixture",
          header: "Fixture",
          multiSelect: false,
          options: [
            { label: "First", description: "First fixture" },
            { label: "Second", description: "Second fixture" },
          ],
        },
      ],
    });
    await app.waitFor(() => screen().includes("❯● First"));
    await Bun.write(join(app.root, "go"), "");
    await app.waitFor(() => screen().includes("后台任务完成"));
    const settled = app.screen();
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.finish();
    await app.waitFor(() => app.calls.length === 4 || !app.isWorking());
    if (app.calls.length === 4) {
      app.calls[3]!.finish();
      await app.waitFor(() => !app.isWorking());
    }
    expect(settled.at(-2)).toContain("完全访问");
    expect(settled.at(-1)?.trim()).toBe("esc 中断");
    expect(settled.join("\n")).toContain("❯● First");
    expect(settled.join("\n")).toContain("✓ 0/1");
    expect(
      app.calls[2]!.context.messages.some(
        (message) =>
          message.role === "toolResult" &&
          JSON.stringify(message.content).includes("Choose fixture"),
      ),
    ).toBe(true);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("a narrow folded group keeps failure visible and opens with its header", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    columns: 40,
    rows: 32,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools(
      [0, 9].map((code) => ({
        name: "bash",
        args: {
          command: `while [ ! -e go ]; do sleep 0.01; done; exit ${code}`,
          description: `Controlled exit ${code}`,
          run_in_background: true,
        },
      })),
    );
    await app.waitFor(() => app.calls.length === 2 && screen().includes("后台任务 ×2"));
    app.calls[1]!.tools(
      ["bash-1", "bash-2"].map((job_id) => ({ name: "job_output", args: { job_id, wait: true } })),
    );
    await app.waitFor(() => screen().includes("job_output"));
    await Bun.write(join(app.root, "go"), "");
    await app.waitFor(() => app.calls.length === 3 && screen().includes("已折叠 2 个后台任务"));
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    const header = app.screen().findIndex((row) => row.includes("已折叠 2 个后台任务"));
    const row = app.screen()[header]!;
    expect(row).toContain("1 失败");
    expect(row).toContain("1 已完成");
    const failedColumn = Bun.stringWidth(row.slice(0, row.indexOf("失败")));
    expect(app.terminal.buffer.active.getLine(header)!.getCell(failedColumn)!.getFgColor()).toBe(
      Number.parseInt(dark.error.slice(1), 16),
    );
    app.stdin.write(`\x1b[<0;2;${header + 1}M\x1b[<0;2;${header + 1}m`);
    await app.waitFor(() => screen().includes("✗ bash-2 · 失败"));
    expect(screen()).toContain("✓ bash-1 · 已完成");
    expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("stopping jobs remain counted until they settle", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    columns: 80,
    rows: 24,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command: "trap '' TERM; printf 'armed\\n'; while :; do sleep 0.01; done",
      description: "Stop resistant fixture",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 2 && screen().includes("│ armed"));
    app.calls[1]!.tool("job_kill", { job_id: "bash-1" });
    await app.waitFor(() => app.calls.length === 3 && screen().includes("● bash-1 · 停止中"));
    expect(app.screen().at(-2)).toContain("● 1");
    app.calls[2]!.finish();
    await app.waitFor(() => screen().includes("✗ bash-1 · 已停止"), 4000);
    expect(app.screen().at(-2)).not.toContain("● 1");
    expect(screen()).toContain("后台任务已停止");
  } finally {
    await app.cleanup();
  }
}, 10000);

test("resume never attaches a historical bash job result to a new job with the same command", async () => {
  const { createSession } = await import("@neant/agent");
  const { createFauxCore, fauxAssistantMessage, fauxToolCall } =
    await import("@earendil-works/pi-ai");
  const argv: string[] = [];
  const command = "printf 'ready\\n'; while :; do sleep 0.01; done";
  const app = await start(argv, {
    columns: 120,
    rows: 40,
    prepare: async (root) => {
      const model = createFauxCore({ api: "faux", provider: "faux" });
      model.setResponses([
        fauxAssistantMessage(
          fauxToolCall("bash", {
            command,
            description: "Historical watcher",
            run_in_background: true,
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("Historical result"),
      ]);
      const session = await createSession({
        cwd: root,
        homeDir: root,
        permissionMode: "full-access",
        model: model.getModel(),
        streamFn: withAuxiliaryRequests(model.streamSimple),
      });
      try {
        await session.run("historical launch");
        argv.push("--resume", session.id, "--permission-mode", "full-access");
      } finally {
        await session.dispose();
      }
    },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.stdin.isRaw && screen().includes("Historical result"));
    expect(screen()).not.toContain("● bash-1");
    expect(app.screen().at(-2)).not.toContain("● 1");
    app.stdin.write("new launch\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command,
      description: "Current watcher",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 2 && screen().includes("● bash-2"));
    expect(app.screen().filter((row) => row.includes("❯ printf"))).toHaveLength(1);
    expect(screen()).not.toContain("● bash-1");
    app.calls[1]!.tool("job_kill", { job_id: "bash-2" });
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("job output and streaming bursts preserve reading position, draft, and unread through resize", async () => {
  const app = await start(["--permission-mode", "full-access", "history"], {
    columns: 100,
    rows: 24,
    env: { LANG: "en_US.UTF-8" },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(Array.from({ length: 80 }, (_, index) => `history-${index}`).join("\n"));
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("launch\r");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.tool("bash", {
      command:
        "printf 'initial\\n'; while [ ! -e step ]; do sleep 0.01; done; printf 'new job output\\n'; while [ ! -e go ]; do sleep 0.01; done",
      description: "Reading position watcher",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 3 && screen().includes("│ initial"));
    app.stdin.write("saved draft\x1b[5~");
    await app.waitFor(() => screen().includes("Back to bottom"));
    const reading = app.screen().slice(0, 5);
    for (let index = 0; index < 350; index++) {
      app.calls[2]!.delta(`chunk-${index}\n`);
      await Promise.resolve();
      await Promise.resolve();
    }
    await app.waitFor(() => screen().includes("New output · Back to bottom"));
    expect(app.screen().slice(0, 5)).toEqual(reading);
    expect(screen()).toContain("saved draft");
    app.stdin.write("\x1b[1;5F");
    await app.waitFor(() => screen().includes("chunk-349") && !screen().includes("Back to bottom"));
    app.stdin.write("\x1b[5~");
    await app.waitFor(
      () => screen().includes("Back to bottom") && !screen().includes("New output"),
    );
    const jobReading = app.screen().slice(0, 5);
    await Bun.write(join(app.root, "step"), "");
    await app.waitFor(() => screen().includes("New output · Back to bottom"));
    expect(app.screen().slice(0, 5)).toEqual(jobReading);
    app.resize(80, 24);
    await app.waitFor(() => app.screen().at(-2)?.includes("● 1") === true);
    expect(app.screen().slice(0, 5)).toEqual(jobReading);
    app.stdin.write("\x1b[1;5F");
    await app.waitFor(() => screen().includes("chunk-349") && !screen().includes("Back to bottom"));
    app.calls[2]!.tool("job_kill", { job_id: "bash-1" });
    await app.waitFor(() => app.calls.length === 4);
    app.calls[3]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("consecutive duplicate commands group, fold after settlement, and Ctrl+O respects a question", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    columns: 120,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools(
      ["First watcher", "Second watcher"].map((description) => ({
        name: "bash",
        args: {
          command: "printf 'ready\\n'; while [ ! -e go ]; do sleep 0.01; done",
          description,
          run_in_background: true,
        },
      })),
    );
    await app.waitFor(() => app.calls.length === 2 && screen().includes("Background jobs ×2"));
    expect(screen()).toContain("● bash-1");
    expect(screen()).toContain("● bash-2");
    expect(app.screen().filter((row) => row.includes("❯ printf"))).toHaveLength(2);
    expect(app.screen().at(-2)).toContain("● 2");
    app.calls[1]!.tool("ask_user_question", {
      questions: [
        {
          question: "Choose fixture",
          header: "Fixture",
          multiSelect: false,
          options: [
            { label: "First", description: "First fixture" },
            { label: "Second", description: "Second fixture" },
          ],
        },
      ],
    });
    await app.waitFor(() => screen().includes("Choose fixture"));
    await Bun.write(join(app.root, "go"), "");
    await app.waitFor(() => screen().includes("2 background jobs folded"));
    app.stdin.write("\x0f");
    await app.flush();
    expect(screen()).toContain("2 background jobs folded");
    expect(screen()).not.toContain("✓ bash-1");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.finish();
    await app.waitFor(() => app.calls.length === 4);
    app.calls[3]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("keep draft\x0f");
    await app.waitFor(() => screen().includes("✓ bash-1") && screen().includes("✓ bash-2"));
    expect(screen()).toContain("keep draft");
    expect(screen()).not.toContain("background jobs folded");
    app.stdin.write("\x0f");
    await app.waitFor(() => screen().includes("2 background jobs folded"));
    expect(screen()).not.toContain("✓ bash-1");
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("a promoted job shows the last visual output rows at 40×12 and after resize", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    columns: 40,
    rows: 12,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command: `printf '${"中🙂".repeat(30)}END-JOB'; while [ ! -e go ]; do sleep 0.01; done`,
      description: "Promoted visual output",
      timeout: 0.05,
    });
    await app.waitFor(() => app.calls.length === 2);
    await app.waitFor(() => screen().includes("│") && screen().includes("END-JOB"));
    expect(app.screen().at(-2)).toContain("● 1");
    expect(app.screen().every((row) => Bun.stringWidth(row) <= 40)).toBe(true);
    app.resize(60, 18);
    await app.waitFor(
      () => screen().includes("END-JOB") && app.screen().at(-2)?.includes("● 1") === true,
    );
    expect(app.screen().every((row) => Bun.stringWidth(row) <= 60)).toBe(true);
    app.calls[1]!.tool("job_kill", { job_id: "bash-1" });
    await app.waitFor(() => app.calls.length === 3);
    await app.waitFor(() => screen().includes("✗ bash-1") && screen().includes("后台任务已停止"));
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("a failed job notice stays one row at 40×12 and expires without removing other notices", async () => {
  const app = await startWithClock(["--permission-mode", "full-access", "launch"], {
    columns: 40,
    rows: 12,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command: "while [ ! -e go ]; do sleep 0.01; done; exit 9",
      description: "This very long background job label must remain safely clipped",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 2);
    app.stdin.write("/btw\r");
    await app.waitFor(() => screen().includes("用法：/btw"));
    await Bun.write(join(app.root, "go"), "");
    await app.waitFor(() => screen().includes("后台任务失败"));
    const noticedAt = performance.now();
    app.calls[1]!.finish();
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    const noticeRow = app.screen().findIndex((row) => row.includes("后台任务失败"));
    expect(app.screen().findIndex((row) => /^╭─+╮$/.test(row))).toBe(noticeRow + 2);
    expect(app.screen()[noticeRow + 1]).toBe("");
    expect(app.screen().at(-4)).toMatch(/^╰─+╯$/);
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => screen().includes("回到底部"));
    const reading = app.screen().slice(0, 2);
    await app.waitFor(() => !screen().includes("后台任务失败"), 7000);
    expect(performance.now() - noticedAt).toBeGreaterThan(5500);
    expect(app.screen().slice(0, 2)).toEqual(reading);
    app.resize(80, 24);
    await app.waitFor(() => screen().includes("用法：/btw"));
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
}, 15000);
