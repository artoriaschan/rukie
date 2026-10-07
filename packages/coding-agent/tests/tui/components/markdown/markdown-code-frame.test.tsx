import { expect, test } from "bun:test";
import { Box, render } from "../../../../src/ink";
import { Markdown } from "../../../../src/tui/components/markdown";
import { createTerminal } from "../../../ink/helpers/terminal";

test("a code frame uses its containing width and clips an oversized language label", async () => {
  const terminal = createTerminal(80, 12);
  const app = render(
    <Box width={24} flexDirection="column">
      <Markdown text={"```" + "language".repeat(8) + "\n" + "界🐋".repeat(12) + "TAIL\n```"} />
    </Box>,
    terminal,
  );
  try {
    await terminal.flush();
    const lines = terminal.screen().filter(Boolean);
    expect(lines[0]!.startsWith("┌─")).toBe(true);
    expect(lines[0]!.endsWith("┐")).toBe(true);
    expect(lines.at(-1)!.startsWith("└")).toBe(true);
    expect(lines.at(-1)!.endsWith("┘")).toBe(true);
    for (const line of lines) expect(Bun.stringWidth(line)).toBe(24);
    for (const line of lines.slice(1, -1)) {
      expect(line.startsWith("│")).toBe(true);
      expect(line.endsWith("│")).toBe(true);
    }
    expect(lines.join("\n")).toContain("TAIL");
    expect(lines.join("\n")).not.toContain("�");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});
