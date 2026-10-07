import { expect, test } from "bun:test";
import { dark, render, ThemeProvider } from "../../../../src/ink/index.ts";
import { ActivityLine } from "../../../../src/tui/components/activity-line";
import { createTerminal } from "../../helpers/terminal";

for (const [warnPct, color] of [
  [79, undefined],
  [80, dark.warning],
  [95, dark.error],
] as const) {
  test(`activity context pressure at ${warnPct}% uses the threshold color`, async () => {
    const terminal = createTerminal(80, 3);
    const app = render(
      <ThemeProvider>
        <ActivityLine phase="thinking" line="脑子在冒烟" suffix=" · tokens" warnPct={warnPct} />
      </ThemeProvider>,
      terminal,
    );
    try {
      await terminal.flush();
      const line = terminal.screen()[0]!;
      if (color) {
        expect(line).toContain(`⚠ 上下文 ${warnPct}% · 脑子在冒烟`);
        expect(terminal.terminal.buffer.active.getLine(0)!.getCell(3)!.getFgColor()).toBe(
          Number.parseInt(color.slice(1), 16),
        );
      } else expect(line).not.toContain("⚠ 上下文");
      expect(terminal.screen().slice(1)).toEqual(["", ""]);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
    }
  });
}

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
