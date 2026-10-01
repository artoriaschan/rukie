import { PassThrough, Writable } from "node:stream";
import xterm from "@xterm/headless";

/** Real ANSI interpretation at the renderer's IO boundary, with deterministic dimensions. */
export function createTerminal(columns = 20, rows = 8) {
  const terminal = new xterm.Terminal({ cols: columns, rows, allowProposedApi: true });
  const stdin = new PassThrough();
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        terminal.write(chunk, callback);
      },
    }),
    { columns, rows },
  );
  async function flush() {
    await new Promise<void>((resolve) => stdout.write("", () => resolve()));
  }
  return {
    stdin,
    stdout,
    terminal,
    flush,
    async waitFor(predicate: () => boolean) {
      const deadline = performance.now() + 1000;
      do {
        await flush();
        if (predicate()) return;
        await Bun.sleep(1);
      } while (performance.now() < deadline);
      throw new Error("Terminal did not reach the expected state within 1 second");
    },
    screen() {
      const buffer = terminal.buffer.active;
      return Array.from({ length: rows }, (_, y) =>
        buffer
          .getLine(buffer.viewportY + y)!
          .translateToString(true)
          .trimEnd(),
      );
    },
    cursor() {
      return { x: terminal.buffer.active.cursorX, y: terminal.buffer.active.cursorY };
    },
    dispose() {
      stdin.destroy();
      stdout.destroy();
      terminal.dispose();
    },
  };
}
