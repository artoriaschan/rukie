import { auxiliaryModels } from "../helpers/auxiliary-model.ts";
import { expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { appendFile } from "node:fs/promises";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createJsonlStore, createSession, type SessionOptions } from "@rukie/agent";
import { createUserVisibleError } from "@rukie/shared";
import { start } from "../helpers/app";

test.each([
  ["zh", "暂无可恢复的会话"],
  ["en", "No sessions to resume"],
] as const)(
  "%s resume list skips unreadable history and reports a warning",
  async (locale, expected) => {
    let path = "";
    let before: Uint8Array<ArrayBuffer>;
    const app = await start([], {
      columns: 160,
      env: { LANG: locale },
      prepare: async (root) => {
        const store = createJsonlStore({ cwd: root, homeDir: root });
        const fake = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
        const session = await createSession({
          cwd: root,
          homeDir: root,
          store,
          model: fake.getModel(),
          models: auxiliaryModels((model, context, options) =>
            fake.provider.streamSimple(model, context, options),
          ),
        });
        await session.close();
        path = join(store.key(session.id), "main.jsonl");
        await appendFile(path, '{"torn":');
        before = await Bun.file(path).bytes();
      },
    });
    try {
      await app.waitFor(() => app.screen().join("\n").includes("❯"));
      app.stdin.write("/resume\r");
      await app.waitFor(() => app.screen().join("\n").includes(expected));
      expect(app.stderr()).toContain("Could not read Session");
      expect(app.stderr()).toContain("Session history requires repair");
      expect(await Bun.file(path).bytes()).toEqual(before!);
      expect(app.calls).toHaveLength(0);
    } finally {
      await app.cleanup();
    }
  },
);

test.each([
  ["zh", "未配置模型。", "en"],
  ["en", "No model configured.", "zh"],
] as const)(
  "%s startup error follows user locale before rendering",
  async (locale, expected, lang) => {
    const session = { model: undefined, models: undefined, homeDir: "" };
    const app = await start([], {
      env: { LANG: lang },
      session,
      prepare: async (root) => {
        session.homeDir = join(root, "home");
        await Bun.write(join(session.homeDir, ".rukie/settings.json"), JSON.stringify({ locale }));
      },
    });
    try {
      expect(await app.exit).toBe(1);
      expect(app.stderr()).toStartWith(expected);
      expect(app.stderr()).toContain(".rukie/settings.json");
      expect(app.output()).toBe("");
    } finally {
      await app.cleanup();
    }
  },
);

test.each([
  ["zh", "内置 ripgrep 不可用。", "恢复完整的 Rukie 安装", "执行权限"],
  [
    "en",
    "Bundled ripgrep is unavailable.",
    "Restore the complete Rukie installation",
    "execution permissions",
  ],
] as const)(
  "%s live tool error translates coded details while the model sees English",
  async (locale, expected, recovery, permissions) => {
    const app = await start(["search"], { columns: 300, env: { LANG: locale } });
    try {
      await app.waitFor(() => app.calls.length === 1);
      const spawn = spyOn(Bun, "spawn").mockImplementation(() => {
        throw new Error("test binary unavailable");
      });
      try {
        app.calls[0]!.tool("grep", { pattern: "missing" });
        await app.waitFor(() => app.calls.length === 2);
      } finally {
        spawn.mockRestore();
      }
      await app.waitFor(() => app.screen().join("\n").includes(expected));
      expect(app.screen().join("\n")).toContain(recovery);
      expect(app.screen().join("\n")).toContain(permissions);
      expect(app.screen().join("\n")).toContain("test binary unavailable");
      expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
        role: "toolResult",
        isError: true,
        content: [
          { type: "text", text: expect.stringContaining("Bundled ripgrep is unavailable.") },
        ],
      });
      expect(JSON.stringify(app.calls[1]!.context)).not.toContain("内置 ripgrep 不可用。");
      app.calls[1]!.finish();
    } finally {
      await app.cleanup();
    }
  },
);

test.each([
  ["zh", "内置 ripgrep 不可用。", "en"],
  ["en", "Bundled ripgrep is unavailable.", "zh"],
] as const)(
  "%s resume translates stored error details from a different startup locale",
  async (locale, expected, originalLocale) => {
    const argv: string[] = [];
    let id = "";
    const app = await start(argv, {
      columns: 300,
      env: { LANG: locale },
      prepare: async (root) => {
        const original = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
        original.setResponses([
          fauxAssistantMessage(fauxToolCall("grep", { pattern: "missing" }), {
            stopReason: "toolUse",
          }),
          fauxAssistantMessage("recovered"),
        ]);
        const session = await createSession({
          cwd: root,
          homeDir: root,
          settings: { locale: originalLocale },
          model: original.getModel(),
          models: auxiliaryModels((model, context, options) =>
            original.provider.streamSimple(model, context, options),
          ),
        });
        const spawn = spyOn(Bun, "spawn").mockImplementation(() => {
          throw new Error("test binary unavailable");
        });
        try {
          await session.run("search");
        } finally {
          spawn.mockRestore();
        }
        id = session.id;
        expect(JSON.stringify(session.messages)).not.toContain("内置 ripgrep 不可用。");
        await session.close();
        argv.push("--resume", id);
      },
    });
    try {
      await app.waitFor(() => app.screen().join("\n").includes(expected));
      expect(app.screen().join("\n")).toContain("test binary unavailable");
      app.stdin.write("continue\r");
      await app.waitFor(() => app.calls.length === 1);
      const storedTool = app.calls[0]!.context.messages.find(
        (message) => message.role === "toolResult",
      );
      expect(storedTool).toMatchObject({
        content: [
          { type: "text", text: expect.stringContaining("Bundled ripgrep is unavailable.") },
        ],
      });
      expect(JSON.stringify(storedTool)).not.toContain("内置 ripgrep 不可用。");
      app.calls[0]!.finish();
    } finally {
      await app.cleanup();
    }
  },
);

test.each([
  ["zh", "provider request failed"],
  ["en", "provider request failed"],
] as const)("%s unclassified model error keeps the original message", async (locale, expected) => {
  const app = await start(["run"], { env: { LANG: locale } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.fail(expected);
    await app.waitFor(() => app.screen().join("\n").includes(expected));
  } finally {
    await app.cleanup();
  }
});

test.each([
  new Error("plain runtime failure"),
  Object.assign(new Error("unknown code failure"), { code: "future-code", params: {} }),
  "non-Error runtime failure",
  Object.assign(new Error("malformed coded failure"), { code: "unknown-model", params: {} }),
])("runtime failure %s preserves original information", async (error) => {
  const session: Partial<SessionOptions> = {};
  const app = await start(["run"], {
    env: { LANG: "zh" },
    session,
    prepare: async (root) => {
      const store = createJsonlStore({ cwd: root, homeDir: root });
      session.store = {
        key: store.key.bind(store),
        list: store.list.bind(store),
        async open() {
          throw error;
        },
      };
    },
  });
  try {
    const expected = error instanceof Error ? error.message : error;
    expect(await app.exit).toBe(1);
    expect(app.stderr()).toContain(expected);
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["zh", "unknown", '未知模型 "missing/model"。'],
  ["en", "unknown", 'Unknown model "missing/model".'],
  ["zh", "session", "Session 不存在：missing"],
  ["en", "session", "Session not found: missing"],
  ["zh", "key", '缺少 provider "local" 的 API key。环境变量：RUKIE_I18N_STARTUP_MISSING_KEY。'],
  [
    "en",
    "key",
    'No API key for provider "local". Environment variable: RUKIE_I18N_STARTUP_MISSING_KEY.',
  ],
] as const)("%s startup translates %s with its parameters", async (locale, scenario, expected) => {
  const session: Partial<SessionOptions> =
    scenario === "session" ? {} : { model: undefined, models: undefined };
  const envName = "RUKIE_I18N_STARTUP_MISSING_KEY";
  const previous = process.env[envName];
  delete process.env[envName];
  const argv =
    scenario === "unknown"
      ? ["--model", "missing/model"]
      : scenario === "session"
        ? ["--resume", "missing"]
        : [];
  const app = await start(argv, {
    env: { LANG: locale },
    session,
    prepare: async (root) => {
      session.homeDir = join(root, "home");
      if (scenario === "key")
        await Bun.write(
          join(session.homeDir, ".rukie/settings.json"),
          JSON.stringify({
            model: "local/m",
            providers: [
              {
                id: "local",
                api: "openai-completions",
                baseUrl: "http://127.0.0.1:1/v1",
                apiKeyEnv: envName,
                models: [{ id: "m" }],
              },
            ],
          }),
        );
    },
  });
  try {
    expect(await app.exit).toBe(1);
    expect(app.stderr()).toBe(expected + "\n");
    expect(app.output()).toBe("");
  } finally {
    await app.cleanup();
    if (previous !== undefined) process.env[envName] = previous;
  }
});

test.each(["zh", "en"] as const)("%s runtime coded error is translated", async (locale) => {
  const session: Partial<SessionOptions> = {};
  const error = createUserVisibleError("Session not found: runtime-missing", {
    code: "session-not-found",
    params: { id: "runtime-missing" },
  });
  const app = await start(["run"], {
    env: { LANG: locale },
    session,
    prepare: async (root) => {
      const store = createJsonlStore({ cwd: root, homeDir: root });
      session.store = {
        key: store.key.bind(store),
        list: store.list.bind(store),
        async open() {
          throw error;
        },
      };
    },
  });
  try {
    const expected =
      locale === "zh" ? "Session 不存在：runtime-missing" : "Session not found: runtime-missing";
    expect(await app.exit).toBe(1);
    expect(app.stderr()).toContain(expected);
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["zh", '缺少 provider "builtin" 的 API key。环境变量：该提供方的标准环境变量。'],
  [
    "en",
    `No API key for provider "builtin". Environment variable: the provider's standard environment variable.`,
  ],
] as const)(
  "%s missing key without a configured env name keeps usable guidance",
  async (locale, expected) => {
    const session: Partial<SessionOptions> = {};
    const error = createUserVisibleError('No API key for provider "builtin".', {
      code: "no-api-key",
      params: { provider: "builtin", env: "" },
    });
    const app = await start(["run"], {
      columns: 180,
      env: { LANG: locale },
      session,
      prepare: async (root) => {
        const store = createJsonlStore({ cwd: root, homeDir: root });
        session.store = {
          key: store.key.bind(store),
          list: store.list.bind(store),
          async open() {
            throw error;
          },
        };
      },
    });
    try {
      expect(await app.exit).toBe(1);
      expect(app.stderr()).toContain(expected);
    } finally {
      await app.cleanup();
    }
  },
);

test.each(["zh", "en"] as const)("%s startup reports a busy Session clearly", async (locale) => {
  const argv: string[] = [];
  let owner: Awaited<ReturnType<typeof createSession>> | undefined;
  const app = await start(argv, {
    env: { LANG: locale },
    prepare: async (root) => {
      const fake = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
      owner = await createSession({
        cwd: root,
        homeDir: root,
        model: fake.getModel(),
        models: auxiliaryModels((model, context, options) =>
          fake.provider.streamSimple(model, context, options),
        ),
      });
      argv.push("--resume", owner.id);
    },
  });
  try {
    expect(await app.exit).toBe(1);
    expect(app.stderr()).toBe(
      locale === "zh"
        ? `Session 已被打开：${owner!.id}。请先关闭其他窗口或进程中的会话。\n`
        : `Session already open: ${owner!.id}. Close it in the other window or process first.\n`,
    );
    expect(app.calls).toHaveLength(0);
  } finally {
    await owner?.close();
    await app.cleanup();
  }
});
