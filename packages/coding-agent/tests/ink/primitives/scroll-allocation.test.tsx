import { expect, test } from "bun:test";
import { useMemo, useState } from "react";
import {
  AlternateScreen,
  Box,
  Text,
  ScrollBox,
  renderSync,
  useInput,
  type ScrollBoxHandle,
} from "../../../src/ink/index.ts";
import { createTerminal } from "../../tui/helpers/terminal";
import { testClock } from "../../tui/helpers/test-clock";

test.each([undefined, "100%"] as const)(
  "a stable native viewport restores descendants after allocation 6→1→6 (%s)",
  async (height) => {
    testClock.useFakeTimers();
    const terminal = createTerminal(40, 12, testClock.advanceTimersByTime);
    const viewport: { current: ScrollBoxHandle | null } = { current: null };
    function Screen() {
      const [open, setOpen] = useState(false);
      useInput((input) => {
        if (input === "o") setOpen(true);
        if (input === "c") setOpen(false);
      });
      const body = useMemo(
        () => (
          <Box flexGrow={1} flexShrink={1}>
            <ScrollBox
              ref={(handle) => {
                viewport.current = handle;
              }}
              flexGrow={1}
              height={height}
              stickyScroll
            >
              <Box flexShrink={0} height={6}>
                <Text>{"line0\nline1\nline2\nline3\nline4\nline5"}</Text>
              </Box>
            </ScrollBox>
          </Box>
        ),
        [],
      );
      return (
        <AlternateScreen>
          <Box height={12} flexShrink={0} flexDirection="column">
            {body}
            <Box height={open ? 11 : 6} flexShrink={0}>
              <Text>{open ? "picker" : "dock"}</Text>
            </Box>
          </Box>
        </AlternateScreen>
      );
    }
    const app = renderSync(<Screen />, { ...terminal, patchConsole: false, terminalImages: false });
    try {
      await terminal.waitFor(() => viewport.current?.getViewportHeight() === 6);
      terminal.stdin.write("o");
      await terminal.waitFor(() => viewport.current?.getViewportHeight() === 1);
      terminal.stdin.write("c");
      await terminal.waitFor(() => terminal.screen()[6] === "dock");
      expect(viewport.current?.getViewportHeight()).toBe(6);
      expect(terminal.screen().slice(0, 6)).toEqual([
        "line0",
        "line1",
        "line2",
        "line3",
        "line4",
        "line5",
      ]);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
      testClock.useRealTimers();
    }
  },
);
