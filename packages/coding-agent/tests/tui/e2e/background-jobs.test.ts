import { committedJobNotifications } from "../helpers/job-notifications";
import { testClock } from "../helpers/test-clock";
import { startWithClock } from "../helpers/clock-app";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { start } from "../helpers/app";
import { auxiliaryModels } from "../helpers/auxiliary-model";
import { dark } from "../../../src/ink/index.ts";

test("background bash renders its card and idle job chip without consuming model output", async () => {
  const notifications = committedJobNotifications();
  const app = await startWithClock(["--permission-mode", "full-access", "launch"], {
    session: notifications.session,
    prepare: notifications.prepare,
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
    await app.waitFor(() => screen().includes("● job: bash-1") && screen().includes("│ third"));
    expect(screen()).toContain("❯ printf");
    expect(screen()).toContain("│ ≡ second");
    expect(screen()).not.toContain("│ ≡ first");
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
    await app.waitFor(
      () => screen().includes("✓ job: bash-1") && !app.screen().at(-2)?.includes("● 1"),
    );
    expect(screen()).toContain("Background job completed: Watch fixture output");
    await app.waitFor(() => notifications.count() === 1);
    app.calls[3]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.calls).toHaveLength(4);
    app.stdin.write("verify settled output\r");
    await app.waitFor(() => app.calls.length === 5);
    expect(JSON.stringify(app.calls[4]!.context.messages)).toContain("background job bash-1");
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
  const notifications = committedJobNotifications();
  const app = await start(["--permission-mode", "full-access", "launch"], {
    session: notifications.session,
    prepare: notifications.prepare,
    columns: 40,
    rows: 32,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools(
      [0, 9, 0].map((code) => ({
        name: "bash",
        args: {
          command: `while [ ! -e go ]; do sleep 0.01; done; exit ${code}`,
          description: `Controlled exit ${code}`,
          run_in_background: true,
        },
      })),
    );
    await app.waitFor(() => app.calls.length === 2 && screen().includes("后台任务 ×3"));
    // Commit all three real completion notifications behind the group before
    // opening it. Their wrapped rows expose bottom-follow hiding the selected
    // header and failed middle card when the group expands.
    expect(
      app.calls[1]!.context.messages.filter(
        (message) => message.role === "toolResult" && message.toolName === "bash",
      ),
    ).toHaveLength(3);
    await Bun.write(join(app.root, "go"), "");
    await app.waitFor(
      () => notifications.count() === 3 && screen().includes("已折叠 3 个后台任务"),
    );
    expect(app.calls).toHaveLength(2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    const header = app.screen().findIndex((row) => row.includes("已折叠 3 个后台任务"));
    const row = app.screen()[header]!;
    expect(row).toContain("1 失败");
    expect(row).toContain("2 已完成");
    const failedColumn = Bun.stringWidth(row.slice(0, row.indexOf("失败")));
    expect(app.terminal.buffer.active.getLine(header)!.getCell(failedColumn)!.getFgColor()).toBe(
      Number.parseInt(dark.error.slice(1), 16),
    );
    app.stdin.write(`\x1b[<0;2;${header + 1}M\x1b[<0;2;${header + 1}m`);
    await app.waitFor(() => /✗ 任务：bash-2 bash \S+ 失败/.test(screen()));
    expect(screen()).toContain("后台任务 ×3");
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => /✓ 任务：bash-1 bash \S+ 已完成/.test(screen()));
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
    await app.waitFor(() => app.calls.length === 2 && screen().includes("│ ≡ armed"));
    app.calls[1]!.tool("job_kill", { job_id: "bash-1" });
    await app.waitFor(
      () => app.calls.length === 3 && /● 任务：bash-1 bash \S+ 停止中/.test(screen()),
    );
    expect(app.screen().at(-2)).toContain("● 1");
    app.calls[2]!.finish();
    // TERM-resistant child escalation uses real process time; the parent clock cannot drive it.
    await app.waitFor(() => /✗ 任务：bash-1 bash \S+ 已停止/.test(screen()), 4000);
    expect(app.screen().at(-2)).not.toContain("● 1");
    expect(screen()).toContain("后台任务已停止");
  } finally {
    await app.cleanup();
  }
}, 10000);

test("resume never attaches a historical bash job result to a new job with the same command", async () => {
  const { createSession } = await import("@rukie/agent");
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } =
    await import("@earendil-works/pi-ai");
  const argv: string[] = [];
  const command = "printf 'ready\\n'; while :; do sleep 0.01; done";
  const app = await start(argv, {
    columns: 120,
    rows: 40,
    prepare: async (root) => {
      const model = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
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
        models: auxiliaryModels(model.provider.streamSimple),
      });
      try {
        await session.run("historical launch");
        argv.push("--resume", session.id, "--permission-mode", "full-access");
      } finally {
        await session.close();
      }
    },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.stdin.isRaw && screen().includes("Historical result"));
    expect(screen()).not.toContain("● 任务：bash-1");
    expect(app.screen().at(-2)).not.toContain("● 1");
    app.stdin.write("new launch\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command,
      description: "Current watcher",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 2 && screen().includes("● 任务：bash-2"));
    expect(app.screen().filter((row) => row.includes("❯ printf"))).toHaveLength(1);
    expect(screen()).not.toContain("● 任务：bash-1");
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
  const app = await startWithClock(["--permission-mode", "full-access", "history"], {
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
    await app.waitFor(() => app.calls.length === 3 && screen().includes("│ ≡ initial"));
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

test("consecutive jobs share transcript expansion and Ctrl+O respects an active question", async () => {
  const notifications = committedJobNotifications();
  const app = await start(["--permission-mode", "full-access", "launch"], {
    session: notifications.session,
    prepare: notifications.prepare,
    columns: 120,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools(
      ["First watcher", "Second watcher", "Third watcher"].map((description) => ({
        name: "bash",
        args: {
          command: "printf 'ready\\n'; while [ ! -e go ]; do sleep 0.01; done",
          description,
          run_in_background: true,
        },
      })),
    );
    await app.waitFor(() => app.calls.length === 2 && screen().includes("Background jobs ×3"));
    expect(screen()).toContain("● job: bash-1");
    expect(screen()).toContain("● job: bash-2");
    expect(app.screen().filter((row) => row.includes("❯ printf"))).toHaveLength(3);
    expect(app.screen().at(-2)).toContain("● 3");
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
    await app.waitFor(() => screen().includes("3 background jobs folded"));
    await app.waitFor(() => notifications.count() === 3);
    app.stdin.write("\x0f");
    await app.flush();
    expect(screen()).toContain("3 background jobs folded");
    expect(screen()).not.toContain("✓ job: bash-1");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 3);
    for (const id of ["bash-1", "bash-2", "bash-3"])
      expect(JSON.stringify(app.calls[2]!.context.messages)).toContain(`background job ${id}`);
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.calls).toHaveLength(3);
    app.stdin.write("keep draft\x0f");
    await app.waitFor(
      () => screen().includes("✓ job: bash-1") && screen().includes("✓ job: bash-2"),
    );
    expect(screen()).toContain("keep draft");
    expect(screen()).not.toContain("background jobs folded");
    app.stdin.write("\x0f");
    await app.waitFor(() => screen().includes("3 background jobs folded"));
    expect(screen()).not.toContain("✓ job: bash-1");
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
    await app.waitFor(
      () => screen().includes("✗ 任务：bash-1") && screen().includes("后台任务已停止"),
    );
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("a failed job notice stays one row at 40×12 and expires without removing other notices", async () => {
  const notifications = committedJobNotifications();
  const app = await startWithClock(["--permission-mode", "full-access", "launch"], {
    session: notifications.session,
    prepare: notifications.prepare,
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
    await app.waitFor(() => notifications.count() === 1);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.calls).toHaveLength(2);
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

test("job command toggles independently and its title opens focused details", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    columns: 100,
    rows: 32,
    env: { LANG: "en_US.UTF-8" },
  });
  const screen = () => app.screen().join("\n");
  const clickRow = (text: string) => {
    const row = app.screen().findIndex((line) => line.includes(text));
    expect(row).toBeGreaterThanOrEqual(0);
    app.stdin.write(`\x1b[<0;4;${row + 1}M\x1b[<0;4;${row + 1}m`);
  };
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command: "printf ready\\n\n# COMMAND-DETAIL\nwhile [ ! -e go ]; do sleep 0.01; done",
      description: "Independent command",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 2 && screen().includes("● job: bash-1"));
    const commandRow = app.screen().find((line) => line.trimStart().startsWith("│ ❯ printf"));
    expect(commandRow).not.toContain("COMMAND-DETAIL");
    clickRow("❯ printf");
    await app.waitFor(() => screen().includes("COMMAND-DETAIL"));
    expect(screen()).not.toContain("Output tail");
    clickRow("COMMAND-DETAIL");
    await app.waitFor(
      () => !app.screen().some((line) => line.trimStart().startsWith("│ # COMMAND-DETAIL")),
    );
    const header = app.screen().findIndex((line) => line.includes("● job: bash-1"));
    app.stdin.write(`\x1b[<0;95;${header + 1}M\x1b[<0;95;${header + 1}m`);
    await app.flush();
    expect(screen()).not.toContain("Output tail");
    clickRow("● job: bash-1");
    await app.waitFor(() => screen().includes("❯ bash-1") && screen().includes("Started"));
    expect(screen()).toContain("Output tail");
    app.stdin.write("\x1b");
    await app.waitFor(() => screen().includes("● job: bash-1"));
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("two settled jobs stay open and group folding leaves a separate job unchanged", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    columns: 100,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    // File gates synchronize real child processes; the parent clock cannot advance shell timers.
    app.calls[0]!.tools(
      [0, 7].map((code) => ({
        name: "bash",
        args: {
          command: `while [ ! -e pair ]; do sleep 0.01; done; exit ${code}`,
          description: `Pair ${code}`,
          run_in_background: true,
        },
      })),
    );
    await app.waitFor(() => app.calls.length === 2 && screen().includes("Background jobs ×2"));
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("separate launch\r");
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.tool("bash", {
      command: "printf separate-ready; while [ ! -e separate ]; do sleep 0.01; done",
      description: "Separate job",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 4 && screen().includes("● job: bash-3"));
    app.calls[3]!.finish();
    await app.waitFor(() => !app.isWorking());
    await Bun.write(join(app.root, "pair"), "");
    await app.waitFor(
      () => screen().includes("✓ job: bash-1") && screen().includes("✗ job: bash-2"),
    );
    expect(screen()).not.toContain("background jobs folded");
    expect(screen()).toContain("╭");
    expect(screen()).toContain("╰");
    const header = app.screen().findIndex((line) => line.includes("Background jobs ×2"));
    app.stdin.write(`\x1b[<0;2;${header + 1}M\x1b[<0;2;${header + 1}m`);
    await app.waitFor(() => screen().includes("2 background jobs folded"));
    expect(screen()).toContain("1 failed");
    expect(screen()).toContain("● job: bash-3");
    expect(screen()).not.toContain("✗ job: bash-2");
    app.stdin.write("\x0f");
    await app.waitFor(() => screen().includes("✗ job: bash-2"));
    expect(screen()).toContain("● job: bash-3");
    app.resize(80, 32);
    await app.waitFor(() => app.screen().every((line) => Bun.stringWidth(line) <= 80));
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("an automatically folded group keeps stopped and failed counts visible", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    columns: 80,
    rows: 32,
    env: { LANG: "en_US.UTF-8" },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools(
      [0, 9, 0].map((code, index) => ({
        name: "bash",
        args: {
          command: `printf armed-${index}; while [ ! -e go ]; do sleep 0.01; done; exit ${code}`,
          description: `Mixed outcome ${index}`,
          run_in_background: true,
        },
      })),
    );
    await app.waitFor(() => app.calls.length === 2 && screen().includes("│ ≡ armed-2"));
    app.calls[1]!.tool("job_kill", { job_id: "bash-3" });
    await app.waitFor(
      () => app.calls.length === 3 && /✗ job: bash-3 bash \S+ stopped/.test(screen()),
    );
    await Bun.write(join(app.root, "go"), "");
    await app.waitFor(() => screen().includes("3 background jobs folded"));
    const header = app.screen().find((line) => line.includes("3 background jobs folded"))!;
    expect(header).toContain("1 failed");
    expect(header).toContain("1 stopped");
    expect(header).toContain("1 completed");
    expect(screen()).not.toContain("✗ job: bash-3");
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("job elapsed time advances on the display clock and freezes after settlement", async () => {
  const app = await startWithClock(["--permission-mode", "full-access", "launch"], {
    columns: 80,
    rows: 28,
    env: { LANG: "en_US.UTF-8" },
  });
  const card = () => app.screen().find((line) => line.includes("bash-1 bash"));
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command: "printf armed; while :; do sleep 0.01; done",
      description: "Display clock",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 2 && card()?.includes("running") === true);
    const before = card();
    testClock.advanceTimersByTime(1000);
    await app.waitFor(() => card() !== before);
    app.calls[1]!.tool("job_kill", { job_id: "bash-1" });
    await app.waitFor(() => app.calls.length === 3 && card()?.includes("stopped") === true);
    const settled = card();
    testClock.advanceTimersByTime(2000);
    await app.flush();
    expect(card()).toBe(settled);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("job card uses the reference header hierarchy and colored section rails", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    columns: 100,
    rows: 32,
    env: { LANG: "en_US.UTF-8" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command: "printf 'first\\nsecond\\nthird\\n'; while :; do sleep 0.01; done",
      description: "Card styling",
      run_in_background: true,
    });
    await app.waitFor(
      () => app.calls.length === 2 && app.screen().some((line) => line.includes("│ third")),
    );
    const row = app.screen().findIndex((line) => line.includes("●") && line.includes("bash-1"));
    const header = app.screen()[row]!;
    const cell = (y: number, x: number) => app.terminal.buffer.active.getLine(y)!.getCell(x)!;
    const idX = Bun.stringWidth(header.slice(0, header.indexOf("bash-1")));
    expect(cell(row, idX).isBold()).toBeTruthy();
    expect(header).toMatch(/● job: bash-1 bash \S+ running/);
    const kindX = header.indexOf(" bash ") + 1;
    expect(cell(row, kindX).isDim()).toBeTruthy();
    expect(cell(row, kindX + "bash ".length).isDim()).toBeTruthy();
    const statusX = header.indexOf("running");
    expect(cell(row, statusX).getFgColor()).toBe(Number.parseInt(dark.warning.slice(1), 16));
    const command = app.screen()[row + 1]!;
    const railX = command.indexOf("│");
    expect(command).toContain("│ ❯ printf");
    expect(cell(row + 1, railX).getFgColor()).toBe(Number.parseInt(dark.accent.slice(1), 16));
    expect(app.screen()[row + 2]).toContain("│ ≡ second");
    expect(app.screen()[row + 3]).toContain("│ third");
    expect(cell(row + 2, railX).getFgColor()).toBe(Number.parseInt(dark.success.slice(1), 16));
    expect(cell(row + 3, railX).getFgColor()).toBe(Number.parseInt(dark.success.slice(1), 16));
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});
