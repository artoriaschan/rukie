import { afterEach, expect, test } from "bun:test";
import { main } from "../src/index.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { echoModel } from "./headless/helpers/echo-model";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function isolatedSession() {
  const root = await mkdtemp(join(tmpdir(), "neant-entry-"));
  roots.push(root);
  return { cwd: root, homeDir: root, ...echoModel() };
}

test.each([
  ["zh_CN.UTF-8", "-p"],
  ["en_US.UTF-8", "-p"],
])("%s rejects non-TTY input before Session creation", async (lang, guide) => {
  let stderr = "";
  expect(
    await main([], {
      env: { LANG: lang },
      readStdin: async () => "",
      stdout: () => {},
      stderr: (value) => {
        stderr += value;
      },
    }),
  ).toBe(2);
  expect(stderr).toContain(guide!);
  expect(stderr).toContain(lang!.startsWith("zh") ? "交互式终端" : "interactive terminal");
});

test("a Goal cannot silently discard a positional prompt", async () => {
  let stderr = "";
  expect(
    await main(["--goal", "target", "ignored prompt"], {
      session: await isolatedSession(),
      env: { LANG: "en" },
      readStdin: async () => "",
      stdout: () => {},
      stderr: (value) => {
        stderr += value;
      },
    }),
  ).toBe(2);
  expect(stderr).toContain("Unexpected argument: ignored prompt");
});

for (const flag of ["-p", "--print"]) {
  test(`${flag} sends a positional prompt through the public entry`, async () => {
    let stdout = "";
    expect(
      await main([flag, "question"], {
        env: { LANG: "en" },
        session: await isolatedSession(),
        readStdin: async () => {
          throw new Error("positional prompt must bypass stdin");
        },
        stdout: (value) => {
          stdout += value;
        },
        stderr: () => {},
      }),
    ).toBe(0);
    expect(stdout).toBe('echo: [{"type":"text","text":"question"}]\n');
  });
}

test("print reads piped stdin and sends allow-tools patterns after the terminator prompt", async () => {
  let stdout = "";
  expect(
    await main(["--print", "--allow-tools", "read", "glob", "--", "q"], {
      env: { LANG: "en" },
      session: await isolatedSession(),
      readStdin: async () => {
        throw new Error("positionals bypass stdin");
      },
      stdout: (value) => {
        stdout += value;
      },
      stderr: () => {},
    }),
  ).toBe(0);
  expect(stdout).toBe('echo: [{"type":"text","text":"q"}]\n');
  stdout = "";
  expect(
    await main(["-p"], {
      env: { LANG: "en" },
      session: await isolatedSession(),
      readStdin: async () => "piped\n",
      stdout: (value) => {
        stdout += value;
      },
      stderr: () => {},
    }),
  ).toBe(0);
  expect(stdout).toBe('echo: [{"type":"text","text":"piped"}]\n');
});

for (const [argv, en, zh] of [
  [["--output-format", "text"], "only available in Headless", "仅适用于 Headless"],
  [["--max-goal-rounds", "1"], "only available in Headless", "仅适用于 Headless"],
  [["--goal", "q", "--print"], "conflicts", "冲突"],
  [["--goal", ""], "cannot be empty", "不能为空"],
  [["--goal", "q", "--max-goal-rounds", "0"], "positive integer", "正整数"],
  [["-p", "--max-goal-rounds", "1"], "requires --goal", "需要 --goal"],
  [["-p", "--output-format", "bad"], "text or stream-json", "text 或 stream-json"],
  [["--prompt", "q"], "Unknown option", "未知选项"],
  [["--print=true"], "does not take an argument", "不接受参数"],
] as const)
  for (const [lang, expected] of [
    ["en", en],
    ["zh", zh],
  ]) {
    test(`${lang}: invalid entry arguments ${argv.join(" ")}`, async () => {
      let stderr = "";
      expect(
        await main([...argv], {
          env: { LANG: lang },
          session: await isolatedSession(),
          readStdin: async () => "",
          stdout: () => {},
          stderr: (value) => {
            stderr += value;
          },
        }),
      ).toBe(2);
      expect(stderr).toContain(expected!);
    });
  }

test("print entry never evaluates React or the terminal renderer in a fresh process", async () => {
  const session = await isolatedSession();
  const script = `
    import { mock } from "bun:test";
    mock.module("react", () => { throw new Error("React loaded during print"); });
    mock.module(${JSON.stringify(join(import.meta.dir, "../src/ink/index.ts"))}, () => { throw new Error("ink loaded during print"); });
    const { main } = await import(${JSON.stringify(join(import.meta.dir, "../src/index.ts"))});
    const { echoModel } = await import(${JSON.stringify(join(import.meta.dir, "headless/helpers/echo-model.ts"))});
    process.exitCode = await main(["-p", "module probe"], { env: { LANG: "en" }, session: { cwd: ${JSON.stringify(session.cwd)}, homeDir: ${JSON.stringify(session.homeDir)}, ...echoModel() }, readStdin: async () => "", stdout: value => { process.stdout.write(value); }, stderr: value => { process.stderr.write(value); } });
  `;
  const child = Bun.spawn([process.execPath, "-e", script], {
    cwd: join(import.meta.dir, ".."),
    signal: AbortSignal.timeout(4000),
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("module probe");
  } finally {
    child.kill();
    await child.exited;
  }
}, 5000);

test("pre-aborted TUI dispatch completes without rendering or creating a Session", async () => {
  const { createTerminal } = await import("./tui/helpers/terminal");
  const terminal = createTerminal();
  const controller = new AbortController();
  controller.abort();
  try {
    expect(
      await main(["initial"], {
        ...terminal,
        signal: controller.signal,
        env: { LANG: "en" },
        session: await isolatedSession(),
        stderr: () => {},
      }),
    ).toBe(0);
    expect(terminal.output()).toBe("");
  } finally {
    terminal.dispose();
  }
});

test("TUI signal cancellation closes the active Run and restores its terminal", async () => {
  const { start } = await import("./tui/helpers/app");
  const controller = new AbortController();
  const app = await start(["active"], { signal: controller.signal });
  try {
    await app.waitFor(() => app.calls.length === 1);
    controller.abort();
    expect(await app.exit).toBe(0);
    expect(app.stdin.isRaw).toBe(false);
    expect(app.screen().join("\n")).not.toContain("active");
  } finally {
    await app.cleanup();
  }
});
