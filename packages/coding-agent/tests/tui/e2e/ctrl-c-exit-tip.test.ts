import { setImmediate } from "node:timers/promises";
import { startWithClock } from "../helpers/clock-app";
import { testClock } from "../helpers/test-clock";
import { observeTimeoutDeadline } from "../helpers/timeout-deadline";
import { expect, test } from "bun:test";
import { start } from "../helpers/app";

test.each([
  ["zh_CN.UTF-8", "再次按 Ctrl+C 退出", "剪贴板中有图片 · ctrl+v 粘贴"],
  ["en_US.UTF-8", "Press Ctrl+C again to exit", "Image in clipboard · ctrl+v to paste"],
])(
  "%s exit tip follows the one-second exit window without moving the editor",
  async (lang, tip, clipboardTip) => {
    let advance = true;
    const app = await startWithClock([], {
      advanceTimers: (ms) => {
        testClock.advanceTimersByTime(advance ? ms : 0);
      },
      columns: 40,
      rows: 12,
      env: { LANG: lang },
      host: { hasClipboardImage: async () => true },
    });
    let deadline: ReturnType<typeof observeTimeoutDeadline> | undefined;
    try {
      await app.waitFor(() => app.screen().join("\n").includes(clipboardTip));
      const inputRow = app.screen().indexOf("❯");
      const buffer = app.terminal.buffer.active;
      const cursor = [buffer.cursorX, buffer.cursorY];
      advance = false;
      const armedAt = Date.now();
      deadline = observeTimeoutDeadline(1000, { expiresAt: armedAt + 1000 });
      app.stdin.write("\x03");
      // Consume the physical press at frozen time. Painting may then advance
      // frames before the passive effect registers the remaining lifetime.
      await setImmediate();
      await app.waitFor(() => app.stdin.readableLength === 0);
      expect(Date.now()).toBe(armedAt);
      advance = true;
      await app.waitFor(() => app.screen().join("\n").includes(tip));
      expect(app.screen().join("\n")).not.toContain(clipboardTip);
      expect(app.screen().indexOf("❯")).toBe(inputRow);
      expect([buffer.cursorX, buffer.cursorY]).toEqual(cursor);
      expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
      expect(app.stdin.isRaw).toBe(true);
      advance = false;
      deadline.beforeExpiry();
      await app.flush();
      expect(Date.now()).toBe(armedAt + 999);
      expect(app.screen().join("\n")).toContain(tip);
      expect(app.stdin.isRaw).toBe(true);
      deadline.expire();
      expect(Date.now()).toBe(armedAt + 1000);
      advance = true;
      await app.waitFor(() => !app.screen().join("\n").includes(tip));
      await app.waitFor(() => app.screen().join("\n").includes(clipboardTip));
      app.stdin.write("\x03");
      await app.waitFor(() => app.screen().join("\n").includes(tip));
      app.stdin.write("draft");
      await app.waitFor(() => app.screen().includes("❯ draft"));
      expect(app.screen().join("\n")).not.toContain(tip);
      app.stdin.write("\x03");
      await app.waitFor(() => app.screen().includes("❯"));
      expect(app.screen().join("\n")).not.toContain(tip);
      app.stdin.write("\x03");
      await app.waitFor(() => app.screen().join("\n").includes(tip));
      app.stdin.write("\x03");
      expect(await app.exit).toBe(0);
      expect(app.stdin.isRaw).toBe(false);
      expect(app.calls).toHaveLength(0);
    } finally {
      deadline?.restore();
      await app.cleanup();
    }
  },
);

test("Ctrl+C interrupts a Run and clears its draft before arming the exit tip", async () => {
  const tip = "Press Ctrl+C again to exit";
  const app = await start([], { env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("work\r");
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("preserved draft");
    await app.waitFor(() => app.screen().includes("❯ preserved draft"));
    app.stdin.write("\x03");
    await app.waitFor(() => !app.isWorking());
    expect(app.calls[0]!.signal!.aborted).toBe(true);
    expect(app.screen()).toContain("❯ preserved draft");
    expect(app.screen().join("\n")).not.toContain(tip);
    app.stdin.write("\x03");
    await app.waitFor(() => app.screen().includes("❯"));
    expect(app.screen().join("\n")).not.toContain(tip);
    app.stdin.write("\x03");
    await app.waitFor(() => app.screen().join("\n").includes(tip));
    app.stdin.write("\x03");
    expect(await app.exit).toBe(0);
  } finally {
    await app.cleanup();
  }
});

test("two Ctrl+C presses in one input chunk exit and restore the terminal", async () => {
  const app = await start();
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("\x03\x03");
    expect(await app.exit).toBe(0);
    expect(app.stdin.isRaw).toBe(false);
    expect(app.stdin.listenerCount("data")).toBe(0);
    expect(app.stdout.listenerCount("resize")).toBe(0);
    await app.flush();
    expect(app.terminal.modes.bracketedPasteMode).toBe(false);
    expect(app.output()).toContain("\x1b[?25h");
  } finally {
    await app.cleanup();
  }
});
