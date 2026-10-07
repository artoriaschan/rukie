import { setImmediate } from "node:timers/promises";
import { acquireTerminalColor, writeTerminal, flushTerminal } from "../../helpers/terminal-io";
import { PassThrough, Writable } from "node:stream";
import type { RenderOptions } from "../../../src/ink";
import xterm from "@xterm/headless";
import unicodeGraphemes from "@xterm/addon-unicode-graphemes";

/** Real ANSI interpretation at the renderer's IO boundary, with deterministic dimensions. */
export function createTerminal(columns = 20, rows = 8, advanceTimers?: (ms: number) => void) {
  // All injected xterm roots share the runner but support truecolor. Restore when released.
  const releaseColor = acquireTerminalColor();
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
        writeTerminal(terminal, chunk, callback);
      },
    }),
    { isTTY: true, columns, rows },
  );
  async function flush() {
    await Promise.resolve();
    advanceTimers?.(0);
    await setImmediate();
    await flushTerminal(
      stdout,
      () =>
        `bytes=${bytesWritten}; cursor=${terminal.buffer.active.cursorX},${terminal.buffer.active.cursorY}`,
      advanceTimers,
    );
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
      releaseColor();
      stdin.destroy();
      stdout.destroy();
      terminal.dispose();
    },
  };
}
