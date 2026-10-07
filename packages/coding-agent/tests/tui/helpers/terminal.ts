import chalk from "chalk";
let previousColorLevel = chalk.level;
let activeTerminals = 0;
import { PassThrough, Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { setTimeout as ioTimeout, clearTimeout as ioClearTimeout } from "node:timers";
import xterm from "@xterm/headless";
import unicodeGraphemes from "@xterm/addon-unicode-graphemes";

/** Interpret the frontend's ANSI output at its terminal IO seam. */
export function createTerminal(columns = 80, rows = 24, advanceTimers?: (ms: number) => void) {
  if (activeTerminals++ === 0) previousColorLevel = chalk.level;
  chalk.level = 3;
  const terminal = new xterm.Terminal({ cols: columns, rows, allowProposedApi: true });
  // Interpret complete Unicode graphemes, including ZWJ owners and their wide tail cells.
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
  let output = "";
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        // xterm parsing is an I/O completion queue, not a frontend deadline. Keep its zero-delay
        // scheduler real so a timer created inside a virtual tick cannot strand callback flushes.
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
    { columns, rows, isTTY: true },
  );
  const flush = async () => {
    let parsed = false;
    const flushed = new Promise<void>((resolve) =>
      stdout.write("", () => {
        parsed = true;
        resolve();
      }),
    );
    // xterm schedules parsing with a zero-delay timer, including under a virtual clock.
    if (advanceTimers) {
      while (!parsed) {
        advanceTimers(0);
        await setImmediate();
      }
    }
    return flushed;
  };
  function screen() {
    const buffer = terminal.buffer.active;
    return Array.from({ length: rows }, (_, y) =>
      buffer
        .getLine(buffer.viewportY + y)!
        .translateToString(true, 0, terminal.cols)
        .trimEnd(),
    );
  }
  return {
    term: "xterm-256color",
    stdin: stdin as typeof stdin & NodeJS.ReadStream,
    stdout: stdout as typeof stdout & NodeJS.WriteStream,
    terminal,
    flush,
    screen,
    isWorking: () => screen().some((line) => /^[🌑🌒🌓🌔🌕🌖🌗🌘] /u.test(line)),
    output: () => output,
    resize(columns: number, newRows: number) {
      rows = newRows;
      terminal.resize(columns, rows);
      stdout.columns = columns;
      stdout.rows = rows;
      stdout.emit("resize");
    },
    allLines() {
      const buffer = terminal.buffer.active;
      return Array.from({ length: buffer.baseY }, (_, y) =>
        buffer.getLine(y)!.translateToString(true).trimEnd(),
      ).concat(screen());
    },
    async waitFor(predicate: () => boolean, timeoutMs = 2000) {
      const deadline = process.hrtime.bigint() + BigInt(timeoutMs) * 1_000_000n;
      do {
        await flush();
        if (predicate()) return;
        advanceTimers?.(16);
        await setImmediate();
      } while (process.hrtime.bigint() < deadline);
      throw new Error(`Terminal did not reach expected state:\n${screen().join("\n")}`);
    },
    dispose() {
      if (--activeTerminals === 0) chalk.level = previousColorLevel;
      stdin.destroy();
      stdout.destroy();
      terminal.dispose();
    },
  };
}
