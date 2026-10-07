import { startWithClock } from "../../helpers/clock-app";
import { afterEach, expect, test } from "bun:test";
import { createSession, createJsonlStore, type SessionOptions } from "@rukie/agent";
import {
  createAssistantMessageEventStream,
  fauxProvider,
  fauxAssistantMessage,
} from "@earendil-works/pi-ai";
import { auxiliaryModels } from "../../helpers/auxiliary-model.ts";
import { start } from "../../helpers/app";

const previousKey = process.env.RUKIE_RESUME_TUI_KEY;
afterEach(() => {
  if (previousKey === undefined) delete process.env.RUKIE_RESUME_TUI_KEY;
  else process.env.RUKIE_RESUME_TUI_KEY = previousKey;
});

test("a 40 by 12 picker scrolls two-row entries and dims a prompt fallback", async () => {
  const app = await start([], {
    columns: 40,
    rows: 12,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: Infinity });
      faux.setResponses([fauxAssistantMessage("Stored answer")]);
      const fallback = await createSession({
        cwd: root,
        homeDir: root,
        model: faux.getModel(),
        models: auxiliaryModels(faux.provider.streamSimple, {
          titles: () => createAssistantMessageEventStream(),
        }),
      });
      await fallback.run("Prompt session");
      await fallback.dispose();
      for (const name of ["Middle session", "Latest session"]) {
        const seed = await createSession({
          cwd: root,
          homeDir: root,
          model: faux.getModel(),
          models: auxiliaryModels(faux.provider.streamSimple),
        });
        await seed.rename(name);
        await seed.close();
      }
    },
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/resume\r");
    await app.waitFor(() => screen(app).includes("❯ Latest session"));
    expect(screen(app)).toContain("Latest session");
    expect(screen(app)).toContain("Ask");
    expect(screen(app)).toContain("❯");
    app.stdin.write("\x1b[A");
    await app.waitFor(() => screen(app).includes("Prompt session"));
    const row = app.screen().findIndex((line) => line.includes("Prompt session"));
    expect(app.screen()[row + 1]).toContain("6 messages");
    const column = app.screen()[row]!.indexOf("Prompt session");
    expect(
      app.terminal.buffer.active
        .getLine(app.terminal.buffer.active.viewportY + row)!
        .getCell(column)!
        .isDim(),
    ).toBeTruthy();
    expect(screen(app)).not.toContain("Latest session");
    expect(app.calls).toHaveLength(0);
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen(app).includes("Resume session"));
  } finally {
    await app.cleanup();
  }
});

test("/resume reports an empty project and refuses to switch during a Run", async () => {
  const app = await start([], { env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/resume\r");
    await app.waitFor(() => screen(app).includes("No sessions to resume"));
    expect(app.calls).toHaveLength(0);
    app.stdin.write("Pending work\r");
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/resume\r");
    await app.waitFor(() => screen(app).includes("Use /resume after the run finishes"));
    expect(screen(app)).not.toContain("Resume session");
    expect(app.calls[0]!.signal?.aborted).toBe(false);
    expect(app.calls).toHaveLength(1);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});
const settings = {
  model: "resume-test/first",
  providers: [
    {
      id: "resume-test",
      api: "openai-completions" as const,
      baseUrl: "http://localhost:1/v1",
      apiKeyEnv: "RUKIE_RESUME_TUI_KEY",
      models: [{ id: "first" }, { id: "second" }],
    },
  ],
};
const title = (app: Awaited<ReturnType<typeof start>>) =>
  // eslint-disable-next-line no-control-regex -- Observe the terminal's OSC title at its public output seam.
  [...app.output().matchAll(/\x1b\]0;([^\x07]*)\x07/g)].at(-1)?.[1];
const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");

test("/resume displays two-row session metadata, Escape preserves the current chat, and selection restores title, model and conversation", async () => {
  process.env.RUKIE_RESUME_TUI_KEY = "test-key";
  const listing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const sessionOptions: Partial<SessionOptions> = { model: undefined };
  const app = await startWithClock([], {
    env: { LANG: "en_US.UTF-8" },
    session: sessionOptions,
    prepare: async (root) => {
      await Bun.write(`${root}/.rukie/settings.json`, JSON.stringify(settings));
      const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: Infinity });
      faux.setResponses([fauxAssistantMessage("Stored answer")]);
      const seed = await createSession({
        cwd: root,
        homeDir: root,
        settings,
        models: auxiliaryModels(faux.provider.streamSimple),
      });
      await seed.rename("Stored session");
      await seed.run("Stored prompt");
      await seed.setModel("resume-test/second");
      await seed.close();
      const store = createJsonlStore({ cwd: root, homeDir: root });
      let lists = 0;
      sessionOptions.store = {
        create: (...args) => store.create(...args),
        open: (...args) => store.open(...args),
        async list(...args) {
          if (++lists === 2) {
            listing.resolve();
            await release.promise;
          }
          return store.list(...args);
        },
      };
    },
  });
  try {
    await app.waitFor(() => screen(app).includes("resume-test/first"));
    app.stdin.write("/rename Current session\r");
    await app.waitFor(() => title(app) === "✦ Current session");
    app.stdin.write("Current prompt\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("Current answer");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking() && screen(app).includes("Current answer"));
    app.stdin.write("/resume\r");
    await app.waitFor(() => screen(app).includes("❯ Stored session"));
    const row = app.screen().findIndex((line) => line.includes("Stored session"));
    expect(row).toBeGreaterThanOrEqual(0);
    expect(app.screen()[row + 1]).toContain("6 messages · resume-test/second");
    expect(app.screen()[row + 1]).toMatch(/\d{2}\/\d{2}/);
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen(app).includes("Resume session"));
    expect(title(app)).toBe("✦ Current session");
    expect(screen(app)).toContain("Current answer");
    expect(screen(app)).toContain("resume-test/first");
    app.stdin.write("/resume\r");
    await listing.promise;
    await app.waitFor(() => screen(app).includes("Resume session"));
    // The loading heading is visible before a selectable row is ready.
    expect(screen(app)).not.toContain("❯ Stored session");
    release.resolve();
    await app.waitFor(() => screen(app).includes("❯ Stored session"));
    app.stdin.write("\r");
    await app.waitFor(
      () => title(app) === "✦ Stored session" && screen(app).includes("Stored answer"),
    );
    expect(screen(app)).not.toContain("Current answer");
    expect(screen(app)).toContain("resume-test/second");
    expect(app.calls).toHaveLength(1);
    app.stdin.write("Continue stored work\r");
    await app.waitFor(() => app.calls.length === 2);
    const restored = JSON.stringify(app.calls[1]!.context.messages);
    expect(restored).toContain("Stored prompt");
    expect(restored).not.toContain("Current prompt");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    release.resolve();
    await app.cleanup();
  }
});
