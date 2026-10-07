import { expect, test, jest } from "bun:test";
import { join } from "node:path";
import { startWithClock } from "../helpers/clock-app";

test("Shift-Up selects a message and Enter expands only that card without changing the draft", async () => {
  const app = await startWithClock(["--yolo", "inspect"], {
    rows: 40,
    env: { LANG: "en" },
    prepare: (root) =>
      Bun.write(join(root, "file.txt"), "one\ntwo\nthree\nfour\nfive").then(() => {}),
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path: "file.txt" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("draft");
    await app.waitFor(() => app.screen().join("\n").includes("❯ draft"));
    app.stdin.write("\x1b[1;2A");
    await app.flush();
    const row = app.screen().findIndex((line) => line.includes("Read file.txt"));
    await app.waitFor(
      () =>
        app.terminal.buffer.active
          .getLine(
            app.terminal.buffer.active.viewportY +
              app.screen().findIndex((line) => line.includes("Read file.txt")),
          )
          ?.getCell(2)
          ?.getBgColor() === 0x2e333d,
    );
    expect(row).toBeGreaterThanOrEqual(0);
    app.stdin.write("\r");
    await app.waitFor(() => app.screen().some((line) => line.includes("five")));
    expect(app.calls).toHaveLength(2);
    app.stdin.write("\x1b[A\r");
    await app.flush();
    expect(app.calls).toHaveLength(2);
    app.stdin.write("\x1b[27u");
    await app.waitFor(() => app.screen().join("\n").includes("❯ draft"));
    expect(app.screen().join("\n")).toContain("❯ draft");
    expect(app.screen().some((line) => line.includes("five"))).toBe(true);
  } finally {
    await app.cleanup();
  }
});

test("timeline ticks seek actual user inputs and the fixed header names the input being read", async () => {
  const copied: string[] = [];
  const app = await startWithClock(["--yolo", "alpha"], {
    columns: 80,
    rows: 24,
    env: { LANG: "en" },
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(Array.from({ length: 45 }, (_, i) => `alpha-output-${i}`).join("\n"));
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("beta\r");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta(Array.from({ length: 45 }, (_, i) => `beta-output-${i}`).join("\n"));
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    await app.waitFor(() => app.screen().join("\n").includes("beta-output-44"));
    expect(app.screen()[0]).not.toContain("❯ beta");
    const tickRow = app.screen().findIndex((line) => line.endsWith(" ─"));
    expect(tickRow).toBeGreaterThanOrEqual(0);
    app.stdin.write(`\x1b[<0;79;${tickRow + 1}M\x1b[<0;79;${tickRow + 1}m`);
    await app.waitFor(
      () => (app.screen()[1]?.startsWith("❯ alpha") ?? false) && app.screen()[0]?.trim() === "",
    );
    expect(app.screen()[0]?.trim()).toBe("");
    app.stdin.write("\x1b[<65;20;5M");
    await app.waitFor(() => app.screen()[0]?.includes("alpha") ?? false);
    expect(app.screen().join("\n")).toContain("alpha-output");
    const contentRow = app.screen().findIndex((line) => line.includes("alpha-output"));
    app.stdin.write(
      `\x1b[<16;1;${contentRow + 1}M\x1b[<48;80;${contentRow + 1}M\x1b[<16;80;${contentRow + 1}m`,
    );
    await app.waitFor(() => copied.length === 1);
    expect(copied[0]).toMatch(/^alpha-output-\d+$/u);

    const up = app.screen().findIndex((line) => line.endsWith(" ▴"));
    app.stdin.write(`\x1b[<0;79;${up + 1}M\x1b[<0;79;${up + 1}m`);
    await app.waitFor(
      () => (app.screen()[1]?.startsWith("❯ alpha") ?? false) && app.screen()[0]?.trim() === "",
    );
    expect(app.screen()[0]?.trim()).toBe("");
    app.resize(59, 24);
    await app.waitFor(() => app.screen().every((line) => Bun.stringWidth(line) <= 59));
    expect(app.screen().some((line) => line.endsWith(" ▴") || line.endsWith("━━"))).toBe(false);
    app.resize(60, 24);
    await app.waitFor(() => app.screen().some((line) => line.endsWith(" ▴")));
    expect(app.screen()[1]?.startsWith("❯ alpha")).toBe(true);
  } finally {
    await app.cleanup();
  }
});

test.each(["en", "zh"])(
  "message selection releases on small resize and preserves history and active text ownership (%s)",
  async (locale) => {
    const copied: string[] = [];
    const app = await startWithClock(["--yolo", "original input"], {
      rows: 24,
      env: { LANG: locale },
      host: {
        writeClipboard: async (text) => {
          copied.push(text);
          return true;
        },
      },
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.delta("visible answer");
      app.calls[0]!.finish();
      await app.waitFor(
        () => !app.isWorking() && app.screen().join("\n").includes("visible answer"),
      );
      const y = app.screen().findIndex((line) => line.includes("visible answer"));
      app.stdin.write(`\x1b[<0;3;${y + 1}M\x1b[<32;8;${y + 1}M\x1b[1;2A\x1b[<0;8;${y + 1}m`);
      await app.waitFor(() => copied.length === 1);
      expect(copied[0]).not.toContain("⏺");
      app.stdin.write("next\r");
      await app.waitFor(() => app.calls.length === 2);
      app.calls[1]!.delta("next answer");
      app.calls[1]!.finish();
      await app.waitFor(() => !app.isWorking());
      app.stdin.write("\x1b[1;2A");
      await app.flush();
      app.resize(30, 10);
      await app.waitFor(() => app.screen().every((line) => Bun.stringWidth(line) <= 30));
      app.resize(80, 24);
      await app.waitFor(() => app.screen().join("\n").includes("next answer"));
      app.stdin.write("\x1b[A");
      await app.waitFor(() => app.screen().join("\n").includes("❯ next"));
      expect(app.calls).toHaveLength(2);
      expect(app.stderr()).toBe("");
    } finally {
      await app.cleanup();
    }
  },
);

test("Enter while reading returns to bottom before a second Enter submits the draft", async () => {
  const app = await startWithClock(["--yolo", "read"], { rows: 24, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(Array.from({ length: 70 }, (_, i) => `line-${i}`).join("\n"));
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking() && app.screen().join("\n").includes("line-69"));
    app.stdin.write("draft\x1b[5~");
    await app.waitFor(() => !app.screen().join("\n").includes("line-69"));
    app.stdin.write("\r");
    await app.waitFor(() => app.screen().join("\n").includes("line-69"));
    expect(app.calls).toHaveLength(1);
    expect(app.screen().join("\n")).toContain("❯ draft");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});

test("message cursor skips Background Job and Subagent cards while their own panels keep focus", async () => {
  const app = await startWithClock(["--yolo", "inspect"], {
    columns: 120,
    rows: 40,
    env: { LANG: "en" },
    prepare: (root) =>
      Bun.write(join(root, "file.txt"), "one\ntwo\nthree\nfour\nfive").then(() => {}),
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path: "file.txt" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.tools([
      {
        name: "bash",
        args: {
          command: "while [ ! -f go ]; do sleep 0.01; done",
          description: "Skip job",
          run_in_background: true,
        },
      },
      { name: "subagent", args: { description: "Skipped child", prompt: "child skip" } },
    ]);
    await app.waitFor(
      () =>
        app.screen().join("\n").includes("Subagent: Skipped child") &&
        app.screen().join("\n").includes("bash-1"),
    );
    app.stdin.write("\x1b[1;2A\r");
    await app.waitFor(() => app.screen().some((line) => line === "   five"));
    expect(app.screen().join("\n")).not.toContain("Agent View");
    expect(app.screen().join("\n")).not.toContain("Background jobs");
    app.stdin.write("\x1b[27u");
    await app.waitFor(() => {
      const y = app.screen().findIndex((line) => line.includes("Read file.txt"));
      return (
        app.terminal.buffer.active
          .getLine(app.terminal.buffer.active.viewportY + y)
          ?.getCell(2)
          ?.getBgColor() !== 0x2e333d
      );
    });
    app.stdin.write("\x01");
    await app.flush();
    await app.waitFor(() => app.screen().join("\n").includes("Subagents"));
    app.stdin.write("\x1b[1;2A\r");
    await app.waitFor(() => app.screen().join("\n").includes("Summary"));
    expect(app.screen().join("\n")).toContain("Skipped child");
    app.stdin.write("\x1b[27u");
    await app.waitFor(() => app.screen().join("\n").includes("Subagents"));
    app.stdin.write("\x1b[27u");
    await app.waitFor(() => app.screen().some((line) => line === "   five"));
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("timeline hover preview waits120ms and scroll clears it while Session clear resets navigation", async () => {
  const app = await startWithClock(["--yolo", "alpha preview-unique\nsecond source line"], {
    columns: 80,
    rows: 24,
    env: { LANG: "en" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("first output\n".repeat(35));
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("beta\r");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta("last output\n".repeat(34) + "tail-done");
    app.calls[1]!.finish();
    await app.waitFor(
      () =>
        !app.isWorking() &&
        app.screen().join("\n").includes("tail-done") &&
        app.screen().some((line) => line.endsWith(" ─")),
    );
    const row = app.screen().findIndex((line) => line.endsWith(" ─"));
    app.stdin.write(`\x1b[<35;79;${row + 1}M`);
    await app.flush();
    jest.advanceTimersByTime(119);
    await app.flush();
    expect(app.screen().join("\n")).not.toContain("preview-unique");
    jest.advanceTimersByTime(1);
    await app.waitFor(() => app.screen().join("\n").includes("preview-unique"));
    expect(app.screen().join("\n")).not.toContain("second source line");
    const previewRow = app
      .screen()
      .findIndex((line) => line.includes("╭") && !line.startsWith("╭"));
    const previewColumn = app.screen()[previewRow]!.indexOf("╭");
    expect(
      app.terminal.buffer.active
        .getLine(app.terminal.buffer.active.viewportY + previewRow)
        ?.getCell(previewColumn)
        ?.getFgColor(),
    ).toBe(0x8d95a6);
    app.stdin.write("\x1b[<64;79;5M");
    await app.waitFor(() => !app.screen().join("\n").includes("preview-unique"));
    app.stdin.write("\x1b[1;2A\x0f");
    await app.flush();
    app.stdin.write("\x0f");
    await app.flush();
    app.stdin.write("\x1b[1;5F");
    await app.waitFor(() => !app.screen().join("\n").includes("Back to bottom"));
    app.stdin.write("/clear\r");
    await app.waitFor(() => !app.screen().join("\n").includes("last output"));
    expect(app.screen()[0]).toContain("▄");
    expect(app.screen().some((line) => line.endsWith("━━") || line.endsWith(" ▴"))).toBe(false);
    app.stdin.write("fresh\r");
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});

test("permission arrows and Enter retain ownership instead of entering message mode", async () => {
  const app = await startWithClock(["inspect"], {
    rows: 30,
    env: { LANG: "en" },
    prepare: (root) =>
      Bun.write(join(root, "file.txt"), "one\ntwo\nthree\nfour\nfive").then(() => {}),
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "cat file.txt", description: "Approval ownership" });
    await app.waitFor(() => app.screen().join("\n").includes("Allow this operation?"));
    app.stdin.write("\x1b[1;2A\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({ isError: false });
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).toContain("+2 lines");
    expect(app.screen()).not.toContain("   five");
  } finally {
    await app.cleanup();
  }
});
