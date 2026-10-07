import { expect, test } from "bun:test";
import { useEffect, useState } from "react";
import {
  AlternateScreen,
  Text,
  renderSync,
  SmoothRevealProvider,
  useSmoothReveal,
  useSmoothText,
} from "../../../src/ink/index";
import { createTerminal } from "../helpers/terminal";
import { testClock } from "../helpers/test-clock";

test.each(["rows", "text"] as const)(
  "%s updates preserve the shared reveal deadline and disabling cancels it",
  async (kind) => {
    testClock.useFakeTimers();
    const terminal = createTerminal(30, 8);
    let observed = { total: 0, shown: -1, enabled: true };
    let update: (total: number, enabled?: boolean) => void = () => {};
    function Content() {
      const [state, setState] = useState({ total: 10, enabled: true });
      update = (total, enabled = true) => setState({ total, enabled });
      const rows = useSmoothReveal("rows", kind === "rows" ? state.total : 0, state.enabled);
      const text = useSmoothText(
        "text",
        kind === "text" ? "abcdefghijkl".slice(0, state.total) : "",
        true,
        state.enabled,
      );
      const shown = kind === "rows" ? rows : text.length;
      useEffect(() => {
        observed = { ...state, shown };
      }, [state, shown]);
      return <Text>{shown}</Text>;
    }
    const app = renderSync(
      <AlternateScreen>
        <SmoothRevealProvider>
          <Content />
        </SmoothRevealProvider>
      </AlternateScreen>,
      { ...terminal, patchConsole: false, exitOnCtrlC: false },
    );
    try {
      // Effect completion uses real I/O; observing a commit must not advance frontend time.
      await terminal.waitFor(() => observed.total === 10);
      testClock.advanceTimersByTime(16);
      update(12);
      await terminal.waitFor(() => observed.total === 12);
      testClock.advanceTimersByTime(16);
      expect(observed.shown).toBe(0);
      testClock.advanceTimersByTime(1);
      await terminal.waitFor(() => observed.shown === 3);
      testClock.advanceTimersByTime(32);
      expect(observed.shown).toBe(3);
      testClock.advanceTimersByTime(1);
      await terminal.waitFor(() => observed.shown === 6);
      update(12, false);
      await terminal.waitFor(() => !observed.enabled && observed.shown === 12);
      testClock.advanceTimersByTime(100);
      expect(observed.shown).toBe(12);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
      const timers = testClock.getTimerCount();
      testClock.useRealTimers();
      expect(timers).toBe(0);
    }
  },
);
