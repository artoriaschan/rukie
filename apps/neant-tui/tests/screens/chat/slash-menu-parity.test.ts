import { expect, test } from "bun:test";
import { join } from "node:path";
import { dark } from "@neant/tui";
import { start } from "../../helpers/app";

type App = Awaited<ReturnType<typeof start>>;
const text = (app: App) => app.screen().join("\n");
const selected = (app: App, name: string) =>
  app.screen().some((row) => row.startsWith(`│ ❯ ${name} `));
const cell = (app: App, x: number, y: number) => app.terminal.buffer.active.getLine(y)!.getCell(x)!;
const color = (value: string) => parseInt(value.slice(1), 16);
async function ready(options: Parameters<typeof start>[1] = {}) {
  const app = await start([], { rows: 32, env: { LANG: "en_US.UTF-8" }, ...options });
  await app.waitFor(() => app.screen().some((row) => row.startsWith("╭")));
  return app;
}

test("slash card floats above the composer without moving the transcript and centers five candidates", async () => {
  const app = await ready();
  try {
    app.stdin.write("work\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(Array.from({ length: 45 }, (_, i) => `line ${i}`).join("\n"));
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking() && text(app).includes("line 44"));
    const before = app.screen();
    app.stdin.write("/");
    await app.waitFor(() => text(app).includes("╭─ commands · 14 items "));
    const top = app.screen().findIndex((row) => row.startsWith("╭─ commands"));
    expect(app.screen().slice(0, top)).toEqual(before.slice(0, top));
    expect(
      app
        .screen()
        .slice(top + 1, top + 6)
        .map((row) => /^│ (?:❯ |  )(\S+)/u.exec(row)?.[1]),
    ).toEqual(["compact", "clear", "rewind", "goal", "plan"]);
    expect(app.screen()[top + 6]).toMatch(/^│ ↓9\s+│$/);
    expect(app.screen()[top + 7]).toBe(`╰${"─".repeat(78)}╯`);
    expect(app.screen()[top + 8]).toBe(`╭${"─".repeat(78)}╮`);
    expect(selected(app, "compact")).toBe(true);
    expect(cell(app, 3, top + 1).isBold()).toBeTruthy();
    expect(cell(app, 3, top + 1).getFgColor()).toBe(color(dark.suggestion));
    expect(cell(app, 25, top + 1).isBold()).toBeFalsy();
    expect(cell(app, 25, top + 1).getFgColor()).toBe(color(dark.suggestion));
    expect(cell(app, 5, top + 2).getFgColor()).toBe(color(dark.inactive));
    expect(cell(app, 5, top + 2).isDim()).toBeFalsy();
    expect(cell(app, 0, top).getFgColor()).toBe(color(dark.promptBorder));
    app.stdin.write("\x1b[B\x1b[B\x1b[B");
    await app.waitFor(() => selected(app, "goal"));
    expect(app.screen()[top + 1]).toMatch(/^│   clear /);
    expect(app.screen()[top + 3]).toMatch(/^│ ❯ goal /);
    expect(app.screen()[top + 6]).toMatch(/^│ ↑1 · ↓8\s+│$/);
    app.stdin.write("\x1b");
    await app.waitFor(() => !text(app).includes("commands ·"));
    expect(app.screen()).toEqual(before.map((row) => (row === "❯" ? "❯ /" : row)));
  } finally {
    await app.cleanup();
  }
});

test("filtered names highlight their matching prefix and Tab completes without executing", async () => {
  const app = await ready();
  try {
    app.stdin.write("/C");
    await app.waitFor(() => text(app).includes("commands · 3 items"));
    const y = app.screen().findIndex((row) => row.startsWith("│   clear "));
    expect(cell(app, 4, y).getFgColor()).toBe(color(dark.text));
    expect(cell(app, 5, y).getFgColor()).toBe(color(dark.inactive));
    app.stdin.write("\x1b[B\t");
    await app.waitFor(() => !text(app).includes("commands ·"));
    expect(app.screen()).toContain("❯ /clear");
    expect(app.terminal.buffer.active.cursorX).toBe(9);
    expect(app.calls).toHaveLength(0);
    app.stdin.write("\x03/HE\r");
    await app.waitFor(() => text(app).includes("Slash commands and skills"));
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("a recalled slash input keeps arrows in history until the saved draft is restored", async () => {
  const app = await ready({
    prepare: async (root) => {
      await Bun.write(
        join(root, ".agents/skills/check/SKILL.md"),
        "---\nname: check\ndescription: Inspect work\n---\nInspect.",
      );
    },
  });
  try {
    app.stdin.write("/check\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("saved draft\x1b[A");
    await app.waitFor(() => app.screen().includes("❯ /check"));
    app.stdin.write("\x1b[B");
    await app.waitFor(() => app.screen().includes("❯ saved draft"));
    expect(text(app)).not.toContain("commands ·");
    app.stdin.write("\x03/");
    await app.waitFor(() => text(app).includes("commands · 15 items"));
    app.stdin.write("\x1b");
    await app.waitFor(() => !text(app).includes("commands ·"));
    app.stdin.write("\x1b[A");
    await app.waitFor(() => selected(app, "check"));
    app.stdin.write("\x1b[B");
    await app.waitFor(() => text(app).includes("commands · 15 items"));
    expect(selected(app, "compact")).toBe(true);
  } finally {
    await app.cleanup();
  }
});

test("mouse wheel clamps selection and hover/click use the visible window's absolute index", async () => {
  const app = await ready();
  try {
    app.stdin.write("/");
    await app.waitFor(() => text(app).includes("commands ·"));
    const top = app.screen().findIndex((row) => row.startsWith("╭─ commands"));
    const wheel = (down: boolean, count = 1) =>
      app.stdin.write(`\x1b[<${down ? 65 : 64};8;${top + 3}M`.repeat(count));
    wheel(false);
    await app.flush();
    expect(selected(app, "compact")).toBe(true);
    wheel(true, 40);
    await app.waitFor(() => selected(app, "rename"));
    wheel(false, 8);
    await app.waitFor(() => selected(app, "help"));
    const y = app.screen().findIndex((row) => row.startsWith("│   exit "));
    app.stdin.write(`\x1b[<35;8;${y + 1}M`);
    await app.waitFor(() => cell(app, 8, y).getBgColor() === color(dark.badgeHoverBackground));
    expect(selected(app, "help")).toBe(true);
    wheel(true, 3);
    await app.waitFor(() => selected(app, "resume"));
    expect(app.screen()[y]).toMatch(/^│   context /);
    expect(cell(app, 8, y).getBgColor()).toBe(color(dark.badgeHoverBackground));
    wheel(false, 3);
    await app.waitFor(() => selected(app, "help"));
    const helpY = app.screen().findIndex((row) => row.startsWith("│ ❯ help "));
    app.stdin.write(`\x1b[<0;8;${helpY + 1}M\x1b[<0;8;${helpY + 1}m`);
    await app.waitFor(() => text(app).includes("Slash commands and skills"));
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("the command menu owns Shift+Tab and keeps Plan Mode borders aligned with the input", async () => {
  const app = await ready();
  try {
    app.stdin.write("/plan\r");
    await app.waitFor(() => app.screen().at(-2)!.includes("plan"));
    app.stdin.write("/");
    await app.waitFor(() => text(app).includes("commands ·"));
    const y = app.screen().findIndex((row) => row.startsWith("╭─ commands"));
    expect(cell(app, 0, y).getFgColor()).toBe(color(dark.plan));
    const status = app.screen().slice(-2);
    app.stdin.write("\x1b[Z");
    await app.flush();
    expect(app.screen().slice(-2)).toEqual(status);
    expect(selected(app, "compact")).toBe(true);
  } finally {
    await app.cleanup();
  }
});

test("Chinese titles, long skill names and descriptions stay inside the card at 40 by 12", async () => {
  const app = await ready({
    columns: 40,
    rows: 12,
    env: { LANG: "zh_CN.UTF-8" },
    prepare: async (root) => {
      await Bun.write(
        join(root, ".agents/skills", "very-long-skill-command-name", "SKILL.md"),
        "---\nname: very-long-skill-command-name\ndescription: 检查中文说明与非常长的命令名称是否正确显示，不应覆盖右侧边框\n---\nInspect.\n",
      );
    },
  });
  try {
    app.stdin.write("/");
    await app.waitFor(() => text(app).includes("╭─ 命令 · 共 15 项 "));
    app.stdin.write("\x1b[A");
    await app.waitFor(() => text(app).includes("❯ very-long"));
    const card = app.screen().filter((row) => /^[╭╰│]/u.test(row));
    expect(card.every((row) => Bun.stringWidth(row) === 40)).toBe(true);
    expect(app.screen()).toContain("❯ /");
    app.resize(80, 24);
    await app.waitFor(() =>
      app
        .screen()
        .some(
          (row) =>
            row.startsWith("│ ❯ very-long-skill-command-name") && Bun.stringWidth(row) === 80,
        ),
    );
    expect(
      app
        .screen()
        .some((row) => row.startsWith("│ ❯ very-long-skill-command-name") && row.endsWith("│")),
    ).toBe(true);
    expect(text(app)).toContain("[skill]");
    expect(text(app)).toContain("…");
    app.resize(39, 11);
    await app.waitFor(() => !text(app).includes("共 15 项"));
  } finally {
    await app.cleanup();
  }
});
