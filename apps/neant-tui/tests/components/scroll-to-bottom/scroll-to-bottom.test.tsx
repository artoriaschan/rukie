import { expect, test } from "bun:test";
import { Box, ThemedText, ThemeProvider, render } from "@neant/tui";
import { ScrollToBottom } from "../../../src/components";
import { createTerminal } from "../../helpers/terminal";

test.each([
  [80, 28, false],
  [60, 18, false],
  [40, 8, false],
  [80, 22, true],
  [60, 12, true],
  [40, 2, true],
] as const)(
  "return button is centered at %s columns with a blank row above and dsh badge colors",
  async (columns, left, unread) => {
    const terminal = createTerminal(columns, 4);
    let clicks = 0;
    const app = render(
      <ThemeProvider>
        <Box flexDirection="column">
          <ScrollToBottom columns={columns} unread={unread} onClick={() => clicks++} />
          <ThemedText>input below</ThemedText>
        </Box>
      </ThemeProvider>,
      { ...terminal, fullscreen: true },
    );
    try {
      await terminal.flush();
      expect(terminal.screen()[0]).toBe("");
      expect(terminal.screen()[1]).toBe(
        " ".repeat(left) +
          (unread ? " ↓ 有新输出 · 回到底部（Ctrl+End）" : " ↓ 回到底部（Ctrl+End）"),
      );
      expect(terminal.screen()[2]).toBe("input below");
      const row = terminal.terminal.buffer.active.getLine(1)!;
      expect(row.getCell(left + 1)!.getBgColor()).toBe(0x5e88cc);
      expect(row.getCell(left + 1)!.getFgColor()).toBe(0x22262e);
      expect(row.getCell(left + 1)!.isBold()).toBeTruthy();
      expect(row.getCell(left - 1)!.getBgColorMode()).toBe(0);
      terminal.stdin.write(`\x1b[<35;${left + 2};2M`);
      await terminal.waitFor(() => row.getCell(left + 1)!.getBgColor() === 0x3b5bdb);
      terminal.stdin.write(`\x1b[<0;${left + 2};2M\x1b[<0;${left + 2};2m`);
      expect(clicks).toBe(1);
      terminal.stdin.write("\x1b[<35;1;4M");
      await terminal.waitFor(() => row.getCell(left + 1)!.getBgColor() === 0x5e88cc);
    } finally {
      app.unmount();
      terminal.dispose();
    }
  },
);
