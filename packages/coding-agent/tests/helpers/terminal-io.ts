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

const ioNow = () => process.hrtime.bigint();
const ageMs = (now: bigint, at: bigint) => Number(now - at) / 1_000_000;
type WriteObservation = { at: bigint; bytes: number; hasCallback: boolean; callbackAt?: bigint };
type IoObservation = {
  timers: Map<ReturnType<typeof nativeTimeout>, { at: bigint; delay?: number }>;
  scheduled: number;
  fired: number;
  cleared: number;
  longestTimerMs: number;
  writes: number;
  bytes: number;
  callbackWrites: number;
  callbacks: number;
  pendingWrites: Map<number, WriteObservation>;
  firstEmpty?: WriteObservation;
  firstNonempty?: WriteObservation;
};
const observations = new WeakMap<Terminal, IoObservation>();

function describeIo(terminal: Terminal) {
  const state = observations.get(terminal);
  if (!state) return { disposed: true };
  const now = ioNow();
  const write = (entry?: WriteObservation) =>
    entry && {
      bytes: entry.bytes,
      hasCallback: entry.hasCallback,
      ageMs: ageMs(now, entry.at),
      callbackMs: entry.callbackAt === undefined ? null : ageMs(entry.callbackAt, entry.at),
    };
  return {
    timers: {
      scheduled: state.scheduled,
      fired: state.fired,
      cleared: state.cleared,
      longestTimerMs: state.longestTimerMs,
      pendingCount: state.timers.size,
      pending: [...state.timers.values()].slice(0, 8).map((timer) => ({
        ageMs: ageMs(now, timer.at),
        delayMs: timer.delay,
      })),
    },
    writes: {
      accepted: state.writes,
      bytes: state.bytes,
      callbackBearing: state.callbackWrites,
      callbacks: state.callbacks,
      pendingCount: state.callbackWrites - state.callbacks,
      pending: [...state.pendingWrites.values()].map(write),
      firstEmpty: write(state.firstEmpty),
      firstNonempty: write(state.firstNonempty),
    },
  };
}

/** The installed ANSI parser owns real I/O, including writes resumed after a parsing slice. */
export function createIoTerminal(options: ITerminalOptions & ITerminalInitOnlyOptions): Terminal {
  const state: IoObservation = {
    timers: new Map(),
    scheduled: 0,
    fired: 0,
    cleared: 0,
    longestTimerMs: 0,
    writes: 0,
    bytes: 0,
    callbackWrites: 0,
    callbacks: 0,
    pendingWrites: new Map(),
  };
  const timers = state.timers;
  const exports: Record<string, unknown> = {};
  const cancelTimer = (timer: ReturnType<typeof nativeTimeout>) => {
    if (timers.delete(timer)) state.cleared++;
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
      const at = ioNow();
      state.scheduled++;
      const timer = nativeTimeout(() => {
        timers.delete(timer);
        state.fired++;
        state.longestTimerMs = Math.max(state.longestTimerMs, ageMs(ioNow(), at));
        callback();
      }, delay);
      timers.set(timer, { at, delay });
      return timer;
    },
    clearTimeout: cancelTimer,
  });
  if (typeof exports.Terminal !== "function") throw new Error("Xterm did not export Terminal");
  // This unchanged installed UMD is the implementation of the pinned module's declarations.
  const Constructor = exports.Terminal as typeof import("@xterm/headless").Terminal;
  const terminal = new Constructor(options);
  observations.set(terminal, state);
  const write = terminal.write;
  terminal.write = function (data, callback) {
    const entry: WriteObservation = {
      at: ioNow(),
      bytes: Buffer.byteLength(data),
      hasCallback: callback !== undefined,
    };
    const id = ++state.writes;
    state.bytes += entry.bytes;
    if (entry.bytes === 0) state.firstEmpty ??= entry;
    else state.firstNonempty ??= entry;
    // Observe only callbacks the caller already supplied; do not create parser work.
    if (!callback) return write.call(this, data);
    state.callbackWrites++;
    if (state.pendingWrites.size < 8) state.pendingWrites.set(id, entry);
    return write.call(this, data, () => {
      state.callbacks++;
      entry.callbackAt = ioNow();
      state.pendingWrites.delete(id);
      callback();
    });
  };
  const dispose = terminal.dispose.bind(terminal);
  let disposed = false;
  terminal.dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      dispose();
    } finally {
      for (const timer of timers.keys()) cancelTimer(timer);
      state.pendingWrites.clear();
      state.firstEmpty = undefined;
      state.firstNonempty = undefined;
      observations.delete(terminal);
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
export async function flushTerminal(stdout: Writable, describe: () => string, terminal: Terminal) {
  let parsed = false;
  let error: Error | null | undefined;
  stdout.write("", (failure) => {
    error = failure;
    parsed = true;
  });
  const deadline = process.hrtime.bigint() + 1_000_000_000n;
  while (!parsed) {
    if (process.hrtime.bigint() >= deadline)
      throw new Error(
        `Terminal parse did not complete: ${describe()}; io=${JSON.stringify({
          writableLength: stdout.writableLength,
          ...describeIo(terminal),
        })}`,
      );
    await setImmediate();
  }
  if (error) throw error;
}
