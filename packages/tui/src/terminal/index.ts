import { createContext, useContext } from "react";
import type { Readable } from "node:stream";
import { listenInput, type InputEvent } from "../input";

export interface TerminalIO {
  stdin: Readable & { isTTY?: boolean; isRaw?: boolean; setRawMode?(raw: boolean): unknown };
  stdout: {
    isTTY?: boolean;
    columns: number;
    rows: number;
    write(text: string): unknown;
    on?(event: "resize", listener: () => void): unknown;
    off?(event: "resize", listener: () => void): unknown;
  };
}

const sessions = new Set<() => void>();
function restoreAll() {
  for (const dispose of sessions) dispose();
}
function interrupt() {
  restoreAll();
  if (process.listenerCount("SIGINT") === 0) process.kill(process.pid, "SIGINT");
}
function terminate() {
  restoreAll();
  if (process.listenerCount("SIGTERM") === 0) process.kill(process.pid, "SIGTERM");
}

export function createTerminalSession(
  { stdin, stdout }: TerminalIO,
  redraw: () => void,
  onDispose: () => void,
  dispatchInput: (notify: () => void) => void,
  fullscreen = false,
) {
  const inputs = new Set<(event: InputEvent) => void>();
  const sizes = new Set<() => void>();
  let size = { columns: stdout.columns, rows: stdout.rows };
  let disposed = false;
  const raw = stdin.isRaw ?? false;
  const paused = stdin.readableFlowing !== true;
  const resize = () => {
    size = { columns: stdout.columns, rows: stdout.rows };
    sizes.forEach((listener) => listener());
    redraw();
  };
  let stopInput = () => {};
  function dispose() {
    if (disposed) return;
    disposed = true;
    onDispose();
    stopInput();
    inputs.clear();
    sizes.clear();
    stdout.off?.("resize", resize);
    sessions.delete(dispose);
    if (sessions.size === 0) {
      process.off("exit", restoreAll);
      process.off("uncaughtExceptionMonitor", restoreAll);
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    }
    stdin.setRawMode?.(raw);
    if (paused) stdin.pause();
    stdout.write(
      "\x1b[0m\x1b[?7h\x1b[?25h\x1b[?2004l" +
        (fullscreen ? "\x1b[?1000l\x1b[?1006l\x1b[?1049l" : ""),
    );
  }
  try {
    stdin.setRawMode?.(true);
    stdout.write((fullscreen ? "\x1b[?1049h\x1b[?1000h\x1b[?1006h" : "") + "\x1b[?25l\x1b[?2004h");
    stopInput = listenInput(stdin, (event) =>
      dispatchInput(() => inputs.forEach((listener) => listener(event))),
    );
    stdout.on?.("resize", resize);
    if (sessions.size === 0) {
      process.on("exit", restoreAll);
      process.on("uncaughtExceptionMonitor", restoreAll);
      process.on("SIGINT", interrupt);
      process.on("SIGTERM", terminate);
    }
    sessions.add(dispose);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    dispose,
    redraw,
    getSize: () => size,
    subscribeSize(listener: () => void) {
      sizes.add(listener);
      return () => {
        sizes.delete(listener);
      };
    },
    subscribeInput(listener: (event: InputEvent) => void) {
      inputs.add(listener);
      return () => {
        inputs.delete(listener);
      };
    },
  };
}

export const TerminalContext = createContext<ReturnType<typeof createTerminalSession> | null>(null);

export function useTerminal() {
  const terminal = useContext(TerminalContext);
  if (!terminal) throw new Error("Terminal hooks must be used inside render()");
  return terminal;
}
