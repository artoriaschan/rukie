import { expect, test, jest } from "bun:test";
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
      jest.advanceTimersByTime(1200);
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
