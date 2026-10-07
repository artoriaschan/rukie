import { expect, test } from "bun:test";
import { memo } from "react";
import { AlternateScreen, Box, Text, renderSync, useInput } from "../../src/ink/index.ts";
import { createTerminal } from "../tui/helpers/terminal";
import { testClock } from "../tui/helpers/test-clock";

const underlying = [
  "underlying-one",
  "underlying-two",
  "underlying-three",
  "underlying-four",
  "underlying-five",
];

for (const [opaque, paired] of [
  [false, false],
  [false, true],
  [true, false],
  [true, true],
] as const) {
  test(`${opaque ? "opaque" : "transparent"} absolute removal restores its first frame ${paired ? "after another root paints" : "in its own root"}`, async () => {
    testClock.useFakeTimers();
    const a = createTerminal(30, 8);
    const b = createTerminal(30, 8);
    const frames: string[] = [];
    let clicks = 0;
    const Under = memo(() => (
      <Box width={30} height={5} flexShrink={0}>
        <Text>{underlying.join("\n")}</Text>
      </Box>
    ));
    function First({ open }: { open: boolean }) {
      useInput(() => {});
      return (
        <AlternateScreen>
          <Box width={30} height={8} flexDirection="column">
            <Under />
            <Box
              position="absolute"
              top={0}
              left={0}
              width={30}
              height={5}
              onClick={() => clicks++}
            >
              {open && (
                <Box
                  position="absolute"
                  top={1}
                  left={2}
                  width={20}
                  height={2}
                  backgroundColor={opaque ? "blue" : undefined}
                  onClick={(event) => event.stopImmediatePropagation()}
                >
                  <Text>{"OVERLAY-GHOST\nOVERLAY-SECOND"}</Text>
                </Box>
              )}
            </Box>
          </Box>
        </AlternateScreen>
      );
    }
    function Second({ value }: { value: string }) {
      useInput(() => {});
      return (
        <AlternateScreen>
          <Text>{value}</Text>
        </AlternateScreen>
      );
    }
    const appA = renderSync(<First open />, {
      ...a,
      patchConsole: false,
      terminalImages: false,
      onFrame: () => frames.push("A"),
    });
    const appB = renderSync(<Second value="beta" />, {
      ...b,
      patchConsole: false,
      terminalImages: false,
      onFrame: () => frames.push("B"),
    });
    try {
      await a.waitFor(() => a.screen()[1]!.includes("OVERLAY-GHOST"));
      await b.waitFor(() => b.screen()[0] === "beta");
      testClock.advanceTimersByTime(16);
      await Promise.resolve();
      await a.flush();
      await b.flush();
      // Warm the previous frame so a clean memoized subtree can use native blit.
      appA.rerender(<First open />);
      appB.rerender(<Second value="beta" />);
      testClock.advanceTimersByTime(16);
      await Promise.resolve();
      await a.flush();
      await b.flush();
      frames.length = 0;
      // Commits are synchronous; both removals and updates finish before deferred paint.
      if (paired) appB.rerender(<Second value="beta-next" />);
      appA.rerender(<First open={false} />);
      await Promise.resolve();
      await a.flush();
      await b.flush();
      if (paired) expect(frames.slice(0, 2)).toEqual(["B", "A"]);
      // Assert immediately after the first completed paint, before any next frame deadline.
      expect(a.screen().slice(0, 5)).toEqual(underlying);
      const cell = a.terminal.buffer.active.getLine(1)!.getCell(2)!;
      expect(cell.getChars()).toBe("d");
      expect(cell.isBgDefault()).toBe(true);
      a.stdin.write("\x1b[<0;3;2M\x1b[<0;3;2m");
      await a.waitFor(() => clicks === 1);
      expect(clicks).toBe(1);
      expect(b.screen()[0]).toBe(paired ? "beta-next" : "beta");
    } finally {
      appA.unmount();
      appB.unmount();
      await appA.waitUntilExit();
      await appB.waitUntilExit();
      appA.cleanup();
      appB.cleanup();
      a.dispose();
      b.dispose();
      testClock.useRealTimers();
    }
  });
}
