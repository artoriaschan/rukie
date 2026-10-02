import { expect, test } from "bun:test";
import { dark, render, ThemeProvider } from "@neant/tui";
import { ActivityLine } from "../../../src/components/activity-line";
import { createTerminal } from "../../helpers/terminal";

test("activity paints a moon, bold text and subtle suffix on one truncated line", async () => {
  const terminal = createTerminal(22, 3);
  const app = render(
    <ThemeProvider>
      <ActivityLine phase="thinking" line="脑子在冒烟" suffix=" · ↑ 8 · ↓ 4 tokens" />
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    const line = terminal.screen()[0]!;
    expect(line).toMatch(/^[🌑🌒🌓🌔🌕🌖🌗🌘] 脑子在冒烟/u);
    expect(line).toEndWith("…");
    expect(terminal.screen().slice(1)).toEqual(["", ""]);
    const row = terminal.terminal.buffer.active.getLine(0)!;
    expect(row.getCell(3)!.isBold()).toBeTruthy();
    expect(row.getCell(14)!.getFgColor()).toBe(Number.parseInt(dark.subtle.slice(1), 16));
    expect(row.getCell(14)!.isBold()).toBeFalsy();
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("done paints accent text without a moon or animation", async () => {
  const terminal = createTerminal(80, 3);
  const app = render(
    <ThemeProvider>
      <ActivityLine phase="done" line="齐活 · 1 工具" suffix=" · ↑ 11 · ↓ 5 tokens" />
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()[0]).toBe("齐活 · 1 工具 · ↑ 11 · ↓ 5 tokens");
    const cell = terminal.terminal.buffer.active.getLine(0)!.getCell(0)!;
    expect(cell.getFgColor()).toBe(Number.parseInt(dark.accent.slice(1), 16));
    const output = terminal.output();
    await Bun.sleep(150);
    await terminal.flush();
    expect(terminal.output()).toBe(output);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});
