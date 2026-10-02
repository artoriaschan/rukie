import { expect, test } from "bun:test";
import { useLayoutEffect, useRef, useState } from "react";
import { Box, ScrollBox, Text, render, useInput, type ScrollHandle } from "../../src";
import { createTerminal } from "../helpers/terminal";

test("fullscreen occupies the viewport and restores the original terminal contents and cursor", async () => {
  const terminal = createTerminal(20, 8);
  terminal.stdout.write("shell history\r\nshell> ");
  await terminal.flush();
  const original = terminal.screen();
  const cursor = terminal.cursor();
  const app = render(
    <Box flexDirection="column" height={8}>
      <Box flexGrow={1}>
        <Text>body</Text>
      </Box>
      <Text>fixed input</Text>
    </Box>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.flush();
    expect(terminal.terminal.buffer.active.type).toBe("alternate");
    expect(terminal.output()).toContain("\x1b[?1002h\x1b[?1003h");
    expect(terminal.terminal.modes.mouseTrackingMode).toBe("any");
    expect(terminal.screen()[0]).toBe("body");
    expect(terminal.screen()[7]).toBe("fixed input");
    expect(terminal.scrollback()).toEqual([]);
    app.unmount();
    app.unmount();
    await terminal.flush();
    expect(terminal.terminal.buffer.active.type).toBe("normal");
    expect(terminal.screen()).toEqual(original);
    expect(terminal.cursor()).toEqual(cursor);
    expect(terminal.stdin.isRaw).toBe(false);
    expect(terminal.terminal.modes.mouseTrackingMode).toBe("none");
    expect(terminal.output()).toContain("\x1b[?1002l\x1b[?1003l");
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("width reflow keeps the visible text anchor while browsing instead of jumping to the bottom", async () => {
  const terminal = createTerminal(20, 4);
  const scroll = { current: null as ScrollHandle | null };
  const app = render(
    <Box flexDirection="column" flexGrow={1}>
      <ScrollBox ref={scroll}>
        <Text>AA BB CC DD EE FF GG HH II JJ KK LL MM NN OO PP QQ RR SS TT UU VV WW XX YY ZZ</Text>
        <Text>last message</Text>
      </ScrollBox>
      <Text>dock</Text>
    </Box>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.flush();
    scroll.current!.scrollBy(1 - scroll.current!.getSnapshot().top);
    await terminal.waitFor(() => terminal.screen()[0] === "HH II JJ KK LL MM NN");
    terminal.resize(14, 4);
    await Bun.sleep(30);
    await terminal.flush();
    expect(terminal.screen()[0]).toBe("FF GG HH II JJ");
    expect(terminal.screen()[3]).toBe("dock");
    expect(scroll.current!.getSnapshot().following).toBe(false);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("resize preserves a reading position on an empty line", async () => {
  const terminal = createTerminal(20, 4);
  const scroll = { current: null as ScrollHandle | null };
  const app = render(
    <Box flexDirection="column" flexGrow={1}>
      <ScrollBox ref={scroll}>
        <Text>{"first\n\nthird\nfourth\nfifth\nsixth\nseventh"}</Text>
      </ScrollBox>
      <Text>dock</Text>
    </Box>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.flush();
    scroll.current!.scrollBy(1 - scroll.current!.getSnapshot().top);
    await terminal.waitFor(() => terminal.screen()[1] === "third");
    expect(terminal.screen()).toEqual(["", "third", "fourth", "dock"]);
    terminal.resize(14, 4);
    await Bun.sleep(30);
    await terminal.flush();
    expect(terminal.screen()).toEqual(["", "third", "fourth", "dock"]);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("a scrollable body follows output at the bottom and preserves browsing above a fixed dock", async () => {
  const terminal = createTerminal(20, 8);
  let append = () => {};
  function View() {
    const scroll = useRef<ScrollHandle>(null);
    const [count, setCount] = useState(10);
    useLayoutEffect(() => {
      append = () => setCount((count) => count + 1);
    }, []);
    useInput((event) => {
      if (event.type !== "key") return;
      if (event.key.name === "pageup") scroll.current?.scrollBy(-3);
      if (event.key.name === "end") scroll.current?.scrollToBottom();
    });
    return (
      <Box flexDirection="column" height={8}>
        <ScrollBox ref={scroll}>
          {Array.from({ length: count }, (_, index) => (
            <Text key={index}>row {index}</Text>
          ))}
        </ScrollBox>
        <Text>fixed input</Text>
      </Box>
    );
  }
  const app = render(<View />, { ...terminal, fullscreen: true });
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual([
      "row 3",
      "row 4",
      "row 5",
      "row 6",
      "row 7",
      "row 8",
      "row 9",
      "fixed input",
    ]);
    terminal.stdin.write("\x1b[5~");
    await terminal.waitFor(() => terminal.screen()[0] === "row 0");
    append();
    await Bun.sleep(25);
    await terminal.flush();
    expect(terminal.screen()[0]).toBe("row 0");
    expect(terminal.screen()[7]).toBe("fixed input");
    terminal.stdin.write("\x1b[1;5F");
    await terminal.waitFor(() => terminal.screen()[6] === "row 10");
    append();
    await terminal.waitFor(() => terminal.screen()[6] === "row 11");
    expect(terminal.scrollback()).toEqual([]);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("a long conversation retains its first message and only paints the visible viewport", async () => {
  const terminal = createTerminal(40, 12);
  const scroll = { current: null as ScrollHandle | null };
  const app = render(
    <Box flexDirection="column" flexGrow={1}>
      <ScrollBox ref={scroll}>
        {Array.from({ length: 1000 }, (_, i) => (
          <Text key={i}>message {i}</Text>
        ))}
      </ScrollBox>
      <Text>dock</Text>
    </Box>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.flush();
    expect(terminal.screen()[10]).toBe("message 999");
    expect(terminal.bytesWritten()).toBeLessThan(2000);
    scroll.current!.scrollBy(-1000);
    await terminal.waitFor(() => terminal.screen()[0] === "message 0");
    expect(terminal.screen()[10]).toBe("message 10");
    expect(terminal.screen()[11]).toBe("dock");
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("fullscreen cleanup restores the original screen for paint failures and process termination", async () => {
  for (const event of ["SIGINT", "SIGTERM", "uncaughtExceptionMonitor"] as const) {
    const terminal = createTerminal(20, 8);
    terminal.stdout.write("original shell> ");
    await terminal.flush();
    const original = terminal.screen();
    const handle = () => {};
    process.on(event, handle);
    const app = render(<Text>fullscreen UI</Text>, { ...terminal, fullscreen: true });
    try {
      await terminal.flush();
      if (event === "uncaughtExceptionMonitor")
        process.emit(event, new Error("fatal"), "uncaughtException");
      else process.emit(event);
      await app.waitUntilExit();
      await terminal.flush();
      expect(terminal.screen()).toEqual(original);
      expect(terminal.stdin.isRaw).toBe(false);
      expect(terminal.terminal.modes.bracketedPasteMode).toBe(false);
      expect(terminal.terminal.modes.mouseTrackingMode).toBe("none");
    } finally {
      process.off(event, handle);
      app.unmount();
      terminal.dispose();
    }
  }
  const terminal = createTerminal();
  terminal.stdout.write("original shell> ");
  await terminal.flush();
  const original = terminal.screen();
  try {
    expect(() =>
      render(<Text color="#invalid">broken</Text>, { ...terminal, fullscreen: true }),
    ).toThrow("Invalid text color");
    await terminal.flush();
    expect(terminal.screen()).toEqual(original);
    expect(terminal.stdin.isRaw).toBe(false);
    expect(terminal.terminal.modes.mouseTrackingMode).toBe("none");
  } finally {
    terminal.dispose();
  }
});
