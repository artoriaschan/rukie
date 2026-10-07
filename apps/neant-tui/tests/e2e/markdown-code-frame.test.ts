import { expect, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";

test("assistant code frame fits beside the timeline after a second prompt", async () => {
  const app = await startWithClock(["history"], { columns: 80, rows: 24 });
  const frame = () => {
    const screen = app.screen();
    const top = screen.findIndex((line) => line.includes("┌─ code"));
    const bottom = screen.findIndex((line, index) => index > top && line.includes("└"));
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeGreaterThan(top);
    expect(screen[top]!.slice(0, app.stdout.columns - 2).endsWith("┐")).toBe(true);
    expect(screen[bottom]!.slice(0, app.stdout.columns - 2).endsWith("┘")).toBe(true);
    for (let row = top + 1; row < bottom; row++) {
      const buffer = app.terminal.buffer.active;
      expect(
        buffer
          .getLine(buffer.viewportY + row)!
          .getCell(app.stdout.columns - 3)!
          .getChars(),
      ).toBe("│");
    }
  };
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(
      Array.from({ length: 40 }, (_, i) => `history ${i}`).join("\n") +
        "\n\n## 仓库结构（Bun workspaces monorepo）\n\n```\napps/neant-cli/    @neant/neant-cli    非交互 argv/stdin\npackages/tui/    React reconciler + Yoga layout\n```\n\nNext paragraph",
    );
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("code prompt\r");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta("second response");
    app.calls[1]!.finish();
    await app.waitFor(
      () => !app.isWorking() && app.screen().some((line) => line.includes("Next paragraph")),
    );
    await app.waitFor(() => app.screen().some((line) => line.slice(-2) === "━━"));
    frame();
    for (const columns of [60, 81, 120, 121, 240, 241, 256]) {
      const before = app.output();
      app.resize(columns, 24);
      await app.waitFor(() => app.output() !== before);
      frame();
    }
  } finally {
    await app.cleanup();
  }
});

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
