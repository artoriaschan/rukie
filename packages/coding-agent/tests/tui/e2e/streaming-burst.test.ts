import { expect, test } from "bun:test";
import { startWithClock as start } from "../helpers/clock-app";

test.each([false, true])(
  "parent streaming bursts complete while reading earlier output=%s",
  async (reading) => {
    const app = await start(["--permission-mode", "full-access", "summarize"], {
      columns: 100,
      rows: 24,
      env: { LANG: "en_US.UTF-8" },
    });
    const screen = () => app.screen().join("\n");
    try {
      await app.waitFor(() => app.calls.length === 1 && app.isWorking());
      if (reading) {
        app.calls[0]!.delta(
          Array.from({ length: 80 }, (_, index) => `history-${index}`).join("\n"),
        );
        app.calls[0]!.finish();
        await app.waitFor(
          () => screen().includes("history-79") && app.screen().at(-1)?.trim() === "",
        );
        app.stdin.write("summarize again\r");
        await app.waitFor(() => app.calls.length === 2 && app.isWorking());
        app.stdin.write("\x1b[5~");
        await app.waitFor(() => screen().includes("Back to bottom"));
      }
      const responseIndex = app.calls.length - 1;
      const response = app.calls[responseIndex]!;
      const readingPosition = app.screen().slice(0, 5);
      // Yield through the model event boundary while keeping buffered chunks in
      // one microtask burst, as when several SSE chunks arrive in one packet.
      for (let index = 0; index < 350; index++) {
        response.delta(`chunk-${index}\n`);
        await Promise.resolve();
        await Promise.resolve();
      }
      if (reading) {
        await app.waitFor(() => screen().includes("New output · Back to bottom"));
        expect(app.screen().slice(0, 5)).toEqual(readingPosition);
        app.stdin.write("\x1b[1;5F");
        await app.waitFor(
          () => screen().includes("chunk-349") && !screen().includes("Back to bottom"),
        );
      }
      response.delta("FINAL BURST RESULT");
      response.finish();
      await app.waitFor(
        () => screen().includes("FINAL BURST RESULT") && app.screen().at(-1)?.trim() === "",
      );
      expect(screen()).not.toContain("Maximum update depth");
      expect(app.stderr()).toBe("");
      app.stdin.write("next run\r");
      await app.waitFor(() => app.calls.length === responseIndex + 2);
      const next = app.calls.at(-1)!;
      expect(
        next.context.messages.some(
          (message) =>
            message.role === "assistant" &&
            JSON.stringify(message.content).includes("FINAL BURST RESULT"),
        ),
      ).toBe(true);
      next.delta("NEXT RUN OK");
      next.finish();
      await app.waitFor(
        () => screen().includes("NEXT RUN OK") && app.screen().at(-1)?.trim() === "",
      );
    } finally {
      await app.cleanup();
    }
  },
);
