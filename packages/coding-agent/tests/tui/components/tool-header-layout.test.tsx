import { expect, jest, test } from "bun:test";
import { Box, render } from "../../../src/ink/index.ts";
import { ToolCall } from "../../../src/tui/components/tool-call/tool-call";
import { createTerminal } from "../helpers/terminal";

test.each([78, 38])(
  "tool header reserves its arrow within a %s-column container",
  async (width) => {
    jest.useFakeTimers();
    const terminal = createTerminal(80, 12, (ms) => jest.advanceTimersByTime(ms));
    const app = render(
      <Box width={width} flexDirection="column">
        <ToolCall
          name="read"
          args={{ path: "界".repeat(80) }}
          summary="Read"
          status="success"
          startedAt={0}
          endedAt={0}
        />
      </Box>,
      { ...terminal, fullscreen: true },
    );
    try {
      await terminal.flush();
      const before = terminal.screen()[0]!;
      terminal.stdin.write("\x1b[<35;3;1M");
      jest.advanceTimersByTime(16);
      await terminal.flush();
      expect(terminal.screen()[0]!.slice(0, width)).toContain(" · 0s ▾");
      expect(terminal.screen()[0]!.indexOf(" · 0s")).toBe(before.indexOf(" · 0s"));
      expect(Bun.stringWidth(terminal.screen()[0]!)).toBeLessThanOrEqual(width);
      terminal.stdin.write(`\x1b[<0;${width};1M\x1b[<0;${width};1m`);
      jest.advanceTimersByTime(16);
      await terminal.flush();
      expect(terminal.screen()[0]!).toContain(" · 0s ▴");
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
      jest.useRealTimers();
    }
  },
);
