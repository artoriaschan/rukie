import { expect, jest, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";

function hover(app: Awaited<ReturnType<typeof startWithClock>>, title: string) {
  const row = app.screen().findIndex((line) => line.includes(title));
  expect(row).toBeGreaterThanOrEqual(0);
  app.stdin.write(`\x1b[<35;6;${row + 1}M`);
}

test("folded command shows full title and wall-clock metadata only after 600ms hover", async () => {
  const app = await startWithClock(["--yolo", "run"], { env: { LANG: "en_US.UTF-8" }, rows: 40 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "true\n# hidden-script-title", description: "Run" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).toContain("+1 lines");
    expect(app.screen().join("\n")).not.toContain("hidden-script-title");
    hover(app, "Bash(true");
    jest.advanceTimersByTime(599);
    await app.flush();
    expect(app.screen().join("\n")).not.toContain("Started:");
    jest.advanceTimersByTime(1);
    await app.waitFor(() => app.screen().some((line) => line.includes("Started:")));
    const text = app.screen().join("\n");
    expect(text).toContain("hidden-script-title");
    expect(text).toContain("Finished:");
    expect(text).toContain("Exit code: 0");
    app.stdin.write("\x1b[<35;79;39M");
    await app.waitFor(() => !app.screen().some((line) => line.includes("Started:")));
  } finally {
    await app.cleanup();
  }
});

test("fully visible titles stay tooltip-silent, and leaving cancels a pending tooltip", async () => {
  const app = await startWithClock(["--yolo", "run"], { env: { LANG: "en_US.UTF-8" }, rows: 40 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "true", description: "Run" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.tool("bash", { command: "true\n# pending-title", description: "Run" });
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    hover(app, "Bash(true)");
    jest.advanceTimersByTime(700);
    await app.flush();
    expect(app.screen().join("\n")).not.toContain("Started:");
    hover(app, "+1 lines");
    jest.advanceTimersByTime(300);
    app.stdin.write("\x1b[<35;79;39M");
    jest.advanceTimersByTime(400);
    await app.flush();
    expect(app.screen().join("\n")).not.toContain("pending-title");
    expect(app.screen().join("\n")).not.toContain("Started:");
  } finally {
    await app.cleanup();
  }
});

test("foldTerminalCommand false keeps all source lines visible", async () => {
  const { join } = await import("node:path");
  const app = await startWithClock(["--yolo", "run"], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(
        join(root, ".neant", "settings.json"),
        JSON.stringify({ foldTerminalCommand: false }),
      );
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "true\n# visible-script-title", description: "Run" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).toContain("visible-script-title");
    expect(app.screen().join("\n")).not.toContain("+1 lines");
    hover(app, "Bash(true");
    jest.advanceTimersByTime(700);
    await app.flush();
    expect(app.screen().join("\n")).not.toContain("Started:");
  } finally {
    await app.cleanup();
  }
});

test("width-hidden Unicode title tooltip fits a small viewport and clears on focus loss or resize", async () => {
  const app = await startWithClock(["--yolo", "run"], {
    columns: 40,
    rows: 12,
    env: { LANG: "en_US.UTF-8" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("unknown_tool", { label: "界🧑‍💻".repeat(15) });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    hover(app, "Unknown_tool(");
    jest.advanceTimersByTime(600);
    await app.waitFor(() => app.screen().some((line) => line.includes("Started:")));
    expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
    expect(app.screen().length).toBe(12);
    app.stdin.write("\x1b[O");
    await app.waitFor(() => !app.screen().some((line) => line.includes("Started:")));
    app.stdin.write("\x1b[I");
    app.stdin.write("\x1b[<35;39;11M");
    hover(app, "Unknown_tool(");
    jest.advanceTimersByTime(600);
    await app.waitFor(() => app.screen().some((line) => line.includes("Started:")));
    app.resize(2, 2);
    jest.advanceTimersByTime(16);
    await app.flush();
    expect(app.screen().join("\n")).not.toContain("╭");
    app.resize(80, 40);
    await app.waitFor(() => app.screen().some((line) => line.includes("Unknown_tool(")));
    expect(app.screen().join("\n")).not.toContain("Started:");
  } finally {
    await app.cleanup();
  }
});

test("generic arguments beyond 480 characters expose the full JSON only in a tooltip", async () => {
  const app = await startWithClock(["--yolo", "run"], {
    columns: 520,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("unknown_tool", { label: "x".repeat(490) + "JSON_END_MARKER" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    const headerRow = app.screen().findIndex((line) => line.includes("Unknown_tool("));
    const header = app.screen()[headerRow]!;
    expect(app.terminal.buffer.active.getLine(headerRow)!.getCell(2)!.getFgColor()).toBe(0x7da1de);
    expect(header).toContain("…");
    expect(header).not.toContain("JSON_END_MARKER");
    hover(app, "Unknown_tool(");
    jest.advanceTimersByTime(600);
    await app.waitFor(() => app.screen().some((line) => line.includes("JSON_END_MARKER")));
    const screen = app.screen();
    const firstBorder = screen.findIndex((line) => line.includes("╭"));
    const end = screen.findIndex((line, index) => index > firstBorder && line.includes("╰"));
    const tooltip = screen.slice(firstBorder, end + 1).join("\n");
    expect(tooltip).toContain("Started:");
    expect(tooltip).toContain("Finished:");
    expect(tooltip).not.toContain(" · ");
    app.stdin.write("a");
    await app.waitFor(() => !app.screen().some((line) => line.includes("Started:")));
  } finally {
    await app.cleanup();
  }
});

test("failed command tooltip carries wall-clock times, exit code and kill signal", async () => {
  const app = await startWithClock(["--yolo", "run"], { rows: 40, env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "kill -TERM $$\n# killed-command", description: "Run" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    hover(app, "Bash(kill");
    jest.advanceTimersByTime(600);
    await app.waitFor(() => app.screen().some((line) => line.includes("Started:")));
    const screen = app.screen();
    const firstBorder = screen.findIndex((line) => line.includes("╭"));
    const end = screen.findIndex((line, index) => index > firstBorder && line.includes("╰"));
    const tooltip = screen.slice(firstBorder, end + 1).join("\n");
    expect(tooltip).toMatch(/Started: \d{2}:\d{2}:\d{2}/);
    expect(tooltip).toMatch(/Finished: \d{2}:\d{2}:\d{2}/);
    expect(tooltip).toContain("Exit code: 143");
    expect(tooltip).toContain("Signal: SIGTERM");
    expect(tooltip).not.toContain(" · ");
  } finally {
    await app.cleanup();
  }
});

test("expanding a command reveals its full script and wrapped titles do not claim hidden content", async () => {
  const app = await startWithClock(["--yolo", "run"], {
    columns: 40,
    rows: 40,
    env: { LANG: "en" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command: `true # ${"界".repeat(25)}END\n# script-tail`,
      description: "Wrapped script",
    });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).toContain("END");
    expect(app.screen().join("\n")).not.toContain("script-tail");
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("script-tail"));
    expect(app.screen().join("\n")).not.toContain("+1 lines");
    hover(app, "Bash(true");
    jest.advanceTimersByTime(600);
    await app.flush();
    expect(app.screen().join("\n")).not.toContain("Started:");
  } finally {
    await app.cleanup();
  }
});

test("collapsed terminal titles disclose clipped UTF-16 characters and expansion preserves the emoji", async () => {
  const app = await startWithClock(["--yolo", "run"], { rows: 80, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", {
      command: `true # ${"x".repeat(992)}😀TAIL`,
      description: "Long title",
    });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).toContain("+6 characters");
    expect(app.screen().join("\n")).not.toContain("TAIL");
    expect(app.screen().join("\n")).not.toContain("�");
    app.stdin.write("\x0f");
    await app.waitFor(() => app.screen().join("\n").includes("😀TAIL"));
    expect(app.screen().join("\n")).not.toContain("+6 characters");
  } finally {
    await app.cleanup();
  }
});
