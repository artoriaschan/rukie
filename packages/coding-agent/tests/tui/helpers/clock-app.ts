import { testClock } from "./test-clock";
import { start } from "./app";

/** Own the virtual clock for the entire app lifecycle, including renderer timers. */
export async function startWithClock(
  argv: Parameters<typeof start>[0] = [],
  options: Parameters<typeof start>[1] = {},
) {
  testClock.useFakeTimers();
  try {
    const app = await start(argv, {
      ...options,
      advanceTimers: options.advanceTimers ?? ((ms) => testClock.advanceTimersByTime(ms)),
    });
    return {
      ...app,
      async cleanup() {
        try {
          await app.cleanup();
        } finally {
          testClock.useRealTimers();
        }
      },
    };
  } catch (error) {
    testClock.useRealTimers();
    throw error;
  }
}
