import { expect, spyOn } from "bun:test";
import { testClock } from "./test-clock";

/** Observe an admitted frontend timeout while preserving real I/O completion.
 * A business deadline can precede passive-effect registration: match its
 * absolute expiry rather than assuming the registered delay is its lifetime.
 */
export function observeTimeoutDeadline(delayMs: number, business?: { expiresAt: number }) {
  let expiresAt = 0;
  let expired = false;
  const nativeTimeout = globalThis.setTimeout;
  const trackedTimeout = Object.assign((...parameters: Parameters<typeof setTimeout>) => {
    const [handler, delay, ...args] = parameters;
    const expiry = Date.now() + (delay ?? 0);
    if (business ? expiry !== business.expiresAt : delay !== delayMs)
      return nativeTimeout(handler, delay, ...args);
    expiresAt = expiry;
    return nativeTimeout(() => {
      expired = true;
      handler(...args);
    }, delay);
  }, nativeTimeout);
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(trackedTimeout);
  return {
    beforeExpiry() {
      expect(expiresAt).toBeGreaterThan(Date.now());
      testClock.advanceTimersByTime(expiresAt - Date.now() - 1);
      expect(expired).toBe(false);
    },
    expire() {
      testClock.advanceTimersByTime(1);
      expect(expired).toBe(true);
    },
    restore: () => timer.mockRestore(),
  };
}
