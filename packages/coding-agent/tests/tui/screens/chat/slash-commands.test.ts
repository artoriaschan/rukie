import { testClock } from "../../helpers/test-clock";
import { startWithClock } from "../../helpers/clock-app";
import { auxiliaryModels } from "../../helpers/auxiliary-model.ts";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { start } from "../../helpers/app";
import { createSession, type SessionOptions } from "@rukie/agent";
import { fauxProvider } from "@earendil-works/pi-ai";

const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");
async function ready(
  options: Parameters<typeof start>[1] = {},
  argv: string[] = [],
  virtualTime = false,
) {
  const app = await (virtualTime ? startWithClock : start)(argv, {
    env: { LANG: "en_US.UTF-8" },
    ...options,
  });
  await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
  return app;
}

test("compact summarizes with focus, shows shared progress and rejects while busy", async () => {
  const app = await ready({ rows: 48 });
  try {
    app.stdin.write("/compact\r");
    await app.waitFor(() => screen(app).includes("no compactable conversation history"));
    expect(app.calls).toHaveLength(0);
    app.stdin.write("inspect widgets\r");
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/compact keep API\r");
    await app.waitFor(() => screen(app).includes("after the run finishes"));
    expect(app.calls).toHaveLength(1);
    app.calls[0]!.delta("Widget contract.");
    app.calls[0]!.finish();
    await app.waitFor(() => screen(app).includes("Widget contract."));
    app.stdin.write("/compact keep API\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(JSON.stringify(app.calls[1]!.context)).toContain("keep API");
    await app.waitFor(() => /Packing up context|Tidying the context/.test(screen(app)));
    app.calls[1]!.delta("Widget summary.");
    app.calls[1]!.finish();
    await app.waitFor(() => screen(app).includes("Context compacted"));
    app.stdin.write("continue\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(JSON.stringify(app.calls[2]!.context)).toContain("Widget summary.");
    expect(JSON.stringify(app.calls[2]!.context)).not.toContain("keep API");
    app.calls[2]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("compact without history shows its error in the selected locale", async () => {
  const app = await ready({ env: { LANG: "zh_CN.UTF-8" } });
  try {
    app.stdin.write("/compact\r");
    await app.waitFor(() => screen(app).includes("没有可压缩的对话内容"));
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("exit cancels a held manual summary and completes app shutdown", async () => {
  const app = await ready({ rows: 48 });
  try {
    app.stdin.write("completed work\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("Done.");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/compact\r");
    await app.waitFor(() => app.calls.length === 2);
    app.stdin.write("/exit\r");
    await app.waitFor(() => app.calls[1]!.signal!.aborted);
    let exited = false;
    void app.exit.then(() => {
      exited = true;
    });
    await app.waitFor(() => exited);
    expect(app.calls[1]!.signal!.aborted).toBe(true);
    expect(app.calls).toHaveLength(2);
  } finally {
    await app.cleanup();
  }
});

test("a genuine manual summary failure stays visible and leaves the conversation usable", async () => {
  const app = await ready({ rows: 48 });
  try {
    app.stdin.write("recoverable work\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("Original work.");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/compact\r");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.fail("Summary provider unavailable");
    await app.waitFor(() => screen(app).includes("Summary provider unavailable"));
    expect(app.calls[1]!.signal!.aborted).toBe(false);
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("continue\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(JSON.stringify(app.calls[2]!.context)).toContain("Original work.");
    app.calls[2]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("local help remains usable while a question is folded and its answer stays pending", async () => {
  const app = await ready({ rows: 48 });
  try {
    app.stdin.write("work\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", {
      questions: [
        {
          question: "Choose storage",
          header: "Storage",
          options: [
            { label: "SQLite", description: "local" },
            { label: "JSONL", description: "portable" },
          ],
        },
      ],
    });
    await app.waitFor(() => screen(app).includes("Choose storage"));
    app.stdin.write("\x0b");
    await app.waitFor(() => screen(app).includes("Ctrl+K to expand"));
    app.stdin.write("/help\r");
    await app.waitFor(() => screen(app).includes("Slash commands"));
    expect(app.calls).toHaveLength(1);
    expect(screen(app)).toContain("Ctrl+K to expand");
  } finally {
    await app.cleanup();
  }
});

test("slash menu lists builtins and invocable skills, filters case-insensitively and completes", async () => {
  const app = await ready({
    rows: 48,
    prepare: async (root) => {
      for (const name of ["hello", "help", "hidden"])
        await Bun.write(
          join(root, ".agents/skills", name, "SKILL.md"),
          `---\nname: ${name}\ndescription: ${name} skill description\n${name === "hidden" ? "user-invocable: false\n" : ""}---\nSkill instruction\n`,
        );
    },
  });
  try {
    app.stdin.write("/");
    await app.waitFor(() => screen(app).includes("commands · 16 items"));
    expect(screen(app)).toContain("❯ compact");
    app.stdin.write("\x1b[A");
    await app.waitFor(() => screen(app).includes("❯ hello"));
    expect(screen(app)).toContain("[skill]");
    expect(screen(app)).toContain("rename");
    expect(screen(app)).not.toContain("hidden skill description");
    expect(screen(app)).not.toContain("help skill description");
    app.stdin.write("HE");
    await app.waitFor(() => screen(app).includes("❯ help"));
    expect(screen(app)).not.toContain("Compact context");
    app.stdin.write("\t");
    await app.waitFor(() => app.screen().includes("❯ /help"));
    expect(screen(app)).not.toContain("[skill]");
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("Slash commands"));
    expect(screen(app)).toContain("hello skill description");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("plan toggles locally, goal shows usage, rewind opens existing picker and clear preserves the old session", async () => {
  const sessionOptions: Partial<SessionOptions> = {};
  const argv: string[] = [];
  const app = await ready(
    {
      rows: 48,
      session: sessionOptions,
      prepare: async (root) => {
        const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
        const seed = await createSession({
          cwd: root,
          homeDir: root,
          model: faux.getModel(),
          models: auxiliaryModels(faux.provider.streamSimple),
        });
        sessionOptions.resumeId = seed.id;
        argv.push("--resume", seed.id);
        await seed.close();
      },
    },
    argv,
    true,
  );
  try {
    app.stdin.write("/plan\r");
    await app.waitFor(() => app.screen().at(-2)!.includes("plan"));
    expect(app.calls).toHaveLength(0);
    app.stdin.write("/plan\r");
    await app.waitFor(() => !app.screen().at(-2)!.includes("plan"));
    app.stdin.write("/goal\r");
    await app.waitFor(() => screen(app).includes("No goal is currently set"));
    app.stdin.write("retained question\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("retained answer");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking() && screen(app).includes("retained answer"));
    app.stdin.write("/rewind\r");
    await app.waitFor(() => screen(app).includes("Pick a message to rewind to"));
    expect(screen(app)).toContain("retained question");
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen(app).includes("Pick a message to rewind to"));
    app.stdin.write("/clear\r");
    await app.waitFor(() => !screen(app).includes("retained answer"));
    app.stdin.write("fresh question\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(JSON.stringify(app.calls[1]!.context)).not.toContain("retained question");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    const replay = await start(["--resume", sessionOptions.resumeId!], {
      session: { cwd: app.root, homeDir: app.root },
      rows: 48,
      advanceTimers: (ms) => testClock.advanceTimersByTime(ms),
    });
    try {
      await replay.waitFor(() => screen(replay).includes("retained answer"));
      expect(screen(replay)).not.toContain("fresh question");
    } finally {
      await replay.cleanup();
    }
  } finally {
    await app.cleanup();
  }
});

test("busy commands reject, help stays local, skill invocation steers and exit aborts", async () => {
  let id = "";
  const argv: string[] = [];
  const app = await ready(
    {
      rows: 48,
      prepare: async (root) => {
        await Bun.write(
          join(root, ".agents/skills/check/SKILL.md"),
          "---\nname: check\ndescription: check work\n---\nCheck the important edge case.",
        );
        const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
        const seed = await createSession({
          cwd: root,
          homeDir: root,
          model: faux.getModel(),
          models: auxiliaryModels(faux.provider.streamSimple),
        });
        id = seed.id;
        argv.push("--resume", id);
        await seed.close();
      },
    },
    argv,
  );
  try {
    app.stdin.write("work\r");
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/plan\r");
    await app.waitFor(() => screen(app).includes("Use /plan after the run finishes"));
    expect(app.screen().at(-2)).not.toContain("plan");
    app.stdin.write("/help\r");
    await app.waitFor(() => screen(app).includes("Slash commands"));
    expect(app.calls).toHaveLength(1);
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    app.stdin.write("/check focus\r");
    await app.waitFor(() => app.screen().includes("❯"));
    app.calls[0]!.tool("todo_write", { todos: [] });
    await app.waitFor(() => app.calls.length === 2);
    expect(JSON.stringify(app.calls[1]!.context)).toContain("/check focus");
    expect(JSON.stringify(app.calls[1]!.context)).toContain("Check the important edge case.");
    await app.waitFor(() => screen(app).includes("/check focus"));
    expect(screen(app)).not.toContain("Check the important edge case.");
    app.stdin.write("/exit\r");
    await app.exit;
    expect(app.calls[1]!.signal!.aborted).toBe(true);
    const replay = await start(["--resume", id], {
      rows: 48,
      session: { cwd: app.root, homeDir: app.root },
    });
    try {
      await replay.waitFor(() => screen(replay).includes("/check focus"));
      expect(screen(replay)).not.toContain("Check the important edge case.");
      replay.stdin.write("continue\r");
      await replay.waitFor(() => replay.calls.length === 1);
      expect(JSON.stringify(replay.calls[0]!.context)).toContain("Check the important edge case.");
      replay.calls[0]!.finish();
    } finally {
      await replay.cleanup();
    }
  } finally {
    await app.cleanup();
  }
});

test("menu navigation cycles, Escape keeps the draft, and unknown/path/multiline prompts pass through", async () => {
  const app = await ready({ rows: 48 });
  try {
    app.stdin.write("/");
    await app.waitFor(() => screen(app).includes("❯ compact"));
    app.stdin.write("\x1b[A");
    await app.waitFor(() => screen(app).includes("❯ jobs"));
    app.stdin.write("\x1b[B");
    await app.waitFor(() => screen(app).includes("❯ compact"));
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen(app).includes("commands ·"));
    expect(app.screen()).toContain("❯ /");
    app.stdin.write("\x03");
    await app.waitFor(() => app.screen().includes("❯"));
    for (const value of ["/foo bar", "/Users/x/a.ts has a bug", "/foo\nplain text"]) {
      const index = app.calls.length;
      app.stdin.write(`\x1b[200~${value}\x1b[201~`);
      await app.waitFor(() => screen(app).includes(value.split("\n")[0]!));
      expect(screen(app)).not.toContain("Show commands and skills");
      app.stdin.write("\r");
      await app.waitFor(() => app.calls.length === index + 1);
      expect(app.calls[index]!.context.messages.at(-1)).toMatchObject({
        content: [{ type: "text", text: value }],
      });
      app.calls[index]!.finish();
      await app.waitFor(
        () =>
          !app.isWorking() &&
          app.screen().filter((line) => line.includes("✻ Baked for")).length === index + 1,
      );
    }
    app.resize(40, 12);
    app.stdin.write("/");
    await app.waitFor(() => screen(app).includes("❯ compact"));
    app.stdin.write("\x1b[A");
    await app.waitFor(() => screen(app).includes("❯ jobs"));
    expect(app.screen()).toContain("❯ /");
    expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
  } finally {
    await app.cleanup();
  }
});
