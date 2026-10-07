import { createContext, useContext } from "react";
import type { Readable } from "node:stream";
import { listenInput, type InputEvent } from "../input";

export interface TerminalGraphics {
  supported: boolean;
  cellWidth: number | undefined;
  cellHeight: number | undefined;
}

export interface TerminalIO {
  env?: Record<string, string | undefined>;
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
  { stdin, stdout, env = process.env }: TerminalIO,
  redraw: () => void,
  onDispose: () => void,
  dispatchInput: (notify: () => void) => void,
  fullscreen = false,
) {
  const inputs = new Set<(event: InputEvent) => void>();
  const sizes = new Set<() => void>();
  const focusListeners = new Set<() => void>();
  let focused = true;
  const graphicsListeners = new Set<() => void>();
  const graphicsEnabled =
    fullscreen && !env.TMUX && !env.STY && !/^(screen|tmux)/.test(env.TERM ?? "");
  let graphics: TerminalGraphics = {
    supported: false,
    cellWidth: undefined,
    cellHeight: undefined,
  };
  function control(sequence: string) {
    if (!graphicsEnabled) return;
    let next = graphics;
    if (sequence === "\x1b_Gi=2147483647;OK\x1b\\") next = { ...graphics, supported: true };
    // oxlint-disable-next-line no-control-regex -- terminal cell-size report
    const metrics = /^\x1b\[6;(\d+);(\d+)t$/.exec(sequence);
    if (metrics) {
      const height = Number(metrics[1]);
      const width = Number(metrics[2]);
      if (height > 0 && width > 0 && height <= 1000 && width <= 1000)
        next = { ...next, cellWidth: width, cellHeight: height };
    }
    if (next !== graphics) {
      graphics = next;
      dispatchInput(() => graphicsListeners.forEach((listener) => listener()));
      redraw();
    }
  }
  let size = { columns: stdout.columns, rows: stdout.rows };
  let disposed = false;
  const raw = stdin.isRaw ?? false;
  const paused = stdin.readableFlowing !== true;
  const resize = () => {
    size = { columns: stdout.columns, rows: stdout.rows };
    sizes.forEach((listener) => listener());
    if (graphicsEnabled && graphics.supported) stdout.write("\x1b[16t");
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
    graphicsListeners.clear();
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
        (fullscreen ? "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1004l\x1b[?1049l" : ""),
    );
  }
  try {
    stdin.setRawMode?.(true);
    stdout.write(
      (fullscreen ? "\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?1004h" : "") +
        "\x1b[?25l\x1b[?2004h",
    );
    stopInput = listenInput(
      stdin,
      (event) =>
        dispatchInput(() => {
          if (event.type === "focus" && event.focused !== focused) {
            focused = event.focused;
            focusListeners.forEach((listener) => listener());
          }
          for (const listener of inputs) {
            listener(event);
            if (event.handled) break;
          }
        }),
      control,
    );
    if (graphicsEnabled) stdout.write("\x1b_Gi=2147483647,a=q,t=d,f=24,s=1,v=1;AAAA\x1b\\\x1b[16t");
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
    getFocus: () => focused,
    subscribeFocus(listener: () => void) {
      focusListeners.add(listener);
      return () => {
        focusListeners.delete(listener);
      };
    },
    getGraphics: () => graphics,
    subscribeGraphics(listener: () => void) {
      graphicsListeners.add(listener);
      return () => {
        graphicsListeners.delete(listener);
      };
    },
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
