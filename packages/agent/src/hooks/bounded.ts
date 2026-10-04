import { createUserVisibleError } from "@neant/shared";

/** Race cancellation even when a connected MCP transport cannot abort its request. */
export async function executeBounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeout: number,
): Promise<T> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const deadline = setTimeout(
    () =>
      controller.abort(
        createUserVisibleError(`Hook timed out after ${timeout}s`, {
          code: "hook-timeout",
          params: { timeout: String(timeout) },
        }),
      ),
    timeout * 1000,
  );
  const combined = AbortSignal.any([signal, controller.signal]);
  let abort: () => void = () => {};
  try {
    return await Promise.race([
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(combined.reason);
        combined.addEventListener("abort", abort, { once: true });
        if (combined.aborted) abort();
      }),
      Promise.resolve().then(() => {
        combined.throwIfAborted();
        return work(combined);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
    combined.removeEventListener("abort", abort);
  }
}
