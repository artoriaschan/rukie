import { expect, test } from "bun:test";
import { setImmediate } from "node:timers/promises";
import type { GoalView } from "@rukie/agent";
import { GoalTodoPanel } from "../../../src/tui/components/goal-todo-panel";
import { renderComponent } from "../helpers/render-component";
import { createTerminal } from "../helpers/terminal";
import { testClock } from "../helpers/test-clock";

test("Goal panel ticks at the one-second boundary, formats minutes and freezes completion", async () => {
  testClock.useFakeTimers();
  // I/O completion never advances time; only the explicit ticks below do.
  const terminal = createTerminal(80, 12);
  const goal: GoalView = {
    id: "first",
    objective: "migrate",
    phase: "active",
    roundsStarted: 1,
    maxRounds: 256,
    armed: true,
  };
  const panel = (value: GoalView) => (
    <GoalTodoPanel goal={value} todos={[]} working={false} collapsed={false} onToggle={() => {}} />
  );
  const app = renderComponent(panel(goal), { ...terminal, patchConsole: false });
  const screen = () => terminal.screen().join("\n");
  const tick = async (ms: number) => {
    testClock.advanceTimersByTime(ms);
    await terminal.flush();
  };
  try {
    await terminal.waitFor(() => screen().includes("active · 1/256 · 0s"));
    expect(screen()).toContain("active · 1/256 · 0s");
    await tick(999);
    expect(screen()).toContain("active · 1/256 · 0s");
    await tick(1);
    await terminal.waitFor(() => screen().includes("active · 1/256 · 1s"));
    expect(screen()).toContain("active · 1/256 · 1s");
    await tick(71_000);
    await terminal.waitFor(() => screen().includes("active · 1/256 · 1m12s"));
    expect(screen()).toContain("active · 1/256 · 1m12s");
    app.rerender(panel({ ...goal, phase: "complete", armed: false }));
    await setImmediate();
    testClock.advanceTimersByTime(16);
    await terminal.waitFor(() => screen().includes("complete · 1/256 · 1m12s"));
    await tick(72_000);
    expect(screen()).toContain("complete · 1/256 · 1m12s");
    app.rerender(panel({ ...goal, id: "second", objective: "next" }));
    await setImmediate();
    testClock.advanceTimersByTime(16);
    await terminal.waitFor(() => screen().includes("active · 1/256 · 0s"));
    expect(screen()).toContain("active · 1/256 · 0s");
    await tick(1000);
    await terminal.waitFor(() => screen().includes("active · 1/256 · 1s"));
    expect(screen()).toContain("active · 1/256 · 1s");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
    const timers = testClock.getTimerCount();
    testClock.useRealTimers();
    expect(timers).toBe(0);
  }
});
