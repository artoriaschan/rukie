import { jest } from "bun:test";
import { start } from "./app";

/** Own the virtual clock for the entire app lifecycle, including renderer timers. */
export async function startWithClock(
  argv: Parameters<typeof start>[0] = [],
  options: Parameters<typeof start>[1] = {},
) {
  jest.useFakeTimers();
  try {
    const app = await start(argv, {
      ...options,
      advanceTimers: (ms) => jest.advanceTimersByTime(ms),
    });
    return {
      ...app,
      async cleanup() {
        try {
          await app.cleanup();
        } finally {
          jest.useRealTimers();
        }
      },
    };
  } catch (error) {
    jest.useRealTimers();
    throw error;
  }
}
