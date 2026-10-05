import { expect, test } from "bun:test";
import { start } from "../../helpers/app";

for (const [lang, error] of [
  ["zh_CN.UTF-8", "会话标题不能为空"],
  ["en_US.UTF-8", "Session Title cannot be empty."],
] as const)
  test(`a control-only rename uses ${lang} and preserves the title`, async () => {
    const app = await start([], { env: { LANG: lang } });
    try {
      await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
      app.stdin.write("/rename Chosen title\r");
      await app.waitFor(() => app.output().includes("\x1b]0;✦ Chosen title\x07"));
      app.stdin.write("/rename \u009f\r");
      await app.waitFor(() => app.screen().some((line) => line.includes(error)));
      expect(app.calls).toHaveLength(0);
      app.stdin.write("/rename\r");
      await app.waitFor(() => app.screen().some((line) => line.includes("/rename Chosen title")));
    } finally {
      await app.cleanup();
    }
  });

test("rename pre-fills the current title and changes it during a Run without another prompt", async () => {
  const app = await start(["Repair login"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/rename \r");
    await app.waitFor(() => app.screen().some((line) => line.includes("/rename Test session")));
    app.stdin.write("\x7f".repeat("/rename Test session".length));
    await app.waitFor(() => !app.screen().some((line) => line.includes("/rename Test session")));
    app.stdin.write("/rename Login repair\r");
    await app.waitFor(
      () => app.output().includes("\x1b]0;") && app.output().includes("Login repair\x07"),
    );
    expect(app.calls).toHaveLength(1);
    expect(app.calls[0]!.signal?.aborted).toBe(false);
    app.calls[0]!.finish();
    await app.waitFor(() => app.output().includes("\x1b]0;✦ Login repair\x07"));
  } finally {
    await app.cleanup();
  }
});

test("a held title request has its own queue and rename aborts it without interrupting the Run", async () => {
  const app = await start(["Inspect authentication"], { controlTitles: true });
  try {
    await app.waitFor(() => app.calls.length === 1 && app.titles.length === 1);
    expect(app.output()).toContain("Inspect authentication\x07");
    app.stdin.write("/rename Authentication review\r");
    await app.waitFor(() => app.titles[0]!.signal?.aborted === true);
    expect(app.calls).toHaveLength(1);
    expect(app.calls[0]!.signal?.aborted).toBe(false);
    app.calls[0]!.finish();
    await app.waitFor(() => app.output().includes("\x1b]0;✦ Authentication review\x07"));
  } finally {
    await app.cleanup();
  }
});
