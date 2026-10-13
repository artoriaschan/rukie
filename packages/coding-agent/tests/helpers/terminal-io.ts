import chalk from "chalk";
import type { ITerminalInitOnlyOptions, ITerminalOptions, Terminal } from "@xterm/headless";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { setTimeout as ioTimeout, clearTimeout as ioClearTimeout } from "node:timers";
import { Script } from "node:vm";

// Capture native I/O before a frontend clock replaces globals or Node's timer exports.
const nativeTimeout = ioTimeout;
const nativeClearTimeout = ioClearTimeout;
const nativePerformance = performance;
const nativeQueueMicrotask = queueMicrotask;
const require = createRequire(import.meta.url);
const xtermPath = require.resolve("@xterm/headless");
const xtermScript = new Script(readFileSync(xtermPath, "utf8"), { filename: xtermPath });

/** The installed ANSI parser owns real I/O, including writes resumed after a parsing slice. */
export function createIoTerminal(options: ITerminalOptions & ITerminalInitOnlyOptions): Terminal {
  const timers = new Set<ReturnType<typeof nativeTimeout>>();
  const exports: Record<string, unknown> = {};
  const cancelTimer = (timer: ReturnType<typeof nativeTimeout>) => {
    timers.delete(timer);
    nativeClearTimeout(timer);
  };
  xtermScript.runInNewContext({
    exports,
    console,
    process: { title: process.title },
    // Public parser handlers may return promises created in the caller's realm.
    Promise,
    Array,
    Error,
    performance: { now: () => nativePerformance.now() },
    queueMicrotask: nativeQueueMicrotask,
    setTimeout(callback: () => void, delay?: number) {
      const timer = nativeTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
      return timer;
    },
    clearTimeout: cancelTimer,
  });
  if (typeof exports.Terminal !== "function") throw new Error("Xterm did not export Terminal");
  // This unchanged installed UMD is the implementation of the pinned module's declarations.
  const Constructor = exports.Terminal as typeof import("@xterm/headless").Terminal;
  const terminal = new Constructor(options);
  const dispose = terminal.dispose.bind(terminal);
  let disposed = false;
  terminal.dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      dispose();
    } finally {
      for (const timer of timers) cancelTimer(timer);
    }
  };
  return terminal;
}

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

/** Drain the accepted writes without advancing frontend deadlines; parsing failure is bounded. */
export async function flushTerminal(stdout: Writable, describe: () => string) {
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
    await setImmediate();
  }
  if (error) throw error;
}
