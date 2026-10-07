import { startWithClock } from "./helpers/clock-app";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "@neant/agent";
import { main } from "../../src/tui/main";
import { controlledModel } from "./helpers/model";
import { createTerminal } from "./helpers/terminal";
import { start } from "./helpers/app";

const assistant = process.platform === "darwin" ? "⏺" : "●";

test.each(["zh", "en"] as const)(
  "settings hook filter warnings use the selected startup locale %s",
  async (locale) => {
    const session = { cwd: "", homeDir: "" };
    const app = await start([], {
      session,
      env: { LANG: locale === "zh" ? "en" : "zh_CN.UTF-8" },
      prepare: async (root) => {
        session.cwd = join(root, "project");
        session.homeDir = join(root, "home");
        await Bun.write(join(session.cwd, ".keep"), "");
        await Bun.write(
          join(session.homeDir, ".neant/settings.json"),
          JSON.stringify({
            locale,
            hooks: {
              SessionStart: [
                {
                  hooks: [{ type: "command", command: "echo unexpected > unexpected", if: "bash" }],
                },
              ],
            },
          }),
        );
      },
    });
    try {
      await app.waitFor(() => app.stdin.isRaw);
      const source = `${session.homeDir}/.neant/settings.json: /hooks/SessionStart/0/hooks/0/if`;
      expect(app.stderr()).toBe(
        locale === "zh"
          ? `警告：${source}：if 仅支持工具事件，此 SessionStart hook 永不运行\n`
          : `Warning: ${source}: if is only supported on tool events; this SessionStart hook will never run\n`,
      );
      expect(await Bun.file(join(session.cwd, "unexpected")).exists()).toBe(false);
    } finally {
      await app.cleanup();
    }
  },
);

test("TUI exit disposes an idle Session and runs SessionEnd once", async () => {
  const app = await start([], {
    session: {
      settings: {
        hooks: {
          SessionEnd: [{ matcher: "exit", hooks: [{ type: "command", command: "cat >> ended" }] }],
        },
      },
    },
  });
  try {
    await app.waitFor(() => app.stdin.isRaw);
    app.stdin.write("\x04");
    expect(await app.exit).toBe(0);
    expect((await Bun.file(join(app.root, "ended")).json()).reason).toBe("exit");
    expect(app.stdin.isRaw).toBe(false);
  } finally {
    await app.cleanup();
  }
});

test("renders Markdown replies and continues two prompts in the same Session", async () => {
  const app = await startWithClock([], { rows: 40 });
  try {
    await app.waitFor(() => app.stdin.isRaw);
    app.stdin.write("first prompt\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("**literal** 中\nsecond line");
    await app.waitFor(() => app.screen().includes(`${assistant} literal 中`));
    await app.waitFor(() => app.screen().includes("  second line"));
    expect(app.screen()).toContain("  second line");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).toContain("faux/faux");
    expect(app.screen().at(-2)).toContain("11→5");
    app.stdin.write("second prompt\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.slice(-3)).toMatchObject([
      { role: "user", content: [{ type: "text", text: "first prompt" }] },
      { role: "assistant", content: [{ type: "text", text: "**literal** 中\nsecond line" }] },
      { role: "user", content: [{ type: "text", text: "second prompt" }] },
    ]);
    app.calls[1]!.delta("final reply");
    app.calls[1]!.finish(7, 2);
    await app.waitFor(() => app.screen().at(-2)?.includes("18→7") === true);
    expect(app.allLines().filter((line) => line === "❯ first prompt")).toHaveLength(1);
    expect(app.allLines().filter((line) => line === `${assistant} literal 中`)).toHaveLength(1);
    expect(app.allLines()).toContain("❯ second prompt");
    await app.waitFor(() => app.allLines().includes(`${assistant} final reply`));
    expect(app.allLines()).toContain(`${assistant} final reply`);
    expect(app.allLines().join("\n")).not.toContain("system-reminder");
    app.stdin.write("\x04");
    expect(await app.exit).toBe(0);
    expect(app.stdin.isRaw).toBe(false);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("submission clears the editor before the next key in the same input chunk", async () => {
  const app = await start();
  try {
    await app.waitFor(() => app.stdin.isRaw);
    app.stdin.write("first\rnext");
    await app.waitFor(() => app.calls.length === 1);
    await app.waitFor(() => app.screen().includes("❯ next"));
    app.calls[0]!.delta("first reply");
    app.calls[0]!.finish();
    await app.waitFor(
      () => app.allLines().includes(`${assistant} first reply`) && !app.isWorking(),
    );
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "next" }],
    });
    app.calls[1]!.delta("second reply");
    app.calls[1]!.finish();
    await app.waitFor(() => app.allLines().includes(`${assistant} second reply`));
  } finally {
    await app.cleanup();
  }
});

test("idle Ctrl+C clears the editor before subsequent keys in the same input chunk", async () => {
  const app = await start();
  try {
    await app.waitFor(() => app.stdin.isRaw);
    app.stdin.write("discard");
    await app.waitFor(() => app.screen().includes("❯ discard"));
    app.stdin.write("\x03fresh\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(app.calls[0]!.context.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "fresh" }],
    });
    app.calls[0]!.delta("fresh reply");
    app.calls[0]!.finish();
    await app.waitFor(() => app.allLines().includes(`${assistant} fresh reply`));
  } finally {
    await app.cleanup();
  }
});

for (const [name, key] of [
  ["Esc", "\x1b"],
  ["Ctrl+C", "\x03"],
]) {
  test(`${name} interrupts a Run, preserves its messages and keeps the editable draft`, async () => {
    const app = await start();
    try {
      await app.waitFor(() => app.stdin.isRaw);
      app.stdin.write("interrupt me\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.delta("retained partial");
      await app.waitFor(() => app.screen().includes(`${assistant} retained partial`));
      app.stdin.write("next draft\r");
      await app.waitFor(() => app.screen().includes("❯ next draft"));
      expect(app.calls).toHaveLength(1);
      app.stdin.write(key!);
      await app.waitFor(() => !app.isWorking());
      expect(app.calls[0]!.signal!.aborted).toBe(true);
      expect(app.screen().join("\n")).not.toContain("tokens");
      expect(app.screen().join("\n")).not.toContain(" 工具 · 想");
      expect(app.allLines()).toContain("❯ interrupt me");
      expect(
        app.allLines().filter((line) => line === `${assistant} retained partial`),
      ).toHaveLength(1);
      expect(app.stdin.isRaw).toBe(true);
      app.stdin.write("\r");
      await app.waitFor(() => app.calls.length === 2);
      expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
        role: "user",
        content: [{ type: "text", text: "next draft" }],
      });
      app.calls[1]!.delta("continued reply");
      app.calls[1]!.finish();
      await app.waitFor(() => !app.isWorking());
    } finally {
      await app.cleanup();
    }
  });
}

test("Ctrl+C clears an idle draft, then two presses on empty input exit and restore the terminal", async () => {
  const app = await start();
  try {
    await app.waitFor(() => app.stdin.isRaw);
    app.stdin.write("discard draft");
    await app.waitFor(() => app.screen().includes("❯ discard draft"));
    app.stdin.write("\x03");
    await app.waitFor(() => !app.screen().join("\n").includes("discard draft"));
    app.stdin.write("\x03");
    await Bun.sleep(30);
    expect(app.stdin.isRaw).toBe(true);
    app.stdin.write("\x03");
    expect(await app.exit).toBe(0);
    expect(app.stdin.isRaw).toBe(false);
    expect(app.stdin.listenerCount("data")).toBe(0);
    expect(app.stdout.listenerCount("resize")).toBe(0);
    await app.flush();
    expect(app.terminal.modes.bracketedPasteMode).toBe(false);
    expect(app.output()).toContain("\x1b[?25h");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("Ctrl+C only exits for two consecutive empty-input presses within one second", async () => {
  const app = await start();
  try {
    await app.waitFor(() => app.stdin.isRaw);
    app.stdin.write("\x03");
    await Bun.sleep(1050);
    app.stdin.write("\x03");
    await Bun.sleep(30);
    expect(app.stdin.isRaw).toBe(true);
    app.stdin.write("x\x7f");
    await Bun.sleep(30);
    app.stdin.write("\x03");
    await Bun.sleep(30);
    expect(app.stdin.isRaw).toBe(true);
    app.stdin.write("\x03");
    expect(await app.exit).toBe(0);
  } finally {
    await app.cleanup();
  }
});

test("Ctrl+D exits only on idle empty input", async () => {
  const app = await start();
  try {
    await app.waitFor(() => app.stdin.isRaw);
    app.stdin.write("keep draft\x04");
    await app.waitFor(() => app.screen().includes("❯ keep draft"));
    expect(app.stdin.isRaw).toBe(true);
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("\x04");
    await Bun.sleep(30);
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    expect(app.stdin.isRaw).toBe(true);
    app.calls[0]!.delta("done");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("\x04");
    expect(await app.exit).toBe(0);
    expect(app.stdin.isRaw).toBe(false);
  } finally {
    await app.cleanup();
  }
});

test("a positional prompt is submitted automatically", async () => {
  const app = await startWithClock(["auto prompt"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    expect(app.calls[0]!.context.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "auto prompt" }],
    });
    app.calls[0]!.delta("automatic reply");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.allLines()).toContain("❯ auto prompt");
    await app.waitFor(() => app.allLines().includes(`${assistant} automatic reply`));
    expect(app.allLines()).toContain(`${assistant} automatic reply`);
  } finally {
    await app.cleanup();
  }
});

test("a model failure preserves partial output and permits the next prompt", async () => {
  const app = await startWithClock(["fail first"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("partial before failure");
    app.calls[0]!.fail("provider unavailable");
    await app.waitFor(
      () =>
        app.screen().some((line) => line.includes("provider unavailable")) &&
        app.allLines().includes(`${assistant} partial before failure`),
    );
    expect(app.isWorking()).toBe(false);
    expect(app.screen().join("\n")).not.toContain("tokens");
    expect(app.screen().join("\n")).not.toContain(" 工具 · 想");
    expect(app.allLines()).toContain(`${assistant} partial before failure`);
    app.stdin.write("retry\r");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta("retry succeeded");
    app.calls[1]!.finish();
    await app.waitFor(
      () => app.allLines().includes(`${assistant} retry succeeded`) && !app.isWorking(),
    );
    expect(app.allLines().filter((line) => line.includes("provider unavailable"))).toHaveLength(1);
    expect(app.allLines()).toContain(`${assistant} retry succeeded`);
  } finally {
    await app.cleanup();
  }
});

for (const [argv, message] of [
  [["--nope"], "Unknown option"],
  [["one", "two"], "Unexpected argument: two"],
  [["--model", "invalid"], '--model must be provider/id, got "invalid"'],
  [["--thinking", "invalid"], "--thinking must be one of"],
  [["--allow-tools", ""], "--allow-tools: invalid permission rule"],
  [["--model"], "argument missing"],
  [["--permission-mode"], "argument missing"],
  [["--permission-mode", "invalid"], "--permission-mode must be one of"],
  [["--permission-mode", ""], "--permission-mode must be one of"],
  [["--yolo", "--permission-mode", "ask"], "--yolo conflicts with --permission-mode"],
  [["--permission-mode", "auto-review", "--yolo"], "--yolo conflicts with --permission-mode"],
] as const) {
  test(`invalid arguments ${argv.join(" ")} exit with 2 before entering rendering`, async () => {
    const app = await startWithClock([...argv], { env: { LANG: "en" } });
    try {
      expect(await app.exit).toBe(2);
      expect(app.stderr()).toContain(message);
      expect(app.output()).toBe("");
      expect(app.stdin.isRaw).toBe(false);
      expect(app.calls).toHaveLength(0);
    } finally {
      await app.cleanup();
    }
  });
}

test("missing model configuration reports localized guidance and exits before rendering", async () => {
  const app = await start([], { session: { model: undefined, streamFn: undefined } });
  try {
    expect(await app.exit).toBe(1);
    expect(app.stderr()).toContain("未配置模型。请在 ");
    expect(app.stderr()).toContain("或传入 --model provider/id。");
    expect(app.stderr()).toContain("自定义 OpenAI 兼容 provider 示例：");
    expect(app.output()).toBe("");
    expect(app.stdin.isRaw).toBe(false);
  } finally {
    await app.cleanup();
  }
});

test("invalid settings reports the same configuration error before entering rendering", async () => {
  const app = await start([], {
    prepare: async (root) => {
      await Bun.write(join(root, ".neant/settings.json"), "{invalid");
    },
  });
  try {
    expect(await app.exit).toBe(1);
    expect(app.stderr()).toContain(".neant/settings.json: invalid JSON:");
    expect(app.output()).toBe("");
    expect(app.stdin.isRaw).toBe(false);
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("--resume continues the existing Session context", async () => {
  const root = await mkdtemp(join(tmpdir(), "neant-tui-resume-"));
  await mkdir(join(root, ".neant", "file-history"), { recursive: true });
  const terminal = createTerminal();
  const fake = controlledModel();
  let stderr = "";
  let exit: Promise<number> | undefined;
  try {
    const session = await createSession({ cwd: root, homeDir: root, ...fake });
    const run = session.run("stored prompt");
    await terminal.waitFor(() => fake.calls.length === 1);
    fake.calls[0]!.delta("stored reply");
    fake.calls[0]!.finish();
    await run;
    exit = main(["--resume", session.id, "continuation"], {
      ...terminal,
      env: { LANG: "zh_CN.UTF-8" },
      stderr: (text) => (stderr += text),
      session: { cwd: root, homeDir: root, ...fake },
    });
    await terminal.waitFor(() => fake.calls.length === 2);
    expect(fake.calls[1]!.context.messages.slice(-5)).toMatchObject([
      { role: "user", content: [{ type: "text", text: "stored prompt" }] },
      { role: "assistant", content: [{ type: "text", text: "stored reply" }] },
      {
        role: "system",
        toolsAdded: expect.arrayContaining([
          expect.objectContaining({ name: "ask_user_question" }),
          expect.objectContaining({ name: "exit_plan_mode" }),
        ]),
      },
      { role: "user", content: [{ type: "text", text: expect.stringContaining("[状态栏]") }] },
      { role: "user", content: [{ type: "text", text: "continuation" }] },
    ]);
    fake.calls[1]!.delta("resumed reply");
    fake.calls[1]!.finish();
    await terminal.waitFor(() => terminal.screen().includes(`${assistant} resumed reply`));
    const lines = terminal.allLines();
    const restored = lines.indexOf("❯ stored prompt");
    expect(restored).toBeGreaterThanOrEqual(0);
    expect(lines.slice(restored, restored + 7)).toEqual([
      "❯ stored prompt",
      "",
      `${assistant} stored reply`,
      "",
      "❯ continuation",
      "",
      `${assistant} resumed reply`,
    ]);
    await terminal.waitFor(() => !terminal.isWorking());
    terminal.stdin.write("\x04");
    expect(await exit).toBe(0);
    expect(stderr).toBe("");
  } finally {
    terminal.stdin.write("\x1b");
    await Bun.sleep(40);
    terminal.stdin.write("\x03\x03\x03");
    await exit;
    terminal.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

for (const [mode, argv, session] of [
  ["multiple allow patterns", ["--allow-tools", "unrelated", "wri?e", "--", "write a file"], {}],
  [
    "repeated allow flags",
    ["--allow-tools=unrelated", "--allow-tools=write", "--", "write a file"],
    {},
  ],
  [
    "injected allow patterns",
    ["write a file", "--allow-tools", "unrelated"],
    { allowRules: ["write"] },
  ],
  ["yolo", ["--yolo", "write a file"], {}],
  ["full-access", ["--permission-mode", "full-access", "write a file"], {}],
  ["settings mode", ["write a file"], { settings: { permissionMode: "full-access" } }],
  ["injected mode", ["write a file"], { permissionMode: "full-access" }],
  ["matching aliases", ["--yolo", "--permission-mode=full-access", "write a file"], {}],
  ["matching aliases reversed", ["--permission-mode=full-access", "--yolo", "write a file"], {}],
] as const) {
  test(`${mode} is forwarded to the Session and usage totals all Turns`, async () => {
    const app = await startWithClock([...argv], {
      columns: 120,
      session: { ...session, allowRules: "allowRules" in session ? [...session.allowRules] : [] },
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      expect(app.calls[0]!.context.messages.at(-1)).toMatchObject({
        role: "user",
        content: [{ type: "text", text: "write a file" }],
      });
      app.calls[0]!.tool("write", { path: "written.txt", content: "content" });
      await app.waitFor(() => app.calls.length === 2);
      expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
        role: "toolResult",
        toolName: "write",
        isError: false,
      });
      app.calls[1]!.delta("file written");
      app.calls[1]!.finish(13, 3);
      await app.waitFor(() => app.screen().at(-2)?.includes("24→8") === true);
      await app.waitFor(() => app.allLines().includes(`${assistant} file written`));
      expect(app.allLines()).toContain(`${assistant} file written`);
    } finally {
      await app.cleanup();
    }
  });
}

test("--thinking is forwarded to the model request", async () => {
  const app = await start(["--thinking", "high", "think"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    expect(app.calls[0]!.reasoning).toBe("high");
    app.calls[0]!.delta("thoughtful reply");
    app.calls[0]!.finish();
    await app.waitFor(() => app.allLines().includes(`${assistant} thoughtful reply`));
  } finally {
    await app.cleanup();
  }
});

test("--model overrides settings before model resolution", async () => {
  const app = await start(["--model", "missing/selected"], {
    session: { model: undefined, streamFn: undefined },
    prepare: async (root) => {
      await Bun.write(
        join(root, ".neant/settings.json"),
        JSON.stringify({ model: "missing/original" }),
      );
    },
  });
  try {
    expect(await app.exit).toBe(1);
    expect(app.stderr()).toBe('未知模型 "missing/selected"。\n');
    expect(app.output()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("--trust-project-mcp loads project configuration", async () => {
  const app = await startWithClock(["--trust-project-mcp", "hi"], {
    prepare: async (root) => {
      await Bun.write(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { broken: {} } }));
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    await app.waitFor(() =>
      app.allLines().some((line) => line.startsWith("─ MCP 服务器 broken 出错：")),
    );
    expect(app.stderr()).toBe("");
    app.calls[0]!.delta("project MCP checked");
    app.calls[0]!.finish();
    await app.waitFor(() => app.allLines().includes(`${assistant} project MCP checked`));
  } finally {
    await app.cleanup();
  }
});

test.each(["", "bash(git status", "unknown(pattern)"])(
  "invalid --allow-tools rule %j reports its source before rendering",
  async (rule) => {
    const app = await startWithClock(["--allow-tools", rule], { env: { LANG: "en" } });
    try {
      expect(await app.exit).toBe(2);
      expect(app.stderr()).toContain(`--allow-tools: invalid permission rule "${rule}"`);
      expect(app.output()).toBe("");
      expect(app.calls).toHaveLength(0);
    } finally {
      await app.cleanup();
    }
  },
);

test.each([
  ["bash(git status*)", "git status --short"],
  ["bash(printf a,b*)", "printf a,b > marker"],
  ["bash(printf {alpha,beta}*)", "printf alpha > marker"],
])("--allow-tools %s executes a matching command without a question", async (rule, command) => {
  const app = await startWithClock(["run", "--allow-tools", rule!], {
    prepare: async (root) => {
      expect(
        await Bun.spawn(["git", "init", "--quiet", root], { stdout: "ignore", stderr: "ignore" })
          .exited,
      ).toBe(0);
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command, description: "Run test command" });
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      role: "toolResult",
      isError: false,
    });
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.stderr()).toBe("");
    expect(app.allLines().join("\n")).not.toContain("等待审批");
  } finally {
    await app.cleanup();
  }
});
