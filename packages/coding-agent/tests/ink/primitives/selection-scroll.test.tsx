import { createRef, useState } from "react";
import { expect, jest, test } from "bun:test";
import { Box, ScrollBox, Text, render, type ScrollHandle } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

for (const [name, anchorRow, expected, wheel, moveAfterWheel] of [
  ["within viewport", 4, "row-3", true, false],
  ["one selected outgoing row", 3, "row-2\nrow-3", true, false],
  ["new pointer movement extends", 3, "row-2\nrow-3\nrow-4\nrow-5\nrow-6", true, true],
  ["control without wheel", 3, "row-2\nrow-3", false, false],
] as const) {
  test(`held drag survives wheel down with ${name} and copies original painted text`, async () => {
    jest.useFakeTimers();
    const terminal = createTerminal(20, 6, (ms) => jest.advanceTimersByTime(ms));
    const scroll = createRef<ScrollHandle>();
    const copied: string[] = [];
    const results: string[] = [];
    const app = render(
      <Box height={6} flexDirection="column">
        <Text>header</Text>
        <ScrollBox
          ref={scroll}
          initialFollow={false}
          onWheel={(event) => scroll.current?.scrollBy(event.delta * 3)}
          textSelection={{
            key: "wheel-fixture",
            onCopy: async (text) => {
              copied.push(text);
              return true;
            },
            onResult: (result) => results.push(result),
          }}
        >
          <Text>{Array.from({ length: 10 }, (_, i) => `row-${i}`).join("\n")}</Text>
        </ScrollBox>
        <Text>footer</Text>
      </Box>,
      { ...terminal, fullscreen: true },
    );
    try {
      await terminal.waitFor(() => terminal.screen()[1] === "row-0");
      expect(terminal.screen()).toEqual(["header", "row-0", "row-1", "row-2", "row-3", "footer"]);
      terminal.stdin.write(`\x1b[<0;1;${anchorRow + 1}M\x1b[<32;5;5M`);
      await terminal.waitFor(
        () => !terminal.terminal.buffer.active.getLine(anchorRow)!.getCell(0)!.isBgDefault(),
      );
      if (wheel) {
        terminal.stdin.write("\x1b[<65;5;5M");
        await terminal.waitFor(() => terminal.screen()[1] === "row-3");
        expect(terminal.screen()).toEqual(["header", "row-3", "row-4", "row-5", "row-6", "footer"]);
      }
      if (moveAfterWheel) terminal.stdin.write("\x1b[<32;5;5M");
      terminal.stdin.write("\x1b[<0;5;5m");
      jest.advanceTimersByTime(32);
      await terminal.flush();
      // Release is a synchronous renderer boundary; captured host bytes prove the gesture survived.
      expect(copied).toEqual([expected]);
      expect(results).toEqual(["copied"]);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
      jest.useRealTimers();
    }
  });
}

for (const selectedChanges of [true, false])
  test(`${selectedChanges ? "Changing captured source refuses copy" : "Updating outside captured source keeps copy safe"}`, async () => {
    jest.useFakeTimers();
    const terminal = createTerminal(20, 6, (ms) => jest.advanceTimersByTime(ms));
    const scroll = createRef<ScrollHandle>();
    const copied: string[] = [];
    const results: string[] = [];
    let replace = (_text: string) => {};
    function View() {
      const [text, setText] = useState(Array.from({ length: 10 }, (_, i) => `row-${i}`).join("\n"));
      replace = setText;
      return (
        <Box height={6} flexDirection="column">
          <Text>{text.includes("OTHER") ? "changed" : "header"}</Text>
          <ScrollBox
            ref={scroll}
            initialFollow={false}
            onWheel={(event) => scroll.current?.scrollBy(event.delta * 3)}
            textSelection={{
              key: "mutable",
              onCopy: async (value) => {
                copied.push(value);
                return true;
              },
              onResult: (value) => results.push(value),
            }}
          >
            <Text>{text}</Text>
          </ScrollBox>
          <Text>footer</Text>
        </Box>
      );
    }
    const app = render(<View />, { ...terminal, fullscreen: true });
    try {
      await terminal.waitFor(() => terminal.screen()[1] === "row-0");
      terminal.stdin.write("\x1b[<0;1;4M\x1b[<32;5;5M");
      await terminal.waitFor(
        () => !terminal.terminal.buffer.active.getLine(3)!.getCell(0)!.isBgDefault(),
      );
      terminal.stdin.write("\x1b[<65;5;5M");
      await terminal.waitFor(() => terminal.screen()[1] === "row-3");
      replace(
        Array.from({ length: 10 }, (_, i) =>
          i === (selectedChanges ? 2 : 9) ? "OTHER" : `row-${i}`,
        ).join("\n"),
      );
      await terminal.waitFor(() => terminal.screen()[0] === "changed");
      terminal.stdin.write("\x1b[<0;5;5m");
      jest.advanceTimersByTime(32);
      await terminal.flush();
      expect(copied).toEqual(selectedChanges ? [] : ["row-2\nrow-3"]);
      expect(results).toEqual([selectedChanges ? "stale" : "copied"]);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
      jest.useRealTimers();
    }
  });

test("held drag can scroll down twice and back without duplicating captured rows", async () => {
  jest.useFakeTimers();
  const terminal = createTerminal(20, 6, (ms) => jest.advanceTimersByTime(ms));
  const scroll = createRef<ScrollHandle>();
  const copied: string[] = [];
  const app = render(
    <Box height={6} flexDirection="column">
      <Text>header</Text>
      <ScrollBox
        ref={scroll}
        initialFollow={false}
        onWheel={(event) => scroll.current?.scrollBy(event.delta * 3)}
        textSelection={{
          onCopy: async (value) => {
            copied.push(value);
            return true;
          },
          onResult: () => {},
        }}
      >
        <Text>{Array.from({ length: 12 }, (_, i) => `row-${i}`).join("\n")}</Text>
      </ScrollBox>
      <Text>footer</Text>
    </Box>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.waitFor(() => terminal.screen()[1] === "row-0");
    terminal.stdin.write("\x1b[<0;1;4M\x1b[<32;5;5M\x1b[<65;5;5M");
    await terminal.waitFor(() => terminal.screen()[1] === "row-3");
    terminal.stdin.write("\x1b[<65;5;5M");
    await terminal.waitFor(() => terminal.screen()[1] === "row-6");
    terminal.stdin.write("\x1b[<64;5;5M");
    await terminal.waitFor(() => terminal.screen()[1] === "row-3");
    terminal.stdin.write("\x1b[<0;5;5m");
    jest.advanceTimersByTime(32);
    await terminal.flush();
    expect(copied).toEqual(["row-2\nrow-3"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
    jest.useRealTimers();
  }
});

test("upward held drag captures selected outgoing bottom rows", async () => {
  jest.useFakeTimers();
  const terminal = createTerminal(20, 6, (ms) => jest.advanceTimersByTime(ms));
  const scroll = createRef<ScrollHandle>();
  const copied: string[] = [];
  const app = render(
    <Box height={6} flexDirection="column">
      <Text>header</Text>
      <ScrollBox
        ref={scroll}
        initialTop={3}
        initialFollow={false}
        onWheel={(event) => scroll.current?.scrollBy(event.delta * 3)}
        textSelection={{
          onCopy: async (value) => {
            copied.push(value);
            return true;
          },
          onResult: () => {},
        }}
      >
        <Text>{Array.from({ length: 10 }, (_, i) => `row-${i}`).join("\n")}</Text>
      </ScrollBox>
      <Text>footer</Text>
    </Box>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.waitFor(() => terminal.screen()[1] === "row-3");
    terminal.stdin.write("\x1b[<0;5;5M\x1b[<32;1;2M\x1b[<64;1;2M");
    await terminal.waitFor(() => terminal.screen()[1] === "row-0");
    terminal.stdin.write("\x1b[<0;1;3m");
    jest.advanceTimersByTime(32);
    await terminal.flush();
    expect(copied).toEqual(["row-3\nrow-4\nrow-5\nrow-6"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
    jest.useRealTimers();
  }
});

test("auto-follow preserves the held anchor and captures rows as a stream grows", async () => {
  jest.useFakeTimers();
  const terminal = createTerminal(20, 6, (ms) => jest.advanceTimersByTime(ms));
  const copied: string[] = [];
  let grow = (_count: number) => {};
  function View() {
    const [count, setCount] = useState(6);
    grow = setCount;
    return (
      <Box height={6} flexDirection="column">
        <Text>header</Text>
        <ScrollBox
          textSelection={{
            onCopy: async (value) => {
              copied.push(value);
              return true;
            },
            onResult: () => {},
          }}
        >
          <Text>{Array.from({ length: count }, (_, i) => `row-${i}`).join("\n")}</Text>
        </ScrollBox>
        <Text>footer</Text>
      </Box>
    );
  }
  const app = render(<View />, { ...terminal, fullscreen: true });
  try {
    await terminal.waitFor(() => terminal.screen()[1] === "row-2");
    terminal.stdin.write("\x1b[<0;1;3M\x1b[<32;5;5M");
    await terminal.waitFor(
      () => !terminal.terminal.buffer.active.getLine(2)!.getCell(0)!.isBgDefault(),
    );
    grow(8);
    await terminal.waitFor(() => terminal.screen()[1] === "row-4");
    terminal.stdin.write("\x1b[<0;5;5m");
    jest.advanceTimersByTime(32);
    await terminal.flush();
    expect(copied).toEqual(["row-3\nrow-4\nrow-5"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
    jest.useRealTimers();
  }
});

test("a held selection fully scrolled off the same edge is discarded only on release", async () => {
  jest.useFakeTimers();
  const terminal = createTerminal(20, 6, (ms) => jest.advanceTimersByTime(ms));
  const scroll = createRef<ScrollHandle>();
  const copied: string[] = [],
    results: string[] = [];
  const app = render(
    <Box height={6} flexDirection="column">
      <Text>header</Text>
      <ScrollBox
        ref={scroll}
        initialFollow={false}
        onWheel={(event) => scroll.current?.scrollBy(event.delta * 3)}
        textSelection={{
          onCopy: async (value) => {
            copied.push(value);
            return true;
          },
          onResult: (value) => results.push(value),
        }}
      >
        <Text>{Array.from({ length: 12 }, (_, i) => `row-${i}`).join("\n")}</Text>
      </ScrollBox>
      <Text>footer</Text>
    </Box>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.waitFor(() => terminal.screen()[1] === "row-0");
    terminal.stdin.write("\x1b[<0;1;4M\x1b[<32;5;5M\x1b[<65;5;5M");
    await terminal.waitFor(() => terminal.screen()[1] === "row-3");
    terminal.stdin.write("\x1b[<65;5;5M");
    await terminal.waitFor(() => terminal.screen()[1] === "row-6");
    terminal.stdin.write("\x1b[<0;5;5m");
    jest.advanceTimersByTime(32);
    await terminal.flush();
    expect(copied).toEqual([]);
    expect(results).toEqual([]);
    expect(terminal.terminal.buffer.active.getLine(1)!.getCell(0)!.isBgDefault()).toBe(true);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
    jest.useRealTimers();
  }
});

test("captured Unicode soft wraps copy whole glyphs and exclude decorated gutters", async () => {
  jest.useFakeTimers();
  const terminal = createTerminal(10, 6, (ms) => jest.advanceTimersByTime(ms));
  const scroll = createRef<ScrollHandle>();
  const copied: string[] = [];
  const app = render(
    <Box height={6} flexDirection="column">
      <Text>header</Text>
      <ScrollBox
        ref={scroll}
        initialFollow={false}
        onWheel={(event) => scroll.current?.scrollBy(event.delta)}
        textSelection={{
          onCopy: async (value) => {
            copied.push(value);
            return true;
          },
          onResult: () => {},
        }}
      >
        <Text>
          <Text selectable={false}>│</Text>
          {"中🐋hello worldabcdefgh\nB\nC\nD\nE"}
        </Text>
      </ScrollBox>
      <Text>footer</Text>
    </Box>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.waitFor(() => terminal.screen()[1] === "│中🐋hello");
    terminal.stdin.write("\x1b[<0;3;2M\x1b[<32;10;3M\x1b[<65;10;3M");
    await terminal.waitFor(() => terminal.screen()[1] === "worldabcde");
    terminal.stdin.write("\x1b[<0;10;3m");
    jest.advanceTimersByTime(32);
    await terminal.flush();
    expect(copied).toEqual(["中🐋hello worldabcde"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
    jest.useRealTimers();
  }
});

test("captured wide glyph continuation remains subject to source validation", async () => {
  jest.useFakeTimers();
  const terminal = createTerminal(10, 6, (ms) => jest.advanceTimersByTime(ms));
  const scroll = createRef<ScrollHandle>();
  const copied: string[] = [],
    results: string[] = [];
  let replace = () => {};
  function View() {
    const [changed, setChanged] = useState(false);
    replace = () => setChanged(true);
    return (
      <Box height={6} flexDirection="column">
        <Text>{changed ? "changed" : "header"}</Text>
        <ScrollBox
          ref={scroll}
          initialFollow={false}
          onWheel={(event) => scroll.current?.scrollBy(event.delta)}
          textSelection={{
            onCopy: async (value) => {
              copied.push(value);
              return true;
            },
            onResult: (value) => results.push(value),
          }}
        >
          <Text>{`${changed ? "另" : "中"}\nNEXT\nfoo\nbar\nz`}</Text>
        </ScrollBox>
        <Text>footer</Text>
      </Box>
    );
  }
  const app = render(<View />, { ...terminal, fullscreen: true });
  try {
    await terminal.waitFor(() => terminal.screen()[1] === "中");
    terminal.stdin.write("\x1b[<0;2;2M\x1b[<32;1;3M\x1b[<65;1;3M");
    await terminal.waitFor(() => terminal.screen()[1] === "NEXT");
    replace();
    await terminal.waitFor(() => terminal.screen()[0] === "changed");
    terminal.stdin.write("\x1b[<0;1;3m");
    jest.advanceTimersByTime(32);
    await terminal.flush();
    expect(copied).toEqual([]);
    expect(results).toEqual(["stale"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
    jest.useRealTimers();
  }
});
