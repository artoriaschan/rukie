import { afterEach, expect, test } from "bun:test";
import { createSession } from "@rukie/agent";
import { controlledModel } from "../../helpers/model";
import { startWithClock as start } from "../../helpers/clock-app";

const originalKey = process.env.RUKIE_THINKING_TUI_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.RUKIE_THINKING_TUI_KEY;
  else process.env.RUKIE_THINKING_TUI_KEY = originalKey;
});
const settings = {
  model: "thinking/reasoner",
  thinking: "low",
  providers: [
    {
      id: "thinking",
      api: "openai-completions",
      baseUrl: "http://localhost:1/v1",
      apiKeyEnv: "RUKIE_THINKING_TUI_KEY",
      models: [
        { id: "reasoner", reasoning: true },
        { id: "plain", reasoning: false },
      ],
    },
  ],
};
const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");
async function launch() {
  process.env.RUKIE_THINKING_TUI_KEY = "test-key";
  return start([], {
    env: { LANG: "en_US.UTF-8" },
    session: { model: undefined },
    prepare: (root) =>
      Bun.write(`${root}/.rukie/settings.json`, JSON.stringify(settings)).then(() => {}),
  });
}

test("picker thinking draft applies on Enter, updates the Session status and gives one merged notice", async () => {
  const app = await launch();
  try {
    await app.waitFor(() => screen(app).includes("thinking/reasoner"));
    app.stdin.write("/model\r");
    await app.waitFor(() => screen(app).includes("[low]"));
    app.stdin.write("\x1b[C\x1b[C");
    await app.waitFor(() => screen(app).includes("[high]"));
    expect(app.screen().at(-2)).toContain("low");
    app.stdin.write("\r");
    await app.waitFor(
      () => !screen(app).includes("Select model") && !!app.screen().at(-2)?.includes("high"),
    );
    await app.waitFor(() => screen(app).includes("Thinking changed to high"));
    expect(screen(app)).not.toContain("Model changed to");
    app.stdin.write("question\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(app.calls[0]!.reasoning).toBe("high");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/model\r");
    await app.waitFor(() => screen(app).includes("[high]"));
    app.stdin.write("\x1b[D\x1b[D\r");
    await app.waitFor(
      () => !screen(app).includes("Select model") && !!app.screen().at(-2)?.includes("low"),
    );
    app.stdin.write("/rewind\r");
    await app.waitFor(() => screen(app).includes("Pick a message to rewind"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("Rewind to this message?"));
    app.stdin.write("\r");
    await app.waitFor(
      () => screen(app).includes("Rewound — edit") && !!app.screen().at(-2)?.includes("high"),
    );
  } finally {
    await app.cleanup();
  }
});

test("Escape discards thinking edits; a non-reasoning model confirms with one model and clamp notice", async () => {
  const app = await launch();
  try {
    await app.waitFor(() => screen(app).includes("thinking/reasoner"));
    app.stdin.write("/model\r");
    await app.waitFor(() => screen(app).includes("[low]"));
    app.stdin.write("\x1b[C\x1b[C\x1b");
    await app.waitFor(() => !screen(app).includes("Select model"));
    expect(app.screen().at(-2)).toContain("low");
    app.stdin.write("/model\r");
    await app.waitFor(() => screen(app).includes("[low]"));
    app.stdin.write("\x1b[C\x1b[C\x1b[A");
    await app.waitFor(() => screen(app).includes("Thinking unavailable"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("reduced high → off"));
    expect(screen(app)).toContain("Model changed to plain (thinking/plain) · thinking off");
    expect(app.screen().at(-2)).toContain("plain");
    expect(app.screen().at(-2)).not.toContain("low");
    expect(app.screen().at(-2)).not.toContain(" · off · ");
    app.stdin.write("/model thinking/reasoner\r");
    await app.waitFor(() => screen(app).includes("Model changed to reasoner (thinking/reasoner)"));
    expect(app.screen().at(-2)).not.toContain("low");
    expect(app.screen().at(-2)).not.toContain("high");
    app.stdin.write("question\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(app.calls[0]!.reasoning).toBeUndefined();
    app.stdin.write("/model\r");
    await app.waitFor(() => screen(app).includes("Use /model after the run finishes"));
    expect(screen(app)).not.toContain("Select model");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(screen(app)).not.toContain("Select model");
    expect(app.calls).toHaveLength(1);
  } finally {
    await app.cleanup();
  }
});

test("resume displays the saved Thinking Level instead of the settings default", async () => {
  process.env.RUKIE_THINKING_TUI_KEY = "test-key";
  const argv: string[] = [];
  const app = await start(argv, {
    env: { LANG: "en_US.UTF-8" },
    session: { model: undefined },
    prepare: async (root) => {
      const catalog = controlledModel();
      const config = {
        ...settings,
        thinking: "low" as const,
        providers: settings.providers.map((provider) => ({
          ...provider,
          api: "openai-completions" as const,
        })),
      };
      const model = await catalog.configuredModel(config);
      const seed = await createSession({
        cwd: root,
        homeDir: root,
        settings: config,
        model,
        models: catalog.models,
      });
      try {
        await seed.setModelSelection({ thinkingLevel: "high" });
      } finally {
        await seed.close();
      }
      argv.push("--resume", seed.id);
      await Bun.write(`${root}/.rukie/settings.json`, JSON.stringify(settings));
    },
  });
  try {
    await app.waitFor(() => !!app.screen().at(-2)?.includes("high"));
    expect(app.screen().at(-2)).not.toContain("low");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});
