import { expect, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";

test("assistant code blocks retain all four borders through streaming and resize", async () => {
  const app = await startWithClock(["code frame"], { columns: 80, rows: 50 });
  const source = 'const message = "中文🐋";\n' + "x".repeat(110) + "TAIL";
  const framed = (width: number) => {
    const screen = app.screen();
    const top = screen.findIndex((line) => line.includes("┌─ ts"));
    const bottom = screen.findIndex((line, index) => index > top && line.includes("└"));
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeGreaterThan(top + 1);
    expect(screen[top]!.endsWith("┐")).toBe(true);
    expect(screen[bottom]!.endsWith("┘")).toBe(true);
    for (const line of screen.slice(top + 1, bottom)) {
      expect(line.startsWith("  │")).toBe(true);
      expect(line.endsWith("│")).toBe(true);
      expect(Bun.stringWidth(line)).toBe(width);
    }
    expect(
      screen
        .slice(top + 1, bottom)
        .map((line) => line.slice(4, -2))
        .join(""),
    ).toContain("TAIL");
    expect(screen.join("\n")).not.toContain("�");
  };
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("```ts\n" + source);
    await app.waitFor(() => app.screen().some((line) => line.includes("TAIL")));
    framed(80);
    app.calls[0]!.delta("\n```\n\nNext paragraph");
    app.calls[0]!.finish();
    await app.waitFor(
      () => !app.isWorking() && app.screen().some((line) => line.includes("Next paragraph")),
    );
    framed(80);
    const before = app.output();
    app.resize(40, 50);
    await app.waitFor(() => app.output() !== before);
    framed(40);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});
