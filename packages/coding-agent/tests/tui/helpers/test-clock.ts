import FakeTimers from "@sinonjs/fake-timers";
let clock: ReturnType<typeof FakeTimers.install> | undefined;
/** One test owns global frontend time. Real I/O and setImmediate remain completion signals. */
export const testClock = {
  useFakeTimers() {
    if (clock) throw new Error("A virtual clock is already active");
    clock = FakeTimers.install({
      now: Date.now(),
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
    });
  },
  useRealTimers() {
    clock?.uninstall();
    clock = undefined;
  },
  advanceTimersByTime(ms: number) {
    if (!clock) throw new Error("No virtual clock is active");
    clock.tick(ms);
  },
  setSystemTime(now: number) {
    if (!clock) throw new Error("No virtual clock is active");
    clock.setSystemTime(now);
  },
  getTimerCount() {
    return clock?.countTimers() ?? 0;
  },
};
