import { test, expect } from "bun:test";
import { startWithClock } from "../helpers/clock-app";
test.each([false, true])(
  "Job output and command copy exclude section and group borders (grouped=%s)",
  async (grouped) => {
    const copied: string[] = [];
    const app = await startWithClock(["--yolo", "launch"], {
      columns: 120,
      rows: 40,
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
      const job = {
        command:
          "printf 'first\\nsecond中文🐋\\nthird🐋\\n'; while [ ! -e go ]; do sleep 0.01; done",
        description: "copy fixture",
        run_in_background: true,
      };
      // A real child shell stays open until an explicit file signal; the virtual
      // parent clock cannot drive process timers. No fixed wait synchronizes it.
      app.calls[0]!.tools(
        Array.from({ length: grouped ? 2 : 1 }, () => ({ name: "bash", args: job })),
      );
      await app.waitFor(
        () => app.calls.length === 2 && app.screen().some((r) => r.includes("│ ≡ second")),
      );
      const y = app.screen().findIndex((r) => r.includes("│ ≡ second"));
      const end = Bun.stringWidth(app.screen()[y + 1]!.split("third🐋")[0]! + "third🐋") - 1;
      app.stdin.write(
        `\x1b[<0;1;${y + 1}M\x1b[<32;${end + 1};${y + 2}M\x1b[<0;${end + 1};${y + 2}m`,
      );
      await app.waitFor(() => copied.length === 1);

      expect(copied[0]).not.toMatch(/[│╭╰]/);
      expect(copied[0]).toContain("≡ second中文🐋");
      expect(copied[0]).toContain("third🐋");
      const commandY = app.screen().findIndex((r) => r.includes("│ ❯ printf"));
      const commandEnd = Bun.stringWidth(app.screen()[commandY]!.trimEnd());
      app.stdin.write(
        `\x1b[<0;1;${commandY + 1}M\x1b[<32;${commandEnd};${commandY + 1}M\x1b[<0;${commandEnd};${commandY + 1}m`,
      );
      await app.waitFor(() => copied.length === 2);
      expect(copied[1]).not.toMatch(/[│╭╰]/);
      expect(copied[1]).toContain("❯ printf");
      expect(app.stderr()).toBe("");
    } finally {
      await Bun.write(app.root + "/go", "");
      await app.cleanup();
    }
  },
);
