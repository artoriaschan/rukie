import chalk from "chalk";
import type { Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { setTimeout as ioTimeout, clearTimeout as ioClearTimeout } from "node:timers";

let previousColorLevel = chalk.level;
let activeTerminals = 0;

/** Both terminal harnesses borrow the runner's color capability as one resource. */
export function acquireTerminalColor() {
  if (activeTerminals++ === 0) previousColorLevel = chalk.level;
  chalk.level = 3;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--activeTerminals === 0) chalk.level = previousColorLevel;
  };
}

/** Xterm parsing is real I/O; only the synchronous write admission borrows its timers. */
export function writeTerminal(
  terminal: { write(data: string | Uint8Array, callback?: () => void): void },
  data: string | Uint8Array,
  callback: () => void,
) {
  const frontendTimeout = globalThis.setTimeout;
  const frontendClearTimeout = globalThis.clearTimeout;
  try {
    // Node timers preserve the callback contract consumed by xterm; this
    // synchronous scope never yields while changing the frontend scheduler.
    globalThis.setTimeout = ioTimeout as typeof setTimeout;
    globalThis.clearTimeout = ioClearTimeout as typeof clearTimeout;
    terminal.write(data, callback);
  } finally {
    globalThis.setTimeout = frontendTimeout;
    globalThis.clearTimeout = frontendClearTimeout;
  }
}

/** Drain the accepted writes without advancing frontend deadlines; parsing failure is bounded. */
export async function flushTerminal(
  stdout: Writable,
  describe: () => string,
  advanceTimers?: (ms: number) => void,
) {
  let parsed = false;
  let error: Error | null | undefined;
  stdout.write("", (failure) => {
    error = failure;
    parsed = true;
  });
  const deadline = process.hrtime.bigint() + 1_000_000_000n;
  while (!parsed) {
    if (process.hrtime.bigint() >= deadline)
      throw new Error(`Terminal parse did not complete: ${describe()}`);
    advanceTimers?.(0);
    await setImmediate();
  }
  if (error) throw error;
}
