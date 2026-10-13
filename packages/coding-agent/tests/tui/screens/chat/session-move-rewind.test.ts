import { expect, test } from "bun:test";
import { createSession, moveSession, type SessionOptions } from "@rukie/agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { auxiliaryModels } from "../../helpers/auxiliary-model.ts";
import { start } from "../../helpers/app.ts";

test.each([
  [80, 24, "en_US.UTF-8"],
  [40, 12, "zh_CN.UTF-8"],
] as const)(
  "moved Session disables code restore in terminal (%i×%i %s)",
  async (columns, rows, lang) => {
    const argv: string[] = [];
    const options: Partial<SessionOptions> = {};
    const app = await start(argv, {
      session: options,
      columns,
      rows,
      env: { LANG: lang },
      prepare: async (root) => {
        const dataRoot = join(root, "data");
        const target = join(root, "target");
        await mkdir(target);
        const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
        faux.setResponses([
          fauxAssistantMessage(fauxToolCall("write", { path: "old.txt", content: "keep" }), {
            stopReason: "toolUse",
          }),
          fauxAssistantMessage("old answer"),
        ]);
        const seed = await createSession({
          cwd: root,
          homeDir: root,
          dataRoot,
          model: faux.getModel(),
          models: auxiliaryModels(faux.provider.streamSimple),
          permissionMode: "full-access",
        });
        try {
          await seed.run("old prompt");
        } finally {
          await seed.close();
        }
        await moveSession({ cwd: root, homeDir: root, dataRoot, id: seed.id, newCwd: target });
        argv.push("--resume", seed.id);
        Object.assign(options, { cwd: target, dataRoot, resumeId: seed.id });
      },
    });
    try {
      await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
      app.stdin.write("/rewind\r");
      await app.waitFor(() => app.screen().join("\n").includes("old prompt"));
      app.stdin.write("\r");
      const reason = lang.startsWith("zh")
        ? "会话已移动，无法恢复代码"
        : "Session moved; code restore disabled";
      await app.waitFor(() => app.screen().join("\n").includes(reason));
      app.stdin.write("\x1b[B");
      await app.flush();
      expect(app.screen().join("\n")).not.toMatch(/❯ Restore code|❯ 还原代码/);
      const disabledRow = app
        .screen()
        .findIndex((line) => line.trim() === (lang.startsWith("zh") ? "还原代码" : "Restore code"));
      expect(disabledRow).toBeGreaterThanOrEqual(0);
      app.stdin.write(`\x1b[<0;5;${disabledRow + 1}M\x1b[<0;5;${disabledRow + 1}m`);
      await app.flush();
      expect(app.screen().join("\n")).toContain(reason);
      app.stdin.write("\r");
      await app.waitFor(() =>
        app
          .screen()
          .join("\n")
          .includes(lang.startsWith("zh") ? "已回退" : "Rewound"),
      );
      expect(await Bun.file(join(app.root, "old.txt")).text()).toBe("keep");
    } finally {
      await app.cleanup();
    }
  },
);
