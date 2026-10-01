import { expect, test } from "bun:test";
import { useLayoutEffect, useState } from "react";
import { Box, Text, render } from "../../src";
import { createTerminal } from "../helpers/terminal";

test("nested flex boxes place text inside padding and borders", async () => {
  const terminal = createTerminal(16, 8);
  const app = render(
    <Box flexDirection="column" width={12} borderStyle="single" padding={1}>
      <Box gap={1}>
        <Text>A</Text>
        <Text>B</Text>
      </Box>
      <Text>C</Text>
    </Box>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual([
      "┌──────────┐",
      "│          │",
      "│ A B      │",
      "│ C        │",
      "│          │",
      "└──────────┘",
      "",
      "",
    ]);
    expect(terminal.cursor()).toEqual({ x: 0, y: 6 });
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("wrapping a multi-codepoint grapheme preserves the following ASCII text", async () => {
  const terminal = createTerminal(6, 3);
  const app = render(
    <Box width={2}>
      <Text>👩‍💻AB</Text>
    </Box>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["👩‍💻", "AB", ""]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("word wrapping keeps words together and retains their nested styles", async () => {
  const terminal = createTerminal(12, 4);
  const app = render(
    <Box width={8}>
      <Text>
        hello{" "}
        <Text color="red" bold>
          world
        </Text>
      </Text>
    </Box>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["hello", "world", "", ""]);
    const cell = terminal.terminal.buffer.active.getLine(1)!.getCell(0)!;
    expect(cell.getFgColor()).toBe(1);
    expect(cell.isBold()).toBeTruthy();
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("a grapheme split across React children remains intact and occupies one column", async () => {
  const terminal = createTerminal(8, 2);
  const accent = "\u0301";
  const app = render(
    <Box gap={1}>
      <Text color="green">
        e<Text bold>{accent}</Text>中
      </Text>
      <Text>|</Text>
    </Box>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["é中 |", ""]);
    expect(terminal.terminal.buffer.active.getLine(0)!.getCell(4)!.getChars()).toBe("|");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("a full viewport clips excess content without scrolling after its bottom-right cell", async () => {
  const terminal = createTerminal(4, 3);
  const app = render(
    <Box flexDirection="column">
      <Text>{"AB中\n1234\n中文\nclipped"}</Text>
    </Box>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["AB中", "1234", "中文"]);
    expect(terminal.terminal.buffer.active.baseY).toBe(0);
    expect(terminal.cursor()).toEqual({ x: 0, y: 2 });
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("React state updates repaint text, styles and keyed box order, clearing old rows", async () => {
  const terminal = createTerminal(12, 7);
  let update = (_value: boolean) => {};
  function View() {
    const [short, setShort] = useState(false);
    useLayoutEffect(() => {
      update = setShort;
    }, []);
    return (
      <Box flexDirection="column" width={short ? 4 : 6} paddingLeft={short ? undefined : 1}>
        {(short ? ["b", "a"] : ["a", "b"]).map((key) => (
          <Box key={key}>
            <Text color={short ? undefined : "red"} bold={!short}>
              {key === "a" ? (short ? "A" : "中文ABCDEF") : "B"}
            </Text>
          </Box>
        ))}
        {!short && <Text>removed</Text>}
      </Box>
    );
  }
  const app = render(<View />, terminal);
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual([" 中文A", " BCDEF", " B", " remov", " ed", "", ""]);
    update(true);
    await terminal.waitFor(() => terminal.screen()[0] === "B");
    expect(terminal.screen()).toEqual(["B", "A", "", "", "", "", ""]);
    expect(terminal.terminal.buffer.active.getLine(1)!.getCell(0)!.isFgDefault()).toBeTruthy();
    expect(terminal.terminal.buffer.active.getLine(1)!.getCell(0)!.isBold()).toBeFalsy();
    expect(terminal.cursor()).toEqual({ x: 0, y: 2 });
    app.unmount();
    app.unmount();
    await app.waitUntilExit();
    update(false);
    await terminal.flush();
    expect(terminal.screen()).toEqual(["B", "A", "", "", "", "", ""]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("text styles survive nesting and wrapping without leaking to siblings", async () => {
  const terminal = createTerminal(12, 5);
  const app = render(
    <Box flexDirection="column" width={4}>
      <Text color="red" bold dimColor>
        A
        <Text color="blue" bold={false} dimColor={false}>
          中
        </Text>
        BC
      </Text>
      <Text color="#12ab34">D</Text>
      <Text>E</Text>
    </Box>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["A中B", "C", "D", "E", ""]);
    const buffer = terminal.terminal.buffer.active;
    const cell = (x: number, y: number) => buffer.getLine(y)!.getCell(x)!;
    expect(cell(0, 0).getFgColor()).toBe(1);
    expect(cell(0, 0).isBold()).toBeTruthy();
    expect(cell(0, 0).isDim()).toBeTruthy();
    expect(cell(1, 0).getFgColor()).toBe(4);
    expect(cell(1, 0).isBold()).toBeFalsy();
    expect(cell(1, 0).isDim()).toBeFalsy();
    expect(cell(3, 0).getFgColor()).toBe(1);
    expect(cell(0, 1).isBold()).toBeTruthy();
    expect(cell(0, 2).getFgColor()).toBe(0x12ab34);
    expect(cell(0, 3).isFgDefault()).toBeTruthy();
    expect(cell(1, 3).isBold()).toBeFalsy();
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("overwide text wraps by display columns or truncates without splitting wide characters", async () => {
  const terminal = createTerminal(12, 9);
  const app = render(
    <Box flexDirection="column" width={5}>
      <Text>AB中文Z</Text>
      <Text wrap="truncate">AB中文Z</Text>
      <Text>{"中AB\nCD中"}</Text>
      <Box width={1}>
        <Text>中文A</Text>
      </Box>
      <Text>{"12345\n"}</Text>
    </Box>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual([
      "AB中",
      "文Z",
      "AB中",
      "中AB",
      "CD中",
      "A",
      "12345",
      "",
      "",
    ]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("CJK characters and combining characters align adjacent flex columns", async () => {
  const terminal = createTerminal(18, 4);
  const app = render(
    <Box flexDirection="column">
      <Box gap={1}>
        <Text>中文A</Text>
        <Text>|</Text>
      </Box>
      <Box gap={1}>
        <Text>ABCDE</Text>
        <Text>|</Text>
      </Box>
      <Box gap={1}>
        <Text>é中AB</Text>
        <Text>|</Text>
      </Box>
    </Box>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["中文A |", "ABCDE |", "é中AB |", ""]);
    const buffer = terminal.terminal.buffer.active;
    expect(buffer.getLine(0)!.getCell(0)!.getWidth()).toBe(2);
    expect(buffer.getLine(0)!.getCell(1)!.getWidth()).toBe(0);
    for (let row = 0; row < 3; row++) expect(buffer.getLine(row)!.getCell(6)!.getChars()).toBe("|");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("grow, shrink, margin and gaps distribute terminal columns", async () => {
  const terminal = createTerminal(20, 6);
  const app = render(
    <Box flexDirection="column">
      <Box width={16} gap={1}>
        <Box width={4} marginLeft={1}>
          <Text>L</Text>
        </Box>
        <Box flexGrow={1}>
          <Text>R</Text>
        </Box>
        <Text>X</Text>
      </Box>
      <Box width={8}>
        <Box width={6} flexShrink={1}>
          <Text>A</Text>
        </Box>
        <Box width={6} flexShrink={1}>
          <Text>B</Text>
        </Box>
      </Box>
      <Box height={3} paddingX={2} paddingY={1}>
        <Text>P</Text>
      </Box>
    </Box>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen().slice(0, 5)).toEqual([" L    R        X", "A   B", "", "  P", ""]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});
