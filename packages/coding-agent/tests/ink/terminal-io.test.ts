import { expect, onTestFinished, test } from "bun:test";
import { createTerminal as createInkTerminal } from "./helpers/terminal";
import { createTerminal as createTuiTerminal } from "../tui/helpers/terminal";
import { testClock } from "../tui/helpers/test-clock";

const parserPerformance = performance;

for (const [name, createTerminal] of [
  ["Ink", createInkTerminal],
  ["TUI", createTuiTerminal],
] as const) {
  test(`${name} parses sliced ANSI writes without advancing frontend deadlines`, async () => {
    testClock.useFakeTimers();
    let terminal: ReturnType<typeof createTerminal> | undefined;
    const originalNow = performance.now;
    const originalParserNow = parserPerformance.now;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      terminal?.dispose();
      performance.now = originalNow;
      parserPerformance.now = originalParserNow;
      testClock.useRealTimers();
    };
    onTestFinished(cleanup);
    try {
      terminal = createTerminal(40, 4, testClock.advanceTimersByTime);
      const frozenTime = Date.now();
      let frontendDeadlineReached = false;
      setTimeout(() => {
        frontendDeadlineReached = true;
      }, 1);

      // Xterm yields after a 12 ms parsing slice. Its native performance object
      // and the frontend clock are separate; force slices in both implementations
      // while leaving frontend Date/timer deadlines frozen.
      expect(parserPerformance).not.toBe(performance);
      let parseBudget = 1;
      let parserClockReads = 0;
      const stepParserClock = () => {
        parserClockReads++;
        return (parseBudget += 13);
      };
      performance.now = stepParserClock;
      parserPerformance.now = stepParserClock;
      let parsedWrites = 0;
      terminal.stdout.write("\x1b[31mplain \x1b[0m", () => parsedWrites++);
      terminal.stdout.write("漢👩‍💻 done", () => parsedWrites++);
      await terminal.flush();

      expect(terminal.screen()[0]).toBe("plain 漢👩‍💻 done");
      const line = terminal.terminal.buffer.active.getLine(0);
      expect(line?.getCell(0)?.getFgColor()).toBe(1);
      expect(line?.getCell(6)?.getWidth()).toBe(2);
      expect(line?.getCell(7)?.getWidth()).toBe(0);
      expect(line?.getCell(8)?.getChars()).toBe("👩‍💻");
      expect(line?.getCell(8)?.getWidth()).toBe(2);
      expect(line?.getCell(9)?.getWidth()).toBe(0);
      expect(parsedWrites).toBe(2);
      expect(parserClockReads).toBeGreaterThanOrEqual(4);
      expect(Date.now()).toBe(frozenTime);
      expect(frontendDeadlineReached).toBe(false);
      expect(testClock.getTimerCount()).toBe(1);
    } finally {
      cleanup();
    }
  });
}
