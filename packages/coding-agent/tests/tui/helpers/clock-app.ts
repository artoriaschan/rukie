import { onTestFinished } from "bun:test";
import { testClock } from "./test-clock";
import { start } from "./app";

/** Own the virtual clock for the entire app lifecycle, including renderer timers. */
export async function startWithClock(
  argv: Parameters<typeof start>[0] = [],
  options: Parameters<typeof start>[1] = {},
) {
  testClock.useFakeTimers();
  let app: Awaited<ReturnType<typeof start>> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      try {
        await app?.cleanup();
      } finally {
        testClock.useRealTimers();
      }
    })());
  // Restore the clock after owned shutdown, including runner timeouts and failed setup.
  onTestFinished(cleanup);
  try {
    app = await start(argv, {
      ...options,
      advanceTimers: options.advanceTimers ?? ((ms) => testClock.advanceTimersByTime(ms)),
    });
    return { ...app, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
