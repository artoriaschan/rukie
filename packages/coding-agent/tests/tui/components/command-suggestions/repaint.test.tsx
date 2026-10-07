import { expect, test } from "bun:test";
import { Box, Text } from "../../../../src/ink/index.ts";
import { CommandSuggestions } from "../../../../src/tui/components/command-suggestions";
import { renderComponent } from "../../helpers/render-component";
import { createTerminal } from "../../helpers/terminal";

const names = [
  "compact",
  "clear",
  "rewind",
  "goal",
  "plan",
  "help",
  "exit",
  "model",
  "context",
  "settings",
  "mcp",
  "rename",
  "resume",
  "btw",
  "jobs",
];

test.each([40, 80])(
  "suggestion card fills %s columns without truncating padding in its candidate windows",
  async (columns) => {
    const terminal = createTerminal(columns, 16);
    function Screen({ selected = 0 }: { selected?: number }) {
      return (
        <Box width={columns} height={16}>
          <Box position="absolute" top={10} height={1} width={columns}>
            <Text>prompt</Text>
            <CommandSuggestions
              items={names.map((name) => ({ name, description: "Description" }))}
              selected={selected}
              maxHeight={8}
              columns={columns}
              query="/"
              locale="en"
              planMode={false}
              onPick={() => {}}
              onWheel={() => {}}
            />
          </Box>
        </Box>
      );
    }
    const app = renderComponent(<Screen />, terminal);
    try {
      await terminal.waitFor(() => terminal.screen().some((line) => line.startsWith("│ ↓10")));
      const top = terminal.screen().findIndex((line) => line.startsWith("╭─ commands"));
      const card = terminal.screen().slice(top, top + 8);
      expect(card.every((line) => Bun.stringWidth(line) === columns)).toBe(true);
      expect(card.join("\n")).not.toContain("…");
      expect(card[6]).toMatch(/^│ ↓10\s+│$/);
      expect(terminal.screen()[10]).toBe("prompt");
      app.rerender(<Screen selected={14} />);
      await terminal.waitFor(() => terminal.screen().some((line) => line.startsWith("│ ❯ jobs ")));
      expect(terminal.screen()[top + 6]).toMatch(/^│ ↑10\s+│$/);
      app.rerender(<Screen selected={5} />);
      await terminal.waitFor(() => terminal.screen().some((line) => line.startsWith("│ ❯ help ")));
      expect(terminal.screen()[top + 6]).toMatch(/^│ ↑3 · ↓7\s+│$/);
      expect(
        terminal
          .screen()
          .slice(top, top + 8)
          .every((line) => Bun.stringWidth(line) === columns),
      ).toBe(true);
      expect(
        terminal
          .screen()
          .slice(top, top + 8)
          .join("\n"),
      ).not.toContain("…");
      expect(terminal.screen()[top]).toBe(card[0]);
      expect(terminal.screen()[top + 7]).toBe(card[7]);
      expect(terminal.screen()[10]).toBe("prompt");
      const beforeHover = terminal.screen().slice(top, top + 8);
      const row = top + 3;
      const background = terminal.terminal.buffer.active.getLine(row)!.getCell(4)!.getBgColor();
      terminal.stdin.write(`\x1b[<35;5;${row + 1}M`);
      await terminal.waitFor(
        () => terminal.terminal.buffer.active.getLine(row)!.getCell(4)!.getBgColor() !== background,
      );
      expect(terminal.screen().slice(top, top + 8)).toEqual(beforeHover);
      expect(terminal.screen()[10]).toBe("prompt");
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
    }
  },
);
