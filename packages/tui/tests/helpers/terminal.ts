import { setImmediate } from "node:timers/promises";
import { PassThrough, Writable } from "node:stream";
import xterm from "@xterm/headless";

/** Real ANSI interpretation at the renderer's IO boundary, with deterministic dimensions. */
export function createTerminal(columns = 20, rows = 8, advanceTimers?: (ms: number) => void) {
  const terminal = new xterm.Terminal({ cols: columns, rows, allowProposedApi: true });
  const stdin = Object.assign(new PassThrough(), {
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
        terminal.write(chunk, callback);
      },
    }),
    { columns, rows },
  );
  async function flush() {
    let parsed = false;
    const flushed = new Promise<void>((resolve) =>
      stdout.write("", () => {
        parsed = true;
        resolve();
      }),
    );
    if (advanceTimers)
      while (!parsed) {
        advanceTimers(0);
        await setImmediate();
      }
    await flushed;
  }
  return {
    stdin,
    stdout,
    terminal,
    bytesWritten: () => bytesWritten,
    output: () => output,
    writes,
    flush,
    async waitFor(predicate: () => boolean) {
      const deadline = performance.now() + 1000;
      let remainingYields = 10000;
      do {
        await flush();
        if (predicate()) return;
        if (advanceTimers) {
          advanceTimers(16);
          await setImmediate();
        } else await Bun.sleep(1);
      } while (advanceTimers ? --remainingYields > 0 : performance.now() < deadline);
      throw new Error("Terminal did not reach the expected state within 1 second");
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
      stdin.destroy();
      stdout.destroy();
      terminal.dispose();
    },
  };
}
