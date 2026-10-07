import { expect, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";

test("keyboard page batches accumulate and the final bottom command wins", async () => {
  const app = await startWithClock(["long output"]);
  const firstLine = () =>
    Number(
      app
        .screen()
        .find((line) => /page-line-\d+/.test(line))
        ?.match(/page-line-(\d+)/)?.[1],
    );
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(Array.from({ length: 100 }, (_, index) => `page-line-${index}`).join("\n"));
    app.calls[0]!.finish();
    await app.waitFor(
      () => !app.isWorking() && app.screen().some((line) => line.includes("page-line-99")),
    );
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => !app.screen().some((line) => line.includes("page-line-99")));
    const before = firstLine();
    app.stdin.write("\x1b[5~\x1b[5~");
    await app.waitFor(() => firstLine() < before - 20);
    app.stdin.write("\x1b[6~\x1b[6~");
    await app.waitFor(() => firstLine() === before);
    expect(firstLine()).toBe(before);
    app.stdin.write("\x1b[5~\x1b[1;5F");
    await app.waitFor(
      () =>
        app.screen().some((line) => line.includes("page-line-99")) &&
        !app.screen().some((line) => line.includes("Ctrl+End")),
    );
    expect(app.screen().some((line) => line.includes("page-line-99"))).toBe(true);
  } finally {
    await app.cleanup();
  }
});
