import { expect, test } from "bun:test";
import { Box, Text, render, useTerminalSize } from "../../src";
import { createTerminal } from "../helpers/terminal";

test("resizing narrower, shorter and wider reflows content and clears the old viewport", async () => {
  const terminal = createTerminal(16, 6);
  function View() {
    const { columns, rows } = useTerminalSize();
    return (
      <Box flexDirection="column">
        <Text>
          {columns}x{rows}
        </Text>
        <Text>中文ABCDEF</Text>
      </Box>
    );
  }
  const app = render(<View />, terminal);
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["16x6", "中文ABCDEF", "", "", "", ""]);
    terminal.resize(6, 4);
    await terminal.waitFor(() => terminal.screen()[0] === "6x4");
    expect(terminal.screen()).toEqual(["6x4", "中文AB", "CDEF", ""]);
    expect(terminal.cursor()).toEqual({ x: 0, y: 3 });
    terminal.resize(20, 7);
    await terminal.waitFor(() => terminal.screen()[0] === "20x7");
    expect(terminal.screen()).toEqual(["20x7", "中文ABCDEF", "", "", "", "", ""]);
    expect(terminal.cursor()).toEqual({ x: 0, y: 2 });
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("a resize event repaints even when dimensions are unchanged", async () => {
  const terminal = createTerminal(10, 4);
  const app = render(<Text>clean</Text>, terminal);
  try {
    await terminal.flush();
    terminal.stdout.write("\x1b[3;1Hresidue");
    await terminal.flush();
    terminal.resize(10, 4);
    await terminal.flush();
    expect(terminal.screen()).toEqual(["clean", "", "", ""]);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});
