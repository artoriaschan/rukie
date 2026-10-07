import { expect, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";

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
