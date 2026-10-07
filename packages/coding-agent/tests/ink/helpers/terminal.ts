import { setImmediate } from "node:timers/promises";
import { setTimeout as ioTimeout, clearTimeout as ioClearTimeout } from "node:timers";
import { PassThrough, Writable } from "node:stream";
import chalk from "chalk";
let previousColorLevel = chalk.level;
let activeTerminals = 0;
import type { RenderOptions } from "../../../src/ink";
import xterm from "@xterm/headless";
import unicodeGraphemes from "@xterm/addon-unicode-graphemes";

/** Real ANSI interpretation at the renderer's IO boundary, with deterministic dimensions. */
export function createTerminal(columns = 20, rows = 8, advanceTimers?: (ms: number) => void) {
  // All injected xterm roots share the runner but support truecolor. Restore when released.
  if (activeTerminals++ === 0) previousColorLevel = chalk.level;
  chalk.level = 3;
  const terminal = new xterm.Terminal({ cols: columns, rows, allowProposedApi: true });
  terminal.loadAddon(new unicodeGraphemes.UnicodeGraphemesAddon());
  const stdin = Object.assign(new PassThrough(), {
    ref() {
      return this;
    },
    unref() {
      return this;
    },
    isTTY: true,
    isRaw: false,
    setRawMode(raw: boolean) {
      this.isRaw = raw;
      return this;
    },
  });
  let bytesWritten = 0;
  let output = "";
  const writes: { text: string; time: number }[] = [];
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        bytesWritten += chunk.length;
        output += chunk.toString();
        if (chunk.length) writes.push({ text: chunk.toString(), time: performance.now() });
        // xterm's parse queue is real I/O; frontend clocks must not strand its completion.
        const frontendTimeout = globalThis.setTimeout;
        const frontendClearTimeout = globalThis.clearTimeout;
        try {
          globalThis.setTimeout = ioTimeout as typeof setTimeout;
          globalThis.clearTimeout = ioClearTimeout as typeof clearTimeout;
          terminal.write(chunk, callback);
        } finally {
          globalThis.setTimeout = frontendTimeout;
          globalThis.clearTimeout = frontendClearTimeout;
        }
      },
    }),
    { isTTY: true, columns, rows },
  );
  async function flush() {
    await Promise.resolve();
    advanceTimers?.(0);
    await setImmediate();
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
          `Terminal parse did not complete: bytes=${bytesWritten}; cursor=${terminal.buffer.active.cursorX},${terminal.buffer.active.cursorY}`,
        );
      advanceTimers?.(0);
      await setImmediate();
    }
    if (error) throw error;
  }
  return {
    // Injected Node stream invariants: writable TTY dimensions and readable raw mode.
    stdin: stdin as typeof stdin & NodeJS.ReadStream,
    stdout: stdout as typeof stdout & NodeJS.WriteStream,
    stderr: stdout as NodeJS.WriteStream,
    patchConsole: false,
    exitOnCtrlC: false,
    terminalImages: false as RenderOptions["terminalImages"],
    terminal,
    bytesWritten: () => bytesWritten,
    output: () => output,
    writes,
    flush,
    async waitFor(predicate: () => boolean) {
      const deadline = process.hrtime.bigint() + 1_000_000_000n;
      do {
        await flush();
        if (predicate()) return;
        if (advanceTimers) {
          advanceTimers(16);
          await setImmediate();
        } else await setImmediate();
      } while (process.hrtime.bigint() < deadline);
      throw new Error(
        `Terminal did not reach expected state: cursor=${terminal.buffer.active.cursorX},${terminal.buffer.active.cursorY}; screen=${Array.from({ length: rows }, (_, y) => terminal.buffer.active.getLine(y)?.translateToString(true)).join("|")}`,
      );
    },
    screen() {
      const buffer = terminal.buffer.active;
      return Array.from({ length: rows }, (_, y) =>
        buffer
          .getLine(buffer.viewportY + y)!
          .translateToString(true, 0, terminal.cols)
          .trimEnd(),
      );
    },
    resize(columns: number, newRows: number) {
      rows = newRows;
      terminal.resize(columns, rows);
      stdout.columns = columns;
      stdout.rows = rows;
      stdout.emit("resize");
    },
    cursor() {
      return { x: terminal.buffer.active.cursorX, y: terminal.buffer.active.cursorY };
    },
    scrollback() {
      const buffer = terminal.buffer.active;
      return Array.from({ length: buffer.baseY }, (_, y) =>
        buffer.getLine(y)!.translateToString(true).trimEnd(),
      );
    },
    dispose() {
      if (--activeTerminals === 0) chalk.level = previousColorLevel;
      stdin.destroy();
      stdout.destroy();
      terminal.dispose();
    },
  };
}
