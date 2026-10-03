import { expect, test } from "bun:test";
import { Box, ThemedText, ThemeProvider, dark, render } from "@neant/tui";
import { UserMessage } from "../../../src/components/user-message";
import { createTerminal } from "../../helpers/terminal";

test("user prompts match dsh's bold gold text, unfilled background and hanging indentation", async () => {
  const terminal = createTerminal(12, 6);
  const app = render(
    <ThemeProvider>
      <Box flexDirection="column">
        <UserMessage text={"abcdefghijk\n中é😀\n  code"} />
        <ThemedText>after</ThemedText>
      </Box>
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["❯ abcdefg", "  hijk", "  中é😀", "    code", "after", ""]);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 12; x++) {
        const cell = terminal.terminal.buffer.active.getLine(y)!.getCell(x)!;
        expect(cell.isBgDefault()).toBe(true);
      }
    }
    const cell = terminal.terminal.buffer.active.getLine(0)!.getCell(2)!;
    expect(cell.getFgColor()).toBe(0xffdf80);
    expect(cell.isBold()).toBeTruthy();
    const prefix = terminal.terminal.buffer.active.getLine(0)!.getCell(0)!;
    expect(prefix.getFgColor()).toBe(0xffdf80);
    expect(prefix.isBold()).toBeTruthy();
    expect(terminal.terminal.buffer.active.getLine(4)!.getCell(0)!.isBgDefault()).toBe(true);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("user prompts resolve provider colors and keep indentation when resized", async () => {
  const terminal = createTerminal(12, 6);
  const app = render(
    <ThemeProvider theme={{ ...dark, userPromptLabel: "#123456" }}>
      <Box flexDirection="column">
        <UserMessage text="abcdefghijk" />
        <ThemedText>after</ThemedText>
      </Box>
    </ThemeProvider>,
    { ...terminal, fullscreen: true },
  );
  try {
    await terminal.flush();
    expect(terminal.terminal.buffer.active.getLine(0)!.getCell(2)!.getFgColor()).toBe(0x123456);
    expect(terminal.terminal.buffer.active.getLine(1)!.getCell(11)!.isBgDefault()).toBe(true);
    terminal.resize(18, 6);
    await terminal.waitFor(() => terminal.screen()[0] === "❯ abcdefghijk");
    expect(terminal.screen()[1]).toBe("after");
    expect(terminal.terminal.buffer.active.getLine(0)!.getCell(17)!.isBgDefault()).toBe(true);
    expect(terminal.terminal.buffer.active.getLine(1)!.getCell(17)!.isBgDefault()).toBe(true);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});
