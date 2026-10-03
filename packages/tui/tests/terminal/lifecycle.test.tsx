import { expect, test } from "bun:test";
import { useLayoutEffect, useState } from "react";
import { Text, render, useInput } from "../../src";
import { createTerminal } from "../helpers/terminal";

test("unmount restores raw mode, bracketed paste and cursor visibility and detaches IO", async () => {
  const terminal = createTerminal();
  const events: string[] = [];
  const listeners = {
    input: terminal.stdin.listenerCount("data"),
    resize: terminal.stdout.listenerCount("resize"),
    exit: process.listenerCount("exit"),
    error: process.listenerCount("uncaughtExceptionMonitor"),
  };
  function View() {
    useInput((event) => {
      if ("input" in event) events.push(event.input);
    });
    return <Text>ready</Text>;
  }
  const app = render(<View />, terminal);
  try {
    await terminal.flush();
    expect(terminal.stdin.isRaw).toBe(true);
    expect(terminal.terminal.modes.bracketedPasteMode).toBe(true);
    app.unmount();
    app.unmount();
    await app.waitUntilExit();
    await terminal.flush();
    expect(terminal.stdin.isRaw).toBe(false);
    expect(terminal.stdin.isPaused()).toBe(true);
    expect(terminal.terminal.modes.bracketedPasteMode).toBe(false);
    expect(terminal.output()).toContain("\x1b[?25h\x1b[?2004l");
    expect(terminal.stdin.listenerCount("data")).toBe(listeners.input);
    expect(terminal.stdout.listenerCount("resize")).toBe(listeners.resize);
    expect(process.listenerCount("exit")).toBe(listeners.exit);
    expect(process.listenerCount("uncaughtExceptionMonitor")).toBe(listeners.error);
    terminal.stdin.write("ignored");
    const before = terminal.bytesWritten();
    terminal.resize(10, 4);
    await terminal.flush();
    expect(events).toEqual([]);
    expect(terminal.bytesWritten()).toBe(before);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("process exit and termination restore all mounted terminals without replacing frontend signal handlers", async () => {
  for (const event of ["exit", "SIGTERM", "SIGINT"] as const) {
    const first = createTerminal();
    const second = createTerminal();
    let handled = false;
    const handle = () => {
      handled = true;
    };
    process.on(event, handle);
    const a = render(<Text>first</Text>, first);
    const b = render(<Text>second</Text>, second);
    try {
      await first.flush();
      await second.flush();
      process.emit(event, 1);
      await a.waitUntilExit();
      await b.waitUntilExit();
      await first.flush();
      await second.flush();
      expect(handled).toBe(true);
      for (const terminal of [first, second]) {
        expect(terminal.stdin.isRaw).toBe(false);
        expect(terminal.terminal.modes.bracketedPasteMode).toBe(false);
      }
    } finally {
      process.off(event, handle);
      a.unmount();
      b.unmount();
      first.dispose();
      second.dispose();
    }
  }
});

test("a synchronous paint failure restores terminal modes before propagating the error", async () => {
  const terminal = createTerminal();
  try {
    expect(() => render(<Text color="#invalid">broken</Text>, terminal)).toThrow(
      "Invalid text color",
    );
    await terminal.flush();
    expect(terminal.stdin.isRaw).toBe(false);
    expect(terminal.terminal.modes.bracketedPasteMode).toBe(false);
  } finally {
    terminal.dispose();
  }
});

test("an IO failure while enabling terminal modes also restores stdin", async () => {
  const terminal = createTerminal();
  let first = true;
  const stdout = {
    columns: 20,
    rows: 8,
    write(text: string) {
      if (first) {
        first = false;
        throw new Error("write failed");
      }
      return terminal.stdout.write(text);
    },
  };
  try {
    expect(() => render(<Text>ready</Text>, { stdin: terminal.stdin, stdout })).toThrow(
      "write failed",
    );
    expect(terminal.stdin.isRaw).toBe(false);
    await terminal.flush();
    expect(terminal.output()).toContain("\x1b[?25h\x1b[?2004l");
  } finally {
    terminal.dispose();
  }
});

test("a later render failure restores modes and rejects waitUntilExit", async () => {
  const terminal = createTerminal();
  let fail = () => {};
  function View() {
    const [broken, setBroken] = useState(false);
    useLayoutEffect(() => {
      fail = () => setBroken(true);
    }, []);
    return <Text color={broken ? "#invalid" : undefined}>ready</Text>;
  }
  const app = render(<View />, terminal);
  try {
    await terminal.flush();
    fail();
    await expect(app.waitUntilExit()).rejects.toThrow("Invalid text color");
    await terminal.flush();
    expect(terminal.stdin.isRaw).toBe(false);
    expect(terminal.terminal.modes.bracketedPasteMode).toBe(false);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("abnormal process exit restores the terminal and stops further painting", async () => {
  const terminal = createTerminal();
  let update = () => {};
  function View() {
    const [text, setText] = useState("ready");
    useLayoutEffect(() => {
      update = () => setText("late update");
    }, []);
    return <Text>{text}</Text>;
  }
  const app = render(<View />, terminal);
  try {
    await terminal.flush();
    process.emit("uncaughtExceptionMonitor", new Error("test failure"), "uncaughtException");
    await terminal.flush();
    expect(terminal.stdin.isRaw).toBe(false);
    expect(terminal.terminal.modes.bracketedPasteMode).toBe(false);
    expect(terminal.output()).toContain("\x1b[?25h\x1b[?2004l");
    update();
    await Bun.sleep(20);
    await terminal.flush();
    expect(terminal.screen()[0]).toBe("ready");
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("unmount returns an already-raw stdin to raw mode", async () => {
  const terminal = createTerminal();
  terminal.stdin.setRawMode(true);
  const app = render(<Text>ready</Text>, terminal);
  app.unmount();
  await app.waitUntilExit();
  expect(terminal.stdin.isRaw).toBe(true);
  terminal.dispose();
});
