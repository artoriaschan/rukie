import { renderComponent } from "../helpers/render-component";
import { testClock } from "../helpers/test-clock";
import { expect, test } from "bun:test";
import { Box } from "../../../src/ink/index.ts";
import { ToolCall } from "../../../src/tui/components/tool-call/tool-call";
import { createTerminal } from "../helpers/terminal";

test.each([78, 38])(
  "tool header reserves its arrow within a %s-column container",
  async (width) => {
    testClock.useFakeTimers();
    const terminal = createTerminal(80, 12, (ms) => testClock.advanceTimersByTime(ms));
    const app = renderComponent(
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
      { ...terminal },
    );
    try {
      await terminal.flush();
      const before = terminal.screen()[0]!;
      terminal.stdin.write("\x1b[<35;3;1M");
      await terminal.waitFor(() => terminal.screen()[0]!.includes(" · 0s ▾"));
      expect(terminal.screen()[0]!.slice(0, width)).toContain(" · 0s ▾");
      expect(terminal.screen()[0]!.indexOf(" · 0s")).toBe(before.indexOf(" · 0s"));
      expect(Bun.stringWidth(terminal.screen()[0]!)).toBeLessThanOrEqual(width);
      terminal.stdin.write(`\x1b[<0;${width};1M\x1b[<0;${width};1m`);
      await terminal.waitFor(() => terminal.screen()[0]!.includes(" · 0s ▴"));
      expect(terminal.screen()[0]!).toContain(" · 0s ▴");
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
      testClock.useRealTimers();
    }
  },
);
