import { committedJobNotifications } from "../helpers/job-notifications";
import { startWithClock } from "../helpers/clock-app";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { start } from "../helpers/app";

test("MCP panels retain input ownership beside background cards, jobs and completion notices", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    env: { LANG: "en_US.UTF-8" },
    columns: 100,
    rows: 32,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command:
        "printf 'worker %s\\n' ready; while [ ! -e go ]; do sleep 0.01; done; printf 'worker %s\\n' finished",
      description: "Watch alongside MCP panel",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 2 && screen().includes("worker ready"));
    app.stdin.write("/mcp\r");
    await app.waitFor(
      () => screen().includes("No MCP servers configured") && screen().includes("● job: bash-1"),
    );
    expect(screen()).toContain("Manage MCP servers (0)");
    expect(screen()).toContain("● 1");
    expect(app.calls).toHaveLength(2);
    const row = app.screen().findIndex((line) => line.includes("● job: bash-1"));
    expect(row).toBeGreaterThanOrEqual(0);
    app.stdin.write(`\x1b[<0;4;${row + 1}M\x1b[<0;4;${row + 1}m/jobs\r`);
    await app.flush();
    expect(screen()).toContain("Manage MCP servers (0)");
    expect(screen()).not.toContain("Background jobs");
    expect(app.calls).toHaveLength(2);
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen().includes("Manage MCP servers"));
    app.stdin.write("/jobs\r");
    await app.waitFor(() => screen().includes("❯ bash-1"));
    app.stdin.write("e");
    await app.waitFor(() => screen().includes("Output tail") && screen().includes("worker ready"));
    app.stdin.write("\x1b");
    await app.waitFor(
      () => !screen().includes("Background jobs") && screen().includes("worker ready"),
    );
    expect(app.calls[1]!.signal!.aborted).toBe(false);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen().includes("Manage MCP servers (0)"));
    await Bun.write(join(app.root, "go"), "");
    await app.waitFor(
      () => app.calls.length === 3 && screen().includes("Background job completed"),
    );
    expect(screen()).toContain("Manage MCP servers (0)");
    expect(screen()).toContain("worker finished");
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.resize(40, 12);
    await app.waitFor(() => screen().includes("Background job completed"));
    expect(screen()).toContain("Manage MCP servers (0)");
    expect(app.screen()).toHaveLength(12);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

for (const [lang, exitCode] of [
  ["zh_CN.UTF-8", "退出码：7"],
  ["en_US.UTF-8", "exit code: 7"],
] as const) {
  test(`settled job details localize the exit code for ${lang}`, async () => {
    const notifications = committedJobNotifications();
    const app = await start(["--permission-mode", "full-access", "launch"], {
      session: notifications.session,
      prepare: notifications.prepare,
      env: { LANG: lang },
      columns: 100,
      rows: 28,
    });
    const screen = () => app.screen().join("\n");
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("bash", {
        command: "while [ ! -e go ]; do sleep 0.01; done; exit 7",
        description: "Exit status fixture",
        run_in_background: true,
      });
      await app.waitFor(() => app.calls.length === 2);
      app.stdin.write("/jobs\r");
      await app.waitFor(() => screen().includes("❯ bash-1"));
      app.stdin.write("e");
      await Bun.write(join(app.root, "go"), "");
      await app.waitFor(() => screen().includes(exitCode));
      expect(screen()).toContain(exitCode);
      await app.waitFor(() => notifications.count() === 1);
      app.calls[1]!.finish();
      await app.waitFor(() => !app.isWorking());
      expect(app.calls).toHaveLength(2);
      app.stdin.write("\x1b");
      await app.waitFor(() => !screen().includes("Output tail") && !screen().includes("输出尾部"));
      app.stdin.write("verify settled result\r");
      await app.waitFor(() => app.calls.length === 3);
      expect(JSON.stringify(app.calls[2]!.context.messages)).toContain(
        "status: failed, exit code: 7",
      );
      app.calls[2]!.finish();
      await app.waitFor(() => !app.isWorking());
      expect(app.stderr()).toBe("");
    } finally {
      await app.cleanup();
    }
  });
}

test("/jobs opens an empty fullscreen panel during a Run and returns without interrupting", async () => {
  const app = await start(["working"], { env: { LANG: "en_US.UTF-8" }, columns: 40, rows: 12 });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/jobs\r");
    await app.waitFor(
      () => screen().includes("Background jobs") && screen().includes("No background jobs"),
    );
    expect(screen()).not.toContain("working");
    expect(app.calls).toHaveLength(1);
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    expect(app.screen().at(-1)).toContain("Esc");
    app.resize(80, 24);
    await app.waitFor(() => screen().includes("No background jobs"));
    app.stdin.write("\x1b");
    await app.waitFor(() => screen().includes("working"));
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("panel navigation disarms stop, confirmation expires, and idle stop waits for the next human prompt", async () => {
  const app = await startWithClock(["--permission-mode", "full-access", "launch"], {
    env: { LANG: "en_US.UTF-8" },
    columns: 100,
    rows: 28,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools(
      ["First watcher", "Second watcher"].map((description) => ({
        name: "bash",
        args: {
          command: "trap '' TERM; printf 'ready\\n'; while :; do sleep 0.01; done",
          description,
          run_in_background: true,
        },
      })),
    );
    await app.waitFor(() => app.calls.length === 2 && screen().includes("● job: bash-2"));
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/jobs\r");
    await app.waitFor(() => screen().includes("❯ bash-1"));
    app.stdin.write("k");
    await app.waitFor(() => screen().includes("k again within 4s: stop bash-1"));
    app.stdin.write("\x1b[Bk");
    await app.waitFor(() => screen().includes("k again within 4s: stop bash-2"));
    expect(screen()).not.toContain("stopping");
    const armedAt = performance.now();
    await app.waitFor(() => !screen().includes("k again within"), 5000);
    expect(performance.now() - armedAt).toBeGreaterThan(3900);
    app.stdin.write("k");
    await app.waitFor(() => screen().includes("k again within 4s: stop bash-2"));
    expect(screen()).not.toContain("stopping");
    app.stdin.write("k");
    await app.waitFor(() => screen().includes("bash-2 · stopping"));
    await app.waitFor(() => screen().includes("bash-2 · stopped"), 4000);
    app.stdin.write("kk");
    await app.flush();
    expect(screen()).not.toContain("k again within");
    expect(app.calls).toHaveLength(2);
    app.stdin.write("\x1b");
    await app.waitFor(() => screen().includes("✗ job: bash-2"));
    app.stdin.write("collect\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(JSON.stringify(app.calls[2]!.context.messages)).toContain("User stopped background job");
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
}, 15000);

test("card clicks focus exact jobs and expanded promoted details show bounded output, times, spill and dropped data", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    env: { LANG: "en_US.UTF-8" },
    columns: 100,
    rows: 28,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools([
      {
        name: "bash",
        args: {
          command: "printf 'first\\n'; while [ ! -e go ]; do sleep 0.01; done",
          description: "First watcher",
          run_in_background: true,
        },
      },
      {
        name: "bash",
        args: {
          command:
            "printf 'EARLY\\n'; head -c 400000 /dev/zero | tr '\\0' x; printf '\\nLAST-TAIL\\n'; while [ ! -e go ]; do sleep 0.01; done",
          description: "Promoted watcher",
          timeout: 0.05,
        },
      },
    ]);
    await app.waitFor(() => app.calls.length === 2 && screen().includes("LAST-TAIL"));
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("saved draft");
    await app.waitFor(() => screen().includes("saved draft"));
    const row = app.screen().findIndex((line) => line.includes("● job: bash-2"));
    app.stdin.write(`\x1b[<0;4;${row + 1}M\x1b[<0;4;${row + 1}m`);
    await app.waitFor(() => screen().includes("❯ bash-2"));
    await app.waitFor(
      () =>
        screen().includes("Started") &&
        screen().includes("Promoted") &&
        screen().includes("Output file:") &&
        screen().includes("LAST-TAIL"),
    );
    expect(screen()).toContain("Earlier output dropped");
    expect(screen()).not.toContain("│ EARLY");
    expect(screen()).toMatch(/Started.*\d\d:\d\d:\d\d/u);
    expect(screen()).toMatch(/Promoted.*\d\d:\d\d:\d\d/u);
    await Bun.write(join(app.root, "go"), "");
    await app.waitFor(
      () => screen().includes("Settled") && screen().includes("bash-2 · completed"),
    );
    if (app.calls.length === 3) {
      app.calls[2]!.finish();
      await app.waitFor(() => !app.isWorking());
    }
    app.stdin.write("\x1b");
    await app.waitFor(() => screen().includes("saved draft"));
    app.stdin.write("\x0f");
    await app.waitFor(() => screen().includes("Transcript ·"));
    // Saved Run summaries can place the first card above the bottom viewport.
    // Reveal its painted header before capturing physical pointer coordinates.
    for (let notches = 0; notches < 12 && !screen().includes("✓ job: bash-1"); notches++) {
      const before = app.screen().slice(0, 3).join("\n");
      app.stdin.write("\x1b[<64;10;2M");
      await app.waitFor(
        () => screen().includes("✓ job: bash-1") || app.screen().slice(0, 3).join("\n") !== before,
      );
    }
    await app.waitFor(() => screen().includes("✓ job: bash-1"));
    const first = app.screen().findIndex((line) => line.includes("✓ job: bash-1"));
    app.stdin.write(`\x1b[<0;4;${first + 1}M\x1b[<0;4;${first + 1}m`);
    await app.waitFor(() => screen().includes("❯ bash-1"));
    await app.waitFor(() => screen().includes("Started") && screen().includes("first"));
    expect(screen()).not.toContain("Promoted ·");
    app.stdin.write("\x1b");
    await app.waitFor(() => screen().includes("saved draft"));
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
}, 15000);

test("reading position and follow state survive settlement and group folding above the viewport while jobs is open", async () => {
  // Frontend reveal is virtual; file barriers and output still observe real child completion.
  const notifications = committedJobNotifications();
  const app = await startWithClock(["--permission-mode", "full-access", "launch"], {
    session: notifications.session,
    prepare: notifications.prepare,
    env: { LANG: "en_US.UTF-8" },
    columns: 100,
    rows: 24,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools(
      ["One", "Two"].map((description) => ({
        name: "bash",
        args: {
          command:
            "while [ ! -e step ]; do sleep 0.01; done; printf 'NEW-OUTPUT\\n'; while [ ! -e go ]; do sleep 0.01; done",
          description,
          run_in_background: true,
        },
      })),
    );
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta(Array.from({ length: 80 }, (_, index) => `reading-${index}`).join("\n"));
    await app.waitFor(() => screen().includes("reading-79"));
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => screen().includes("Back to bottom"));
    const before = app.screen().slice(0, 5);
    app.stdin.write("/jobs\r");
    await app.waitFor(() => screen().includes("❯ bash-1"));
    await Bun.write(join(app.root, "step"), "");
    app.stdin.write("e");
    await app.waitFor(() => screen().includes("NEW-OUTPUT"));
    await Bun.write(join(app.root, "go"), "");
    await app.waitFor(
      () => screen().includes("bash-1 · completed") && screen().includes("bash-2 · completed"),
    );
    await app.waitFor(() => notifications.count() === 2);
    app.calls[1]!.delta("\ncontinued-stream");
    app.calls[1]!.finish();
    // The Jobs panel can hide the activity spinner; native task commits witness settlement.
    await app.waitFor(() => notifications.pendingTasks() === 0);
    expect(app.calls).toHaveLength(2);
    app.stdin.write("\x1b");
    await app.waitFor(() => screen().includes("Back to bottom"));
    expect(app.screen().slice(0, 5)).toEqual(before);
    const restored = app.screen().slice(0, 5);
    expect(screen()).toContain("New output");
    app.stdin.write("\x1b[1;5F");
    await app.waitFor(
      () => screen().includes("continued-stream") && !screen().includes("Back to bottom"),
    );
    // The visible idle footer also witnesses release of the Frontend's submit admission.
    await app.waitFor(() => !app.isWorking() && !screen().includes("esc interrupt"));
    app.stdin.write("continue follow\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(JSON.stringify(app.calls[2]!.context.messages)).toContain("background job bash-1");
    expect(JSON.stringify(app.calls[2]!.context.messages)).toContain("background job bash-2");
    app.stdin.write("/jobs\r");
    await app.waitFor(() => screen().includes("❯ bash-1"));
    app.calls[2]!.delta("\nfollowed-stream");
    app.stdin.write("\x1b");
    await app.waitFor(() => screen().includes("followed-stream"));
    expect(screen()).not.toContain("Back to bottom");
    app.calls[2]!.finish();
    for (let index = 3; index < 6; index++) {
      await app.waitFor(() => app.calls.length > index || !app.isWorking());
      if (!app.isWorking()) break;
      app.calls[index]!.finish();
    }
    await app.waitFor(() => !app.isWorking());
    expect(restored).toEqual(before);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
}, 15000);

test("a streaming message keeps its reading anchor when it completes while the panel is open and resizes", async () => {
  const app = await startWithClock(["working"], {
    env: { LANG: "en_US.UTF-8" },
    columns: 100,
    rows: 24,
    controlTitles: true,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(Array.from({ length: 80 }, (_, index) => `stream-${index}`).join("\n"));
    await app.waitFor(() => screen().includes("stream-79"));
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => screen().includes("Back to bottom"));
    const before = app.screen().slice(0, 5);
    app.stdin.write("/jobs\r");
    await app.waitFor(() => screen().includes("No background jobs"));
    app.calls[0]!.finish();
    await app.waitFor(() => app.titles.length === 1);
    app.titles[0]!.delta("Fixture title");
    app.titles[0]!.finish();
    app.resize(80, 24);
    await app.waitFor(() => app.screen()[0]?.includes("Background jobs") === true);
    app.stdin.write("\x1b");
    await app.waitFor(
      () =>
        screen().includes("Back to bottom") &&
        !app.isWorking() &&
        JSON.stringify(app.screen().slice(0, 5)) === JSON.stringify(before),
    );
    expect(app.screen().slice(0, 5)).toEqual(before);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("Chinese command completion and single job details fit 40×12 through resize and preserve a pending question", async () => {
  // The background fixture has its own process clock and must emit actual job output.
  const app = await start(["--permission-mode", "full-access", "launch"], {
    columns: 40,
    rows: 12,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/jo");
    await app.waitFor(() => screen().includes("jobs") && screen().includes("查看和停止后台任务"));
    app.stdin.write("\r");
    await app.waitFor(() => screen().includes("暂无后台任务"));
    app.stdin.write("\x1b");
    await app.waitFor(() => screen().includes("launch"));
    app.calls[0]!.tool("bash", {
      command: `printf '\\033[31m${"中🙂".repeat(30)}SAFE-TAIL\\033[0m\\n'; while :; do sleep 0.01; done`,
      description: "中文输出任务",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 2);
    app.resize(40, 24);
    await app.waitFor(() => screen().includes("● 任务：bash-1"));
    const card = app.screen().findIndex((line) => line.includes("● 任务：bash-1"));
    app.stdin.write(`\x1b[<0;4;${card + 1}M\x1b[<0;4;${card + 1}m`);
    await app.waitFor(() => screen().includes("❯ bash-1"));
    app.resize(40, 12);
    await app.waitFor(() => app.screen().at(-1)?.includes("Esc") === true);
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
    expect(screen()).not.toContain("启动");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 3 && screen().includes("启动"));
    app.stdin.write("\x1b[6~");
    await app.waitFor(() => screen().includes("SAFE-TAIL"));
    expect(app.screen().find((line) => line.trimStart().startsWith("│ "))).not.toContain("[31m");
    expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
    expect(app.screen().at(-1)).toContain("Esc");
    app.resize(80, 24);
    await app.waitFor(() => screen().includes("SAFE-TAIL") && screen().includes("启动"));
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen().includes("启动"));
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
}, 15000);

test("a promoted job retains its timeline after conversation Rewind removes its bash card", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    env: { LANG: "en_US.UTF-8" },
    columns: 100,
    rows: 28,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command: "printf 'ready\\n'; while :; do sleep 0.01; done",
      description: "Promotion survives rewind",
      timeout: 0.05,
    });
    await app.waitFor(() => app.calls.length === 2 && screen().includes("● job: bash-1"));
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/jobs\r");
    await app.waitFor(() => screen().includes("❯ bash-1"));
    app.stdin.write("e");
    await app.waitFor(() => screen().includes("Promoted ·"));
    const promotion = app.screen().find((line) => line.includes("Promoted ·"));
    app.stdin.write("\x1b");
    await app.waitFor(() => screen().includes("● job: bash-1"));
    app.stdin.write("/rewind\r");
    await app.waitFor(() => screen().includes("Pick a message to rewind to"));
    app.stdin.write("\r");
    await app.waitFor(() => screen().includes("Rewind to this message?"));
    app.stdin.write("\r");
    await app.waitFor(() => screen().includes("Rewound"));
    app.stdin.write("\x03/jobs\r");
    await app.waitFor(() => screen().includes("❯ bash-1"));
    app.stdin.write("e");
    await app.waitFor(() => screen().includes("Promoted ·"));
    expect(app.screen().find((line) => line.includes("Promoted ·"))).toBe(promotion);
    app.stdin.write("\x1b");
    await app.waitFor(() => screen().includes("Rewound"));
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("a narrow jobs list starts at the focused first job and follows keyboard selection across its viewport", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    env: { LANG: "en_US.UTF-8" },
    columns: 40,
    rows: 12,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools(
      Array.from({ length: 10 }, (_, index) => ({
        name: "bash",
        args: {
          command: "while :; do sleep 0.01; done",
          description: `Watcher ${index + 1}`,
          run_in_background: true,
        },
      })),
    );
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/jobs\r");
    await app.waitFor(() => screen().includes("❯ bash-1 ·"));
    app.stdin.write("\x1b[B".repeat(9));
    await app.waitFor(() => screen().includes("❯ bash-10 ·"));
    app.stdin.write("\x1b[A".repeat(9));
    await app.waitFor(() => screen().includes("❯ bash-1 ·"));
    expect(app.screen().at(-1)).toContain("Esc");
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen().includes("↑/↓ select"));
    app.resize(40, 24);
    await app.waitFor(() => /● job: bash-10 bash \S+ running/.test(screen()));
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("stopped job details disclose the real terminating signal", async () => {
  const app = await start(["--permission-mode", "full-access", "launch"], {
    columns: 100,
    rows: 28,
    env: { LANG: "en_US.UTF-8" },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command: "printf armed; while :; do sleep 0.01; done",
      description: "Signal fixture",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 2 && screen().includes("│ ≡ armed"));
    app.stdin.write("/jobs\re");
    await app.waitFor(() => screen().includes("Output tail"));
    app.stdin.write("kk");
    await app.waitFor(() => screen().includes("bash-1 · stopped"));
    expect(screen()).toContain("signal: SIGTERM");
    expect(screen()).toContain("1 stopped");
    app.stdin.write("\x1b");
    app.calls[1]!.finish();
    await app.waitFor(() => app.calls.length === 3 || !app.isWorking());
    if (app.calls.length === 3) app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});
