import { PassThrough, Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import xterm from "@xterm/headless";
import unicode11 from "@xterm/addon-unicode11";

/** Interpret the frontend's ANSI output at its terminal IO seam. */
export function createTerminal(columns = 80, rows = 24, advanceTimers?: (ms: number) => void) {
  const terminal = new xterm.Terminal({ cols: columns, rows, allowProposedApi: true });
  // xterm defaults to Unicode 6, where moon emoji occupy one column.
  terminal.loadAddon(new unicode11.Unicode11Addon());
  terminal.unicode.activeVersion = "11";
  const stdin = Object.assign(new PassThrough(), {
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
        terminal.write(chunk, callback);
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
    stdin,
    stdout,
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
      const deadline = performance.now() + timeoutMs;
      // Virtual clocks also replace performance.now; bound I/O yields separately.
      let remainingYields = timeoutMs * 100;
      do {
        await flush();
        if (predicate()) return;
        advanceTimers?.(16);
        if (advanceTimers) await setImmediate();
        else await Bun.sleep(1);
      } while (advanceTimers ? --remainingYields > 0 : performance.now() < deadline);
      throw new Error(`Terminal did not reach expected state:\n${screen().join("\n")}`);
    },
    dispose() {
      stdin.destroy();
      stdout.destroy();
      terminal.dispose();
    },
  };
}
