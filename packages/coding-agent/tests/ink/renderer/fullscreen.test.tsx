import { expect, test } from "bun:test";
import { useLayoutEffect, useRef, useState } from "react";
import {
  Box,
  ScrollBox,
  Text,
  AlternateScreen,
  renderSync,
  useInput,
  type ScrollBoxHandle,
} from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

test("background blocks stay clipped to the scroll viewport above a fixed dock", async () => {
  const terminal = createTerminal(12, 4);
  const scroll = { current: null as ScrollBoxHandle | null };
  const app = renderSync(
    <AlternateScreen>
      <Box flexDirection="column" flexGrow={1}>
        <Text>header</Text>
        <ScrollBox ref={scroll} height={2}>
          <Box flexShrink={0} backgroundColor="#d8dadd">
            <Text>{"first\nsecond\nthird\nfourth\nfifth"}</Text>
          </Box>
        </ScrollBox>
        <Text>dock</Text>
      </Box>
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["header", "first", "second", "dock"]);
    const cell = (x: number, y: number) => terminal.terminal.buffer.active.getLine(y)!.getCell(x)!;
    expect(cell(11, 1).getBgColor()).toBe(0xd8dadd);
    expect(cell(11, 2).getBgColor()).toBe(0xd8dadd);
    expect(cell(11, 0).isBgDefault()).toBe(true);
    expect(cell(11, 3).isBgDefault()).toBe(true);
    scroll.current!.scrollToBottom();
    await terminal.waitFor(() => terminal.screen()[2] === "fifth");
    expect(terminal.screen()).toEqual(["header", "fourth", "fifth", "dock"]);
    expect(cell(11, 1).getBgColor()).toBe(0xd8dadd);
    expect(cell(11, 3).isBgDefault()).toBe(true);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("fullscreen occupies the viewport and restores the original terminal contents and cursor", async () => {
  const terminal = createTerminal(20, 8);
  terminal.stdout.write("shell history\r\nshell> ");
  await terminal.flush();
  const original = terminal.screen();
  const cursor = terminal.cursor();
  const app = renderSync(
    <AlternateScreen>
      <Box flexDirection="column" height={8}>
        <Box flexGrow={1}>
          <Text>body</Text>
        </Box>
        <Text>fixed input</Text>
      </Box>
    </AlternateScreen>,
    terminal,
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
    expect(terminal.output()).toContain("\x1b[?1002l");
    expect(terminal.output()).toContain("\x1b[?1003l");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("a scrollable body follows output at the bottom and preserves browsing above a fixed dock", async () => {
  const terminal = createTerminal(20, 8);
  let append = () => {};
  function View() {
    const scroll = useRef<ScrollBoxHandle>(null);
    const [count, setCount] = useState(10);
    useLayoutEffect(() => {
      append = () => setCount((count) => count + 1);
    }, []);
    useInput((_input, key) => {
      if (key.pageUp) scroll.current?.scrollBy(-3);
      if (key.end) scroll.current?.scrollToBottom();
    });
    return (
      <Box flexDirection="column" height={8}>
        <ScrollBox ref={scroll} stickyScroll flexGrow={1}>
          {Array.from({ length: count }, (_, index) => (
            <Box key={index} flexShrink={0}>
              <Text>row {index}</Text>
            </Box>
          ))}
        </ScrollBox>
        <Text>fixed input</Text>
      </Box>
    );
  }
  const app = renderSync(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
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
    await terminal.waitFor(
      () => terminal.screen()[0] === "row 0" && terminal.screen()[6] === "row 6",
    );
    expect(terminal.screen()[0]).toBe("row 0");
    expect(terminal.screen()[7]).toBe("fixed input");
    terminal.stdin.write("\x1b[1;5F");
    await terminal.waitFor(() => terminal.screen()[6] === "row 10");
    append();
    await terminal.waitFor(() => terminal.screen()[6] === "row 11");
    expect(terminal.scrollback()).toEqual([]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("a long conversation retains its first message and only paints the visible viewport", async () => {
  const terminal = createTerminal(40, 12);
  const scroll = { current: null as ScrollBoxHandle | null };
  const app = renderSync(
    <AlternateScreen>
      <Box flexDirection="column" flexGrow={1}>
        <ScrollBox ref={scroll} height={11} stickyScroll>
          {Array.from({ length: 1000 }, (_, i) => (
            <Box key={i} flexShrink={0}>
              <Text>message {i}</Text>
            </Box>
          ))}
        </ScrollBox>
        <Text>dock</Text>
      </Box>
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()[10]).toBe("message 999");
    expect(terminal.bytesWritten()).toBeLessThan(2000);
    scroll.current!.scrollTo(0);
    await terminal.waitFor(() => terminal.screen()[0] === "message 0");
    expect(terminal.screen()[10]).toBe("message 10");
    expect(terminal.screen()[11]).toBe("dock");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
