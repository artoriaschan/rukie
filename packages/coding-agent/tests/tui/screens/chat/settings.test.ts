import { expect, test } from "bun:test";
import { start } from "../../helpers/app";

const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");

test.each([
  {
    lang: "en_US.UTF-8",
    empty: "No settings are available yet.",
    title: "Settings",
    exit: "Esc exit",
  },
  { lang: "zh_CN.UTF-8", empty: "暂无可配置的设置项。", title: "设置", exit: "Esc 退出" },
])(
  "/settings opens a fullscreen empty page and Escape restores the conversation: $lang",
  async ({ lang, empty, title, exit }) => {
    const app = await start([], { env: { LANG: lang } });
    try {
      await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
      app.stdin.write("remember this question\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.delta("remember this answer");
      app.calls[0]!.finish();
      await app.waitFor(() => !app.isWorking());
      app.stdin.write("/settings\r");
      await app.waitFor(() => screen(app).includes(empty));
      expect(app.screen()[0]).toBe(title);
      expect(app.screen().at(-1)).toContain(exit);
      expect(app.screen().at(-3)).toMatch(/^─+$/);
      expect(screen(app)).not.toContain("remember this answer");
      expect(screen(app)).not.toContain("Ask ·");
      app.stdin.write("\x1b[A\x1b[B\x1b[C\x1b[D\r");
      await app.waitFor(() => screen(app).includes(empty));
      expect(app.calls).toHaveLength(1);
      app.stdin.write("\x1b");
      await app.waitFor(() => screen(app).includes("remember this answer"));
      expect(screen(app)).not.toContain(empty);
      app.stdin.write("next question\r");
      await app.waitFor(() => app.calls.length === 2);
      expect(JSON.stringify(app.calls[1]!.context)).toContain("remember this question");
      expect(JSON.stringify(app.calls[1]!.context)).not.toContain("/settings");
      app.calls[1]!.finish();
      await app.waitFor(() => !app.isWorking());
    } finally {
      if (
        screen(app).includes("No settings are available yet.") ||
        screen(app).includes("暂无可配置的设置项。")
      ) {
        app.stdin.write("\x1b");
        await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
      }
      await app.cleanup();
    }
  },
);

test("the empty settings page fits 40×12, ignores editing keys and leaves settings unchanged", async () => {
  const original = '{"locale":"en"}';
  const app = await start([], {
    columns: 40,
    rows: 12,
    prepare: (root) => Bun.write(`${root}/.rukie/settings.json`, original).then(() => {}),
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/settings\rhidden draft");
    await app.waitFor(() => screen(app).includes("No settings are available yet."));
    expect(app.screen()[0]).toBe("Settings");
    expect(app.screen().at(-1)).toContain("Enter open/toggle · Esc exit");
    expect(app.screen().at(-3)).toBe("─".repeat(40));
    expect(app.screen().at(-2)).toBe("");
    expect(
      app.terminal.buffer.active
        .getLine(app.terminal.buffer.active.viewportY + 11)!
        .getCell(40 - Bun.stringWidth("Enter open/toggle · Esc exit"))!
        .isBold(),
    ).toBeTruthy();
    expect(screen(app)).not.toContain("1/0");
    expect(
      app.terminal.buffer.active
        .getLine(app.terminal.buffer.active.viewportY + 1)!
        .getCell(0)!
        .isDim(),
    ).toBeTruthy();
    app.stdin.write("\x1b[A\x1b[B\x1b[C\x1b[D\r");
    await app.waitFor(() => screen(app).includes("No settings are available yet."));
    expect(await Bun.file(`${app.root}/.rukie/settings.json`).text()).toBe(original);
    app.stdin.write("\x1b");
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    expect(screen(app)).not.toContain("hidden draft");
    expect(app.calls).toHaveLength(0);
  } finally {
    if (
      screen(app).includes("No settings are available yet.") ||
      screen(app).includes("暂无可配置的设置项。")
    ) {
      app.stdin.write("\x1b");
      await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    }
    await app.cleanup();
  }
});

test("/settings during a Run reports its availability without opening the screen", async () => {
  const app = await start([], { env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("work\r");
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/settings\r");
    await app.waitFor(() => screen(app).includes("Use /settings after the run finishes"));
    expect(screen(app)).not.toContain("No settings are available yet.");
    expect(app.calls).toHaveLength(1);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    if (
      screen(app).includes("No settings are available yet.") ||
      screen(app).includes("暂无可配置的设置项。")
    ) {
      app.stdin.write("\x1b");
      await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    }
    await app.cleanup();
  }
});
