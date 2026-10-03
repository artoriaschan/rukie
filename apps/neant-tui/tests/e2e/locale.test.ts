import { expect, test } from "bun:test";
import { join } from "node:path";
import { start } from "../helpers/app";

test.each([
  [{ LANG: "en_US.UTF-8" }, undefined, "Ask", "Allow once", "Deny"],
  [{ LANG: "zh_CN.UTF-8" }, undefined, "询问", "允许（仅本次）", "拒绝"],
  [{ LANG: "C" }, undefined, "Ask", "Allow once", "Deny"],
  [{ LANG: "en_US.UTF-8" }, "zh-CN", "询问", "允许（仅本次）", "拒绝"],
  [{ LANG: "zh_CN.UTF-8" }, "en-GB", "Ask", "Allow once", "Deny"],
  [{ LANG: "zh_CN.UTF-8" }, "fr", "询问", "允许（仅本次）", "拒绝"],
  [{ LANG: "en", LC_MESSAGES: "zh", LC_ALL: "en" }, undefined, "Ask", "Allow once", "Deny"],
  [
    { LANG: "en", LC_MESSAGES: "zh", LC_ALL: "C.UTF-8" },
    undefined,
    "询问",
    "允许（仅本次）",
    "拒绝",
  ],
] as const)(
  "startup %j with locale %j renders %s permission UI",
  async (env, locale, mode, allow, deny) => {
    const app = await start(["permission"], {
      columns: 120,
      env,
      prepare: async (root) => {
        if (locale !== undefined)
          await Bun.write(join(root, ".neant/settings.json"), JSON.stringify({ locale }));
      },
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      expect(app.screen().at(-2)).toStartWith(` ${mode} ·`);
      app.stdin.write("\x1b[<35;2;23M");
      await app.waitFor(
        () =>
          app
            .screen()
            .at(-1)
            ?.includes(mode === "Ask" ? "Read-only tools" : "只读工具") === true,
      );
      app.calls[0]!.tool("bash", { command: "printf locale-test" });
      await app.waitFor(() => app.screen().some((line) => line.includes(`1. ${allow}`)));
      expect(app.screen().join("\n")).toContain(`3. ${deny}`);
      expect(app.screen().join("\n")).toContain(
        mode === "Ask"
          ? "2. Always allow this tool for this session"
          : "2. 本 session 内一直允许这个工具",
      );
    } finally {
      await app.cleanup();
    }
  },
);

test("project locale is ignored and startup locale stays fixed after env changes", async () => {
  const env = { LANG: "en_US.UTF-8" };
  const session: { homeDir?: string } = {};
  const app = await start([], {
    env,
    session,
    prepare: async (root) => {
      session.homeDir = join(root, "home");
      await Bun.write(join(root, ".neant/settings.json"), JSON.stringify({ locale: "zh" }));
    },
  });
  try {
    await app.waitFor(() => app.stdin.isRaw);
    expect(app.stderr()).toContain('ignoring "locale"');
    expect(app.screen().at(-2)).toStartWith(" Ask ·");
    env.LANG = "zh_CN.UTF-8";
    app.stdin.write("\x1b[Z");
    await app.waitFor(() => app.screen().at(-2)?.startsWith(" Auto review ·") === true);
    app.stdin.write("\x1b[Z");
    await app.waitFor(() => app.screen().at(-2)?.startsWith(" Full access ·") === true);
  } finally {
    await app.cleanup();
  }
});

test.each([
  [60, "Other tools need approval"],
  [120, "Read-only tools are allowed; other tools require approval"],
] as const)("English permission description fits at %s columns", async (columns, description) => {
  const app = await start([], { columns, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.stdin.isRaw);
    app.stdin.write("\x1b[<35;2;23M");
    await app.waitFor(() => app.screen().at(-1)?.includes(description) === true);
  } finally {
    await app.cleanup();
  }
});
