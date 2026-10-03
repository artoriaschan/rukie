import { expect, test } from "bun:test";
import { Box, ThemedText, ThemeProvider, dark, render } from "@neant/tui";
import { UserMessage } from "../../../src/components/user-message";
import { createTerminal } from "../../helpers/terminal";

test("user prompts have bold distinct text, hanging indentation and a full light-gray background", async () => {
  const terminal = createTerminal(12, 6);
  const app = render(
    <ThemeProvider>
      <Box flexDirection="column">
        <UserMessage text={"abcdefghijk\n中é👩‍💻\n  code"} />
        <ThemedText>after</ThemedText>
      </Box>
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["❯ abcdefghi", "  jk", "  中é👩‍💻", "    code", "after", ""]);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 12; x++) {
        const cell = terminal.terminal.buffer.active.getLine(y)!.getCell(x)!;
        expect(cell.getBgColor()).toBe(0xd8dadd);
      }
    }
    const cell = terminal.terminal.buffer.active.getLine(0)!.getCell(2)!;
    expect(cell.getFgColor()).toBe(0x6b5221);
    expect(cell.isBold()).toBeTruthy();
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
    <ThemeProvider
      theme={{ ...dark, userPromptLabel: "#123456", userMessageBackground: "#abcdef" }}
    >
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
    expect(terminal.terminal.buffer.active.getLine(1)!.getCell(11)!.getBgColor()).toBe(0xabcdef);
    terminal.resize(18, 6);
    await terminal.waitFor(() => terminal.screen()[0] === "❯ abcdefghijk");
    expect(terminal.screen()[1]).toBe("after");
    expect(terminal.terminal.buffer.active.getLine(0)!.getCell(17)!.getBgColor()).toBe(0xabcdef);
    expect(terminal.terminal.buffer.active.getLine(1)!.getCell(17)!.isBgDefault()).toBe(true);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});
