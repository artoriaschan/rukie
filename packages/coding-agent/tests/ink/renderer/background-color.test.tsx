import { expect, test } from "bun:test";
import { useLayoutEffect, useState } from "react";
import { Box, Text, render } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

test("half-block foreground and background survive nesting and clear on transparent frames", async () => {
  const terminal = createTerminal(10, 4);
  let clear = () => {};
  function View() {
    const [transparent, setTransparent] = useState(false);
    useLayoutEffect(() => {
      clear = () => setTransparent(true);
    }, []);
    return (
      <Box flexDirection="column">
        <Text
          color="#123456"
          backgroundColor={transparent ? undefined : "#abcdef"}
          preserveWhitespace
        >
          ▀<Text color="#fedcba">▄</Text>{" "}
        </Text>
        <Text>metadata</Text>
      </Box>
    );
  }
  const app = render(<View />, terminal);
  const cell = (x: number, y: number) => terminal.terminal.buffer.active.getLine(y)!.getCell(x)!;
  try {
    await terminal.flush();
    expect(cell(0, 0).getFgColor()).toBe(0x123456);
    expect(cell(0, 0).getBgColor()).toBe(0xabcdef);
    expect(cell(1, 0).getFgColor()).toBe(0xfedcba);
    expect(cell(1, 0).getBgColor()).toBe(0xabcdef);
    expect(cell(2, 0).getBgColor()).toBe(0xabcdef);
    expect(cell(0, 1).isBgDefault()).toBe(true);
    clear();
    await terminal.waitFor(() => cell(0, 0).isBgDefault());
    expect(cell(1, 0).isBgDefault()).toBe(true);
    expect(cell(2, 0).isBgDefault()).toBe(true);
    expect(cell(0, 1).isBgDefault()).toBe(true);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("NO_COLOR suppresses both planes of a colored half-block", async () => {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  const terminal = createTerminal(4, 2);
  const app = render(
    <Text color="#123456" backgroundColor="#abcdef">
      ▀
    </Text>,
    terminal,
  );
  try {
    await terminal.flush();
    const cell = terminal.terminal.buffer.active.getLine(0)!.getCell(0)!;
    expect(cell.getChars()).toBe("▀");
    expect(cell.isFgDefault()).toBe(true);
    expect(cell.isBgDefault()).toBe(true);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
});
