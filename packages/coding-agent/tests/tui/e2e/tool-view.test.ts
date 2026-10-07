import { testClock } from "../helpers/test-clock";
import { expect, test } from "bun:test";
import { start } from "../helpers/app";
import { join } from "node:path";
import { startWithClock } from "../helpers/clock-app";

test("terminal cards localize the name and keep exit status outside folded output", async () => {
  const app = await start(["--yolo", "run"], { env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command: "printf 'one\\ntwo\\nthree\\nfour\\nfive\\n'; exit 7",
      description: "Print output",
    });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    const text = app.allLines().join("\n");
    expect(text).toContain("Bash(printf");
    expect(text).toContain("ctrl+o to expand");
    expect(text).toContain("Exit code: 7");
    expect(text).not.toContain("⎿ five");
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["zh_CN.UTF-8", "执行", "运行中…"],
  ["en_US.UTF-8", "Bash", "Running…"],
])(
  "%s running cards blink together and stay lit without terminal focus",
  async (lang, name, running) => {
    const app = await startWithClock(["--yolo", "run"], { env: { LANG: lang } });
    const dot = process.platform === "darwin" ? "⏺" : "●";
    try {
      app.stdin.write("\x1b[I");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tools([
        {
          name: "bash",
          args: {
            command: "while [ ! -e release ]; do sleep 0.01; done; true",
            description: "First",
          },
        },
        {
          name: "bash",
          args: {
            command: "while [ ! -e release ]; do sleep 0.01; done; false",
            description: "Second",
          },
        },
      ]);
      const cards = () => app.screen().filter((line) => line.includes(`${name}(while`));
      await app.waitFor(() => cards().length === 2);
      expect(app.screen().join("\n")).toContain(running!);
      await app.waitFor(() => cards().every((line) => line.startsWith(`  ${name}(`)));
      app.stdin.write("\x1b[O");
      await app.waitFor(() => cards().every((line) => line.startsWith(`${dot} ${name}(`)));
      testClock.advanceTimersByTime(1200);
      await app.flush();
      expect(cards().every((line) => line.startsWith(`${dot} ${name}(`))).toBe(true);
      expect(app.output()).toContain("\x1b[?1004h");
    } finally {
      await Bun.write(join(app.root, "release"), "");
      await app.waitFor(() => app.calls.length === 2);
      app.calls[1]!.finish();
      await app.cleanup();
      expect(app.output()).toContain("\x1b[?1004l");
    }
  },
);

test("a four-line terminal body stays visible without a folding hint", async () => {
  const app = await start(["--yolo", "run"], { env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command: "printf 'one\\ntwo\\nthree\\nfour'",
      description: "Four lines",
    });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.allLines()).toContain("   four");
    expect(app.allLines().join("\n")).not.toContain("ctrl+o to expand");
    expect(app.allLines().join("\n")).toContain(" · 0s");
  } finally {
    await app.cleanup();
  }
});

test("logical preview wraps Unicode content, ignores trailing newline and preserves status on hover", async () => {
  const app = await start(["--yolo", "read wrapped"], {
    columns: 40,
    rows: 40,
    env: { LANG: "en" },
    prepare: (root) =>
      Bun.write(join(root, "wrapped.txt"), `${"界".repeat(30)}END\nsecond\nthird\nfourth\n`).then(
        () => {},
      ),
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path: "wrapped.txt" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    const screen = () => app.screen().join("\n");
    expect(screen()).toContain("END");
    expect(screen()).toContain("fourth");
    expect(screen()).not.toContain("ctrl+o to expand");
    const row = app.screen().findIndex((line) => line.includes("Read wrapped.txt"));
    expect(row).toBeGreaterThanOrEqual(0);
    app.stdin.write(`\x1b[<35;5;${row + 1}M`);
    await app.waitFor(() => app.screen()[row]!.includes("▾"));
    expect(app.screen()[row]).toMatch(/^• Read wrapped.txt.*▾/);
    app.resize(60, 40);
    await app.waitFor(() => app.screen().some((line) => line.includes("END")));
    expect(app.screen().every((line) => Bun.stringWidth(line) <= 60)).toBe(true);
  } finally {
    await app.cleanup();
  }
});

test("empty structured search falls back to its actual no-match result", async () => {
  const app = await start(["--yolo", "search"], { env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("grep", { pattern: "missing needle" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).toContain("No matches.");
  } finally {
    await app.cleanup();
  }
});
