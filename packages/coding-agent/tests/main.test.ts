import { afterEach, expect, test } from "bun:test";
import { main } from "../src/index.ts";
import { mkdtemp, rm, readdir, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { echoModel } from "./headless/helpers/echo-model";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function isolatedSession() {
  const root = await mkdtemp(join(tmpdir(), "rukie-entry-"));
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

for (const [lang, usage] of [
  ["en", "Usage:"],
  ["zh", "用法："],
]) {
  for (const flag of ["--help", "-h", "--version", "-v"]) {
    test(`${lang}: ${flag} returns information without Session or stdin side effects`, async () => {
      const root = await mkdtemp(join(tmpdir(), "rukie-info-"));
      roots.push(root);
      let stdout = "";
      let stderr = "";
      expect(
        await main([flag], {
          env: { LANG: lang },
          session: { cwd: root, homeDir: root },
          readStdin: async () => {
            throw new Error("information must not read stdin");
          },
          stdout: (value) => {
            stdout += value;
          },
          stderr: (value) => {
            stderr += value;
          },
        }),
      ).toBe(0);
      expect(stderr).toBe("");
      if (flag === "--version" || flag === "-v") expect(stdout).toBe("0.1.0\n");
      else {
        expect(stdout).toContain(usage!);
        expect(stdout).toContain("--goal");
        expect(stdout).toContain("--allow-tools");
      }
      expect(await readdir(root)).toEqual([]);
    });
  }
}

for (const [lang, expected] of [
  ["en", "must be used alone"],
  ["zh", "必须单独使用"],
]) {
  for (const argv of [
    ["--help", "--version"],
    ["-h", "-p"],
    ["-v", "prompt"],
    ["--help", "--model", "provider/model"],
  ]) {
    test(`${lang}: information rejects combinations ${argv.join(" ")}`, async () => {
      let stderr = "";
      expect(
        await main(argv, {
          env: { LANG: lang },
          stdout: () => {
            throw new Error("invalid arguments must not output information");
          },
          stderr: (value) => {
            stderr += value;
          },
        }),
      ).toBe(2);
      expect(stderr).toContain(expected!);
    });
  }
}

for (const argv of [["--help", "--unknown"], ["--version=true"], ["--help", "--model"]])
  test(`information still validates ${argv.join(" ")}`, async () => {
    let stderr = "";
    expect(
      await main(argv, {
        env: { LANG: "en" },
        stdout: () => {},
        stderr: (value) => {
          stderr += value;
        },
      }),
    ).toBe(2);
    expect(stderr).not.toBe("");
  });

test("the executable information entry leaves isolated user settings and Sessions untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-info-command-"));
  roots.push(root);
  await mkdir(join(root, ".rukie"));
  await writeFile(join(root, ".rukie/settings.json"), "invalid settings sentinel");
  // Real child-process startup verifies the executable entry, independently of the injected main IO.
  for (const flag of ["--version", "--help"]) {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/main.ts"), flag], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: root, LANG: "en", LC_ALL: "en" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(4000),
    });
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain(flag === "--version" ? "0.1.0" : "Usage:");
      expect(await readdir(join(root, ".rukie"))).toEqual(["settings.json"]);
      expect(await readFile(join(root, ".rukie/settings.json"), "utf8")).toBe(
        "invalid settings sentinel",
      );
    } finally {
      child.kill();
      await child.exited;
    }
  }
}, 5000);
