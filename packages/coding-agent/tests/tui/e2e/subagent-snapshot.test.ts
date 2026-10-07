import { expect, test } from "bun:test";
import { start } from "../helpers/app";

test("parent committed snapshots retain an observed settled sibling beside a running child", async () => {
  const app = await start(["delegate"], { columns: 100, rows: 30, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools([
      { name: "subagent", args: { description: "Finished sibling", prompt: "sibling finished" } },
      { name: "subagent", args: { description: "Live sibling", prompt: "sibling live" } },
    ]);
    await app.waitFor(() => app.calls.length === 4);
    const finished = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("sibling finished"),
      ),
    )!;
    finished.reply("child finished");
    await app.waitFor(() => app.screen().some((line) => /Subagents 1\/2/.test(line)));
    expect(app.screen().some((line) => line.includes("Finished sibling"))).toBe(true);
    expect(app.screen().some((line) => line.includes("Live sibling"))).toBe(true);
  } finally {
    await app.cleanup();
  }
});
