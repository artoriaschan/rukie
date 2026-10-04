import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { start } from "../helpers/app";
import { createTerminal } from "../helpers/terminal";
import { main } from "../../src/main";

test.each([
  [{ LANG: "en_US.UTF-8" }, undefined, "Ask", "Allow once", "Deny"],
  [{ LANG: "zh_CN.UTF-8" }, undefined, "询问", "允许（仅本次）", "拒绝"],
  [{ LANG: "C" }, undefined, "Ask", "Allow once", "Deny"],
  [{ LANG: "en_US.UTF-8" }, "zh-CN", "询问", "允许（仅本次）", "拒绝"],
  [{ LANG: "zh_CN.UTF-8" }, "en-GB", "Ask", "Allow once", "Deny"],
  [{ LANG: "zh_CN.UTF-8" }, "fr", "询问", "允许（仅本次）", "拒绝"],
  [{ LANG: "en", LC_MESSAGES: "zh", LC_ALL: "en" }, undefined, "Ask", "Allow once", "Deny"],
  [
    { LANG: "en", LC_MESSAGES: "zh", LC_ALL: "C.UTF-8" },
    undefined,
    "询问",
    "允许（仅本次）",
    "拒绝",
  ],
] as const)(
  "startup %j with locale %j renders %s permission UI",
  async (env, locale, mode, allow, deny) => {
    const app = await start(["permission"], {
      columns: 120,
      env,
      prepare: async (root) => {
        if (locale !== undefined)
          await Bun.write(join(root, ".neant/settings.json"), JSON.stringify({ locale }));
      },
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      expect(app.screen().at(-2)).toStartWith(` ${mode} ·`);
      app.stdin.write("\x1b[<35;2;23M");
      await app.waitFor(
        () =>
          app
            .screen()
            .at(-1)
            ?.includes(mode === "Ask" ? "Read-only tools" : "只读工具") === true,
      );
      app.calls[0]!.tool("bash", { command: "printf locale-test" });
      await app.waitFor(() => app.screen().some((line) => line.includes(`1. ${allow}`)));
      expect(app.screen().join("\n")).toContain(`3. ${deny}`);
      expect(app.screen().join("\n")).toContain(
        mode === "Ask" ? "2. Allow this command for this session" : "2. 本 session 允许此命令",
      );
    } finally {
      await app.cleanup();
    }
  },
);

test("project locale is ignored and startup locale stays fixed after env changes", async () => {
  const env = { LANG: "en_US.UTF-8" };
  const session: { homeDir?: string } = {};
  const app = await start([], {
    env,
    session,
    prepare: async (root) => {
      session.homeDir = join(root, "home");
      await Bun.write(join(root, ".neant/settings.json"), JSON.stringify({ locale: "zh" }));
    },
  });
  try {
    await app.waitFor(() => app.stdin.isRaw);
    expect(app.stderr()).toContain('ignoring "locale"');
    expect(app.screen().at(-2)).toStartWith(" Ask ·");
    env.LANG = "zh_CN.UTF-8";
    app.stdin.write("\x1b[Z");
    await app.waitFor(() => app.screen().at(-2)?.startsWith(" Auto review ·") === true);
    app.stdin.write("\x1b[Z");
    await app.waitFor(() => app.screen().at(-2)?.startsWith(" Full access ·") === true);
  } finally {
    await app.cleanup();
  }
});

test.each([
  [60, "Other tools need approval"],
  [120, "Read-only tools are allowed; other tools require approval"],
] as const)("English permission description fits at %s columns", async (columns, description) => {
  const app = await start([], { columns, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.stdin.isRaw);
    app.stdin.write("\x1b[<35;2;23M");
    await app.waitFor(() => app.screen().at(-1)?.includes(description) === true);
  } finally {
    await app.cleanup();
  }
});

test.each([
  [["--nope"], "未知选项：--nope"],
  [["one", "two"], "多余参数：two"],
  [["--model", "invalid"], '--model 必须为 provider/id，收到 "invalid"'],
  [["--thinking", "invalid"], "--thinking 必须为以下值之一"],
  [["--allow-tools", ""], "--allow-tools: 无效的权限规则"],
  [["--model"], "选项 --model <value> 缺少参数"],
  [["--yolo=yes"], "选项 --yolo 不接受参数"],
  [["--permission-mode", "invalid"], "--permission-mode 必须为以下值之一"],
  [["--yolo", "--permission-mode", "ask"], "--yolo 与 --permission-mode 冲突"],
] as const)("argv %j uses environment locale before settings", async (argv, message) => {
  const app = await start([...argv], {
    env: { LANG: "en", LC_MESSAGES: "zh_CN.UTF-8" },
    prepare: (root) =>
      Bun.write(join(root, ".neant/settings.json"), '{"locale":"en"}').then(() => {}),
  });
  try {
    expect(await app.exit).toBe(2);
    expect(app.stderr()).toContain(message);
    expect(app.output()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["zh", "neant 需要交互式终端"],
  ["en", "neant requires an interactive terminal"],
] as const)("%s non-interactive terminal guidance", async (locale, message) => {
  const root = await mkdtemp(join(tmpdir(), "neant-locale-terminal-"));
  const terminal = createTerminal();
  terminal.stdin.isTTY = false;
  let stderr = "";
  try {
    expect(
      await main([], {
        ...terminal,
        env: { LANG: locale },
        session: { cwd: root, homeDir: root },
        stderr: (text) => (stderr += text),
      }),
    ).toBe(1);
    expect(stderr).toContain(message);
    expect(stderr).toContain("neant-cli");
    expect(terminal.output()).toBe("");
  } finally {
    terminal.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("settings warning prefix follows user locale", async () => {
  const session: { homeDir?: string } = {};
  const app = await start([], {
    env: { LANG: "en" },
    session,
    prepare: async (root) => {
      session.homeDir = join(root, "home");
      await Bun.write(join(root, "home/.neant/settings.json"), '{"locale":"zh"}');
      await Bun.write(join(root, ".neant/settings.json"), '{"locale":"en"}');
    },
  });
  try {
    await app.waitFor(() => app.stdin.isRaw);
    expect(app.stderr()).toStartWith("警告：");
    expect(app.stderr()).toContain('ignoring "locale"');
  } finally {
    await app.cleanup();
  }
});

test("English approval dialog shows translated title, question and keyboard hints", async () => {
  const app = await start(["permission"], { columns: 120, rows: 40, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "printf consent" });
    await app.waitFor(() => app.screen().some((line) => line.includes("1. Allow once")));
    const screen = app.screen().join("\n");
    expect(screen).toContain("Waiting for approval · bash");
    expect(screen).toContain("Allow this operation?");
    expect(screen).toContain("↑↓ select · Enter confirm · Esc deny · Tab details");
    app.stdin.write("\x1b[9u");
    await app.waitFor(() => app.screen().some((line) => line.includes("Tab transcript")));
  } finally {
    await app.cleanup();
  }
});

test("English status chrome and hover labels render through the startup locale", async () => {
  const app = await start(["first"], { columns: 160, env: { LANG: "en" } });
  const move = (column: number, row = 23) => app.stdin.write(`\x1b[<35;${column};${row}M`);
  try {
    await app.waitFor(() => app.calls.length === 1);
    expect(app.screen().at(-1)?.trim()).toBe("esc interrupt");
    move(2);
    await app.waitFor(() => app.screen().at(-1)?.includes("shift+tab switch mode") === true);
    expect(app.screen().at(-1)).toContain("Mode Ask");
    move(2, 22);
    await app.waitFor(() => app.screen().at(-1)?.includes("system ") === true);
    for (const label of ["prompt", "assistant", "thinking", "tools"])
      expect(app.screen().at(-1)).toContain(label);
    app.calls[0]!.finish(1000, 5, { read: 2000, write: 1000 });
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().at(-2)).toContain("cache 50.0%");
    const fields = app.screen().at(-2)!;
    move(Bun.stringWidth(fields.slice(0, fields.indexOf("cache"))) + 1);
    await app.waitFor(
      () =>
        app.screen().at(-1)?.includes("cache 50.0% · read 2.0k · write 1.0k · input 1.0k") === true,
    );
  } finally {
    await app.cleanup();
  }
});

test("English return badge, context warning and small-window hint", async () => {
  const app = await start(["long reply"], { columns: 120, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(Array.from({ length: 50 }, (_, i) => `line-${i}`).join("\n"));
    await app.waitFor(() => app.screen().includes("  line-49"));
    app.stdin.write("\x1b[<64;5;2M");
    await app.waitFor(() => app.screen().some((line) => line.includes("Ctrl+End")));
    expect(app.screen().join("\n")).toContain("Back to bottom (Ctrl+End)");
    app.calls[0]!.delta("\nnew output");
    await app.waitFor(() =>
      app.screen().some((line) => line.includes("New output · Back to bottom")),
    );
    app.stdin.write("\x1b[1;5F");
    app.calls[0]!.finish(102400, 10);
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("second\r");
    await app.waitFor(
      () => app.calls.length === 2 && app.screen().some((line) => line.includes("⚠ Context 80%")),
    );
    app.resize(90, 10);
    await app.waitFor(() => app.screen().some((line) => line.includes("40 columns × 12 rows")));
    expect(app.screen().join("\n")).toContain("Ctrl+C interrupt/exit");
  } finally {
    await app.cleanup();
  }
});

test("Chinese context segment names use Chinese while technical abbreviations stay stable", async () => {
  const app = await start(["first"], { columns: 160, env: { LANG: "zh" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("\x1b[<35;2;22M");
    await app.waitFor(() => app.screen().at(-1)?.includes("■") === true);
    for (const label of ["系统", "提示词", "助手", "思考", "工具"])
      expect(app.screen().at(-1)).toContain(label);
  } finally {
    await app.cleanup();
  }
});

test("English welcome header localizes configured effort", async () => {
  const app = await start(["--thinking", "high"], { env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.screen().some((line) => line.includes("High effort")));
    expect(app.screen().join("\n")).not.toContain("推理强度");
  } finally {
    await app.cleanup();
  }
});

test("user locale overrides environment for non-interactive terminal guidance", async () => {
  const root = await mkdtemp(join(tmpdir(), "neant-locale-terminal-"));
  const terminal = createTerminal();
  terminal.stdin.isTTY = false;
  let stderr = "";
  try {
    await Bun.write(join(root, ".neant/settings.json"), '{"locale":"zh"}');
    expect(
      await main([], {
        ...terminal,
        env: { LANG: "en" },
        session: { cwd: root, homeDir: root },
        stderr: (text) => (stderr += text),
      }),
    ).toBe(1);
    expect(stderr).toContain("neant 需要交互式终端");
    expect(terminal.output()).toBe("");
  } finally {
    terminal.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test.each([
  ["zh", "", "无效的权限规则"],
  ["zh", "bash(echo", "无效的权限规则"],
  ["zh", "  unknown(pattern)  ", "无效的权限规则"],
  ["en", "", "invalid permission rule"],
  ["en", "bash(echo", "invalid permission rule"],
  ["en", "  unknown(pattern)  ", "invalid permission rule"],
] as const)(
  "%s invalid rule %j reports localized feedback with source and original text",
  async (locale, rule, message) => {
    let source = "";
    const app = await start([], {
      env: { LANG: locale },
      prepare: async (root) => {
        source = join(root, ".neant/settings.json");
        await Bun.write(source, JSON.stringify({ permissions: { allow: [rule] } }));
      },
    });
    try {
      expect(await app.exit).toBe(1);
      expect(app.stderr()).toContain(`${source}: ${message} "${rule}"`);
      expect(app.calls).toHaveLength(0);
      expect(app.output()).toBe("");
    } finally {
      await app.cleanup();
    }
  },
);

test.each([
  ["zh", "allowTools 已移除，请迁移到 permissions.allow。"],
  ["en", '"allowTools" has been removed; migrate to "permissions.allow".'],
] as const)(
  "%s legacy settings show the localized migration error and source",
  async (locale, message) => {
    let source = "";
    const app = await start([], {
      env: { LANG: locale },
      prepare: async (root) => {
        source = join(root, ".neant/settings.json");
        await Bun.write(source, JSON.stringify({ allowTools: [] }));
      },
    });
    try {
      expect(await app.exit).toBe(1);
      expect(app.stderr()).toBe(`${source}: ${message}\n`);
      expect(app.output()).toBe("");
      expect(app.calls).toHaveLength(0);
    } finally {
      await app.cleanup();
    }
  },
);
