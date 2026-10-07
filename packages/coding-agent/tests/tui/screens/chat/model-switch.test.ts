import { auxiliaryModels } from "../../helpers/auxiliary-model";
import { afterEach, expect, test } from "bun:test";
import { createSession } from "@rukie/agent";
import { fauxProvider } from "@earendil-works/pi-ai";
import { startWithClock as start } from "../../helpers/clock-app";

const originalKey = process.env.RUKIE_MODEL_TUI_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.RUKIE_MODEL_TUI_KEY;
  else process.env.RUKIE_MODEL_TUI_KEY = originalKey;
});
const settings = {
  model: "test-model/first",
  providers: [
    {
      id: "test-model",
      api: "openai-completions" as const,
      baseUrl: "http://localhost:1/v1",
      apiKeyEnv: "RUKIE_MODEL_TUI_KEY",
      models: [{ id: "first" }, { id: "second" }],
    },
  ],
};
const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");

test("direct /model switches the idle status, reports errors and refuses switching during a Run", async () => {
  process.env.RUKIE_MODEL_TUI_KEY = "test-key";
  const app = await start([], {
    env: { LANG: "en_US.UTF-8" },
    session: { model: undefined },
    prepare: (root) =>
      Bun.write(`${root}/.rukie/settings.json`, JSON.stringify(settings)).then(() => {}),
  });
  try {
    await app.waitFor(() => screen(app).includes("test-model/first"));
    app.stdin.write("/model test-model/second\r");
    await app.waitFor(() => screen(app).includes("Model changed to test-model/second"));
    expect(app.screen().at(-2)).toContain("second");
    expect(app.calls).toHaveLength(0);
    app.stdin.write("/model test-model/unknown\r");
    await app.waitFor(() => screen(app).includes('Unknown model "test-model/unknown"'));
    expect(app.screen().at(-2)).toContain("second");
    app.stdin.write("question\r");
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/model test-model/first\r");
    await app.waitFor(() => screen(app).includes("Use /model after the run finishes"));
    expect(app.calls).toHaveLength(1);
    expect(app.screen().at(-2)).toContain("second");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});

test("/model opens a focused picker, Escape preserves the model and Enter selects a new model", async () => {
  process.env.RUKIE_MODEL_TUI_KEY = "test-key";
  const app = await start([], {
    columns: 40,
    rows: 12,
    env: { LANG: "en_US.UTF-8" },
    session: { model: undefined },
    prepare: (root) =>
      Bun.write(`${root}/.rukie/settings.json`, JSON.stringify(settings)).then(() => {}),
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/model\r");
    await app.waitFor(() => screen(app).includes("Select model"));
    expect(screen(app)).toContain("✓ test-model/first");
    app.stdin.write("\x1b[B");
    await app.waitFor(() => screen(app).includes("test-model/second"));
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen(app).includes("Select model"));
    expect(screen(app)).toContain("test-model/first");
    app.stdin.write("/model\r");
    await app.waitFor(() => screen(app).includes("Select model"));
    app.stdin.write("\x1b[B\r");
    await app.waitFor(
      () => !screen(app).includes("Select model") && screen(app).includes("test-model/second"),
    );
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("a resumed session displays its persisted model before sending another prompt", async () => {
  process.env.RUKIE_MODEL_TUI_KEY = "test-key";
  const argv: string[] = [];
  const app = await start(argv, {
    env: { LANG: "en_US.UTF-8" },
    session: { model: undefined },
    prepare: async (root) => {
      const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
      const seed = await createSession({
        cwd: root,
        homeDir: root,
        settings,
        models: auxiliaryModels(faux.provider.streamSimple),
      });
      await seed.setModel("test-model/second");
      await seed.close();
      argv.push("--resume", seed.id);
      await Bun.write(
        `${root}/.rukie/settings.json`,
        JSON.stringify({ ...settings, model: "missing/model" }),
      );
    },
  });
  try {
    await app.waitFor(() => screen(app).includes("test-model/second"));
    expect(app.screen().at(-2)).toContain("second");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});
