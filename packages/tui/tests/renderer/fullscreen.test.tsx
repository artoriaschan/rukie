import { expect, test } from "bun:test";
import { useLayoutEffect, useRef, useState } from "react";
import {
  Box,
  ScrollBox,
  Text,
  render,
  useInput,
  type ScrollHandle,
  type ScrollSnapshot,
} from "../../src";
import { createTerminal } from "../helpers/terminal";

test("background blocks stay clipped to the scroll viewport above a fixed dock", async () => {
  const terminal = createTerminal(12, 4);
  const scroll = { current: null as ScrollHandle | null };
  const app = render(
    <Box flexDirection="column" flexGrow={1}>
      <Text>header</Text>
      <ScrollBox ref={scroll} initialFollow={false}>
        <Box backgroundColor="#d8dadd">
          <Text>{"first\nsecond\nthird\nfourth\nfifth"}</Text>
        </Box>
      </ScrollBox>
      <Text>dock</Text>
    </Box>,
    { ...terminal, fullscreen: true },
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
    terminal.dispose();
  }
});

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

test("portable reading anchors restore exact duplicate content after remount and reflow, with top fallback and follow mode", async () => {
  const terminal = createTerminal(20, 4);
  let saved: ScrollSnapshot | undefined;
  const duplicate = "AA BB CC DD EE FF GG HH II JJ KK LL MM NN OO PP QQ RR SS TT UU VV WW XX YY ZZ";
  function View() {
    const [hidden, setHidden] = useState(false);
    const [omitFirst, setOmitFirst] = useState(false);
    const [omitSecond, setOmitSecond] = useState(false);
    const scroll = useRef<ScrollHandle>(null);
    useInput((event) => {
      if (event.type !== "key") return;
      if (event.input === "h") {
        saved = scroll.current?.getSnapshot();
        setHidden(true);
      }
      if (event.input === "r") setHidden(false);
      if (event.input === "d") {
        setOmitFirst(true);
        setHidden(false);
      }
      if (event.input === "m") {
        setOmitSecond(true);
        setHidden(false);
      }
      if (event.key.name === "up") scroll.current?.scrollBy(-2);
    });
    if (hidden) return <Text>panel</Text>;
    return (
      <Box flexDirection="column" height={4}>
        <ScrollBox
          ref={scroll}
          initialTop={saved?.top}
          initialFollow={saved?.following}
          initialAnchor={saved?.anchor}
        >
          {!omitFirst && (
            <Box scrollAnchorId="first">
              <Text>{duplicate}</Text>
            </Box>
          )}
          {!omitSecond && (
            <Box scrollAnchorId="second">
              <Box width={2}>
                <Text>❯</Text>
              </Box>
              <Box flexGrow={1}>
                <Text>{duplicate}</Text>
              </Box>
            </Box>
          )}
          <Text>{"end-1\nend-2\nend-3\nend-4\nend-5\nend-6\nend-7\nend-8"}</Text>
        </ScrollBox>
        <Text>dock</Text>
      </Box>
    );
  }
  const app = render(<View />, { ...terminal, fullscreen: true });
  try {
    await terminal.flush();
    expect(terminal.screen()[2]).toBe("end-8");
    terminal.stdin.write("h");
    await terminal.waitFor(() => terminal.screen()[0] === "panel");
    terminal.stdin.write("r");
    await terminal.waitFor(() => terminal.screen()[2] === "end-8");
    expect(saved?.following).toBe(true);
    terminal.stdin.write("\x1b[A".repeat(4));
    await terminal.waitFor(() => terminal.screen()[0] === "  HH II JJ KK LL MM");
    terminal.stdin.write("h");
    await terminal.waitFor(() => terminal.screen()[0] === "panel");
    expect(saved?.anchor?.id).toBe("second");
    terminal.resize(14, 4);
    terminal.stdin.write("d");
    await terminal.waitFor(() => terminal.screen()[0] === "  FF GG HH II");
    expect(saved?.following).toBe(false);
    terminal.stdin.write("h");
    await terminal.waitFor(() => terminal.screen()[0] === "panel");
    const fallback = saved!.top;
    terminal.stdin.write("m");
    await terminal.waitFor(() => terminal.screen()[0]?.startsWith("end-") === true);
    expect(terminal.screen()[0]).toBe(`end-${fallback + 1}`);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});
