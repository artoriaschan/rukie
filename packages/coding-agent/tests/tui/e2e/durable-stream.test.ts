import { expect, test } from "bun:test";
import { start } from "../helpers/app.ts";

test("committed streaming shows the final answer once and accepts the next input", async () => {
  const app = await start(["--permission-mode", "full-access", "native stream"], {
    columns: 100,
    rows: 28,
    env: { LANG: "en_US.UTF-8" },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1 && app.isWorking());
    app.calls[0]!.delta("NATIVE ");
    await Promise.resolve();
    app.calls[0]!.delta("FINAL");
    await app.waitFor(() => screen().includes("NATIVE FINAL"));
    app.calls[0]!.finish();
    await app.waitFor(() => screen().includes("NATIVE FINAL") && !app.isWorking());
    expect(screen().match(/NATIVE FINAL/g)).toHaveLength(1);
    app.stdin.write("continue\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(JSON.stringify(app.calls[1]!.context.messages)).toContain("NATIVE FINAL");
    app.calls[1]!.reply("NEXT ANSWER");
    await app.waitFor(() => screen().includes("NEXT ANSWER") && !app.isWorking());
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});
