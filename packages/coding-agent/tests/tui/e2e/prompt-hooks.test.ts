import { expect, test } from "bun:test";
import { start } from "../helpers/app";

test.each([
  ["zh_CN.UTF-8", "Hook 已拦截提示词"],
  ["en_US.UTF-8", "Prompt blocked by hook"],
])("%s shows the rejected prompt reason and returns to idle", async (lang, label) => {
  const app = await start(["private prompt"], {
    env: { LANG: lang },
    session: {
      settings: {
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: "command",
                  command: `echo '{"decision":"block","reason":"secret rejected"}'`,
                },
              ],
            },
          ],
        },
      },
    },
  });
  try {
    await app.waitFor(
      () => app.allLines().join("\n").includes("secret rejected") && !app.isWorking(),
    );
    expect(app.allLines().join("\n")).toContain(label!);
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});
