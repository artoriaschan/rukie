import { expect, test } from "bun:test";
import { useLayoutEffect, useState } from "react";
import { AlternateScreen, Box, Text, renderSync } from "../../../src/ink";
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
        <Text color="#123456" backgroundColor={transparent ? undefined : "#abcdef"}>
          ▀<Text color="#fedcba">▄</Text>{" "}
        </Text>
        <Text>metadata</Text>
      </Box>
    );
  }
  const app = renderSync(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
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
    app.cleanup();
    terminal.dispose();
  }
});
