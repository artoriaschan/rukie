import { afterEach, expect, test } from "bun:test";
import { startWithClock as start } from "../../helpers/clock-app";

const previousKey = process.env.RUKIE_FILTER_TUI_KEY;
afterEach(() => {
  if (previousKey === undefined) delete process.env.RUKIE_FILTER_TUI_KEY;
  else process.env.RUKIE_FILTER_TUI_KEY = previousKey;
});

const settings = {
  model: "alpha/first",
  providers: ["alpha", "beta"].map((id) => ({
    id,
    api: "openai-completions" as const,
    baseUrl: "http://localhost:1/v1",
    apiKeyEnv: "RUKIE_FILTER_TUI_KEY",
    models: [
      { id: "first", name: "first alpha/first" },
      { id: "second", name: "Reasoner" },
    ],
  })),
};
const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");

test("model filtering accepts pasted queries and provider/spec fragments, with empty and two-stage Escape", async () => {
  process.env.RUKIE_FILTER_TUI_KEY = "test-key";
  const app = await start([], {
    env: { LANG: "en_US.UTF-8" },
    session: { model: undefined },
    prepare: (root) =>
      Bun.write(`${root}/.rukie/settings.json`, JSON.stringify(settings)).then(() => {}),
  });
  try {
    await app.waitFor(() => screen(app).includes("alpha/first"));
    app.stdin.write("/model\r");
    await app.waitFor(() => screen(app).includes("[alpha]"));
    app.stdin.write("\x1b[200~/SECOND\x1b[201~");
    await app.waitFor(() => screen(app).includes("Filter: /SECOND"));
    expect(screen(app)).toContain("alpha/second");
    expect(screen(app)).toContain("beta/second");
    expect(screen(app)).not.toContain("first alpha/first");
    expect(screen(app)).not.toContain("[alpha]");
    app.stdin.write("\x1b");
    await app.waitFor(() => screen(app).includes("[alpha]"));
    expect(screen(app)).toContain("Select model");
    app.stdin.write("BETA");
    await app.waitFor(() => screen(app).includes("beta/first"));
    expect(screen(app)).toContain("beta/second");
    expect(screen(app)).not.toContain("alpha/second");
    app.stdin.write("\x7f\x7f\x7f\x7f");
    await app.waitFor(() => screen(app).includes("[alpha]"));
    app.stdin.write("/SECOND");
    await app.waitFor(() => screen(app).includes("Filter: /SECOND"));
    expect(screen(app)).toContain("alpha/second");
    expect(screen(app)).toContain("beta/second");
    app.stdin.write("unknown");
    await app.waitFor(() => screen(app).includes("No matching models"));
    app.stdin.write("\x1b\x1b");
    await app.waitFor(() => !screen(app).includes("Select model"));
    expect(app.calls).toHaveLength(0);
    expect(screen(app)).toContain("alpha/first");
    app.stdin.write("/model\r");
    await app.waitFor(() => screen(app).includes("[alpha]"));
    app.stdin.write("/second\x1b[B\r");
    await app.waitFor(
      () => !screen(app).includes("Select model") && screen(app).includes("beta/second"),
    );
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});
