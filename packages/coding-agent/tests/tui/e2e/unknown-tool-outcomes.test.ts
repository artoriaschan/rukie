import { expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { start } from "../helpers/app";
import { crashUnsafeEffect } from "../helpers/native-recovery";

test.each([
  ["zh_CN.UTF-8", 40, 12, "结果未知", "可能已产生副作用。", "重试前先核对实际状态。"],
  [
    "en_US.UTF-8",
    40,
    12,
    "Outcome unknown",
    "Side effects may have occurred.",
    "Verify actual state before retrying.",
  ],
  ["zh_CN.UTF-8", 80, 24, "结果未知", "可能已产生副作用。", "重试前先核对实际状态。"],
  [
    "en_US.UTF-8",
    80,
    24,
    "Outcome unknown",
    "Side effects may have occurred.",
    "Verify actual state before retrying.",
  ],
] as const)(
  "resume shows honest unknown Tool history in %s at %s×%s and accepts the next input",
  async (lang, columns, rows, unknown, effects, retry) => {
    const argv: string[] = [];
    let effectModifiedAt = 0;
    const app = await start(argv, {
      columns,
      rows,
      env: { LANG: lang },
      async prepare(root) {
        const crashed = await crashUnsafeEffect(root);
        const { sessionId } = crashed;
        effectModifiedAt = crashed.effectModifiedAt;
        argv.push("--resume", sessionId);
      },
    });
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      await app.waitFor(() => app.calls.length === 1);
      expect(JSON.stringify(app.calls[0]!.context.messages)).toContain("may have partially run");
      app.calls[0]!.reply("ready to verify");
      await app.waitFor(() => !app.isWorking());
      if (rows === 12) {
        app.resize(columns, 24);
        await app.waitFor(() =>
          app.screen().some((line) => /^\? (?:write|Write|写入)/.test(line.trimStart())),
        );
      }
      const row = app
        .screen()
        .findIndex((line) => /^\? (?:write|Write|写入)/.test(line.trimStart()));
      expect(row).toBeGreaterThanOrEqual(0);
      app.stdin.write(`\x1b[<0;3;${row + 1}M\x1b[<0;3;${row + 1}m`);
      await app.waitFor(() => app.screen().join("\n").includes(unknown));
      const history = app.screen().join("\n");
      expect(history).toContain(`⎿ ${unknown}`);
      expect(history).toContain(effects);
      expect(history).toContain(retry);
      expect(history).toMatch(/\? (?:write|Write|写入)/);
      expect(history).not.toContain("✗ write");
      expect(history).not.toContain("• write");
      expect(await Bun.file(`${app.root}/uncertain-effect.txt`).text()).toBe("saved effect");
      expect((await stat(`${app.root}/uncertain-effect.txt`)).mtimeMs).toBe(effectModifiedAt);
      if (rows === 12) {
        app.resize(columns, rows);
        await app.waitFor(() => app.screen().at(-3)?.includes("/128k") === true);
      }
      app.stdin.write("verify\r");
      await app.waitFor(() => app.calls.length === 2);
      expect(JSON.stringify(app.calls[1]!.context.messages)).toContain("may have partially run");
      app.calls[1]!.delta("ready to verify");
      app.calls[1]!.finish();
      await app.waitFor(
        () => app.allLines().join("\n").includes("ready to verify") && !app.isWorking(),
      );
      expect(app.screen()).toContain("❯");
      expect(app.stderr()).toBe("");
    } finally {
      await app.cleanup();
    }
  },
);
