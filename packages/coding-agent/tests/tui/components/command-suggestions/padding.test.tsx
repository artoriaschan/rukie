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
const cases = [40, 80].flatMap((columns) => [
  { columns, selected: 0, footer: "↓10" },
  { columns, selected: 5, footer: "↑3 · ↓7" },
  { columns, selected: 14, footer: "↑10" },
]);
test.each(cases)(
  "suggestion padding fits candidate window $selected at $columns columns",
  async ({ columns, selected, footer }) => {
    const terminal = createTerminal(columns, 16);
    const app = renderComponent(
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
      </Box>,
      terminal,
    );
    try {
      await terminal.waitFor(() =>
        terminal.screen().some((line) => line.startsWith(`│ ${footer}`)),
      );
      const top = terminal.screen().findIndex((line) => line.startsWith("╭─ commands"));
      const card = terminal.screen().slice(top, top + 8);
      expect(card.every((line) => Bun.stringWidth(line) === columns)).toBe(true);
      expect(card.join("\n")).not.toContain("…");
      expect(card[6]).toBe(`│ ${footer}${" ".repeat(columns - 3 - Bun.stringWidth(footer))}│`);
      expect(card.some((line) => line.startsWith(`│ ❯ ${names[selected]} `))).toBe(true);
      expect(terminal.screen()[10]).toBe("prompt");
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
    }
  },
);
