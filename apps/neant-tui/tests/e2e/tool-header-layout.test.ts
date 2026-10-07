import { expect, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";

test("full-width tool arrow remains visible beside the timeline through resize", async () => {
  const path = "rail-title-" + "x".repeat(90) + ".txt";
  const app = await startWithClock(["--yolo", "history prompt"], {
    columns: 80,
    rows: 24,
    env: { LANG: "en" },
    prepare: async (root) => {
      await Bun.write(`${root}/${path}`, "rail output\n");
    },
  });
  const header = () => app.screen().findIndex((line) => line.includes("Read rail-title-"));
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(Array.from({ length: 40 }, (_, i) => `history line ${i}`).join("\n"));
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("tool prompt\r");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.tool("read", { path });
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking() && header() >= 0);
    for (const columns of [80, 60]) {
      if (columns !== app.stdout.columns) {
        const before = app.output();
        app.resize(columns, 24);
        await app.waitFor(() => app.output() !== before);
      }
      await app.waitFor(() => app.screen().some((line) => line.slice(-2) === "━━"));
      app.stdin.write(`\x1b[<35;3;${header() + 1}M`);
      await app.waitFor(() => app.screen()[header()]!.includes("▾"));
      expect(app.screen()[header()]!.slice(0, columns - 2)).toContain(" · 0s ▾");
      app.stdin.write(
        `\x1b[<0;${columns - 2};${header() + 1}M\x1b[<0;${columns - 2};${header() + 1}m`,
      );
      await app.waitFor(() => app.screen()[header()]!.includes("▴"));
      expect(app.screen()[header()]!.slice(0, columns - 2)).toContain(" · 0s ▴");
      app.stdin.write(`\x1b[<0;3;${header() + 1}M\x1b[<0;3;${header() + 1}m`);
      await app.waitFor(() => app.screen()[header()]!.includes("▾"));
      app.stdin.write("\x1b[<35;1;24M");
      await app.waitFor(() => !app.screen()[header()]!.includes("▾"));
    }
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test.each(["read", "bash"] as const)(
  "%s card keeps its duration visible for full-width titles before, during and after hover",
  async (name) => {
    const path = "long-title-" + "x".repeat(90) + ".txt";
    const app = await startWithClock(["--yolo", "header layout"], {
      columns: 80,
      rows: 40,
      env: { LANG: "en" },
      prepare: async (root) => {
        await Bun.write(`${root}/${path}`, "output marker\n");
      },
    });
    const title = name === "read" ? "Read long-title-" : "Bash(true";
    const header = () => app.screen().findIndex((line) => line.includes(title));
    const duration = () => {
      const y = header();
      expect(y).toBeGreaterThanOrEqual(0);
      expect(app.screen()[y]).toContain(" · 0s");
      return app.screen()[y]!.indexOf(" · 0s");
    };
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool(
        name,
        name === "read"
          ? { path }
          : { command: "true # " + "x".repeat(220), description: "Long command" },
      );
      await app.waitFor(() => app.calls.length === 2);
      app.calls[1]!.finish();
      await app.waitFor(() => !app.isWorking());
      for (const columns of [80, 40]) {
        if (columns !== app.stdout.columns) {
          const beforeResize = app.output();
          app.resize(columns, 40);
          await app.waitFor(() => app.output() !== beforeResize);
        }
        const before = duration();
        app.stdin.write(`\x1b[<35;${columns};${header() + 1}M`);
        await app.waitFor(() => app.screen()[header()]!.includes("▾"));
        expect(duration()).toBe(before);
        app.stdin.write("\x1b[<35;1;40M");
        await app.waitFor(() => !app.screen()[header()]!.includes("▾"));
        expect(duration()).toBe(before);
      }
      expect(app.stderr()).toBe("");
    } finally {
      await app.cleanup();
    }
  },
);
