import { expect, test } from "bun:test";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { createSession, loadSettings, type SessionEvent } from "../../src/index.ts";
import { join } from "node:path";
import { abortingModel } from "../helpers/aborting-model.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import {
  withAuxiliaryRequests,
  modelStream,
  withModelStream,
  withModelAlias,
  type ModelStream,
} from "../helpers/auxiliary-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

test("first submitted prompt gets a cleaned UTF-8 fallback without waiting for its title model", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("Done")]);
  const title = createAssistantMessageEventStream();
  const requested = Promise.withResolvers<void>();
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    model: fake.model,
    models: withModelStream(
      fake.models,
      withAuxiliaryRequests(modelStream(fake.models), {
        titles: () => {
          requested.resolve();
          return title;
        },
      }),
    ),
  });
  session.subscribe((event) => events.push(event));
  try {
    await session.run("\x1b[31m修复\x1b[0m\t登录\n页面错误和按钮行为保持稳定进行验证");
    expect(session.title).toBe("修复 登录 页面错误和按钮行");
    expect(session.titleSource).toBe("prompt");
    expect(events).toContainEqual({
      type: "session_title_changed",
      title: session.title,
      source: "prompt",
      sessionId: session.id,
    });
  } finally {
    const response = fauxAssistantMessage("登录页面修复");
    title.push({ type: "done", reason: "stop", message: response });
    title.end(response);
    await session.close();
    await dirs.cleanup();
  }
});

test("a model title replaces the fallback once and is restored without a second request", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("Done"), fauxAssistantMessage("Again")]);
  const titles: Parameters<ModelStream>[1][] = [];
  const changed = Promise.withResolvers<void>();
  const session = await createSession({
    ...dirs,
    ...fake,
    models: withModelStream(
      fake.models,
      withAuxiliaryRequests(modelStream(fake.models), {
        titles: (model, context, options) => {
          titles.push(context);
          return withAuxiliaryRequests(modelStream(fake.models))(model, context, options);
        },
      }),
    ),
  });
  session.subscribe((event) => {
    if (event.type === "session_title_changed" && event.source === "model") changed.resolve();
  });
  try {
    await session.run("Repair the login form");
    await changed.promise;
    expect(session.title).toBe("Test session");
    expect(session.titleSource).toBe("model");
    expect(
      session.messages.some((message) => JSON.stringify(message).includes("Test session")),
    ).toBe(false);
    await session.run("Check the tests");
    expect(titles).toHaveLength(1);
    await session.close();
    const resumed = await createSession({ ...dirs, ...fake, resumeId: session.id });
    expect(resumed.title).toBe("Test session");
    expect(resumed.titleSource).toBe("model");
    await resumed.close();
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

test("rename cancels a held generation during the primary Run and fixes the title on resume", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([]);
  const primary = createAssistantMessageEventStream();
  const title = createAssistantMessageEventStream();
  const started = Promise.withResolvers<void>();
  let titleSignal: AbortSignal | undefined;
  const warnings: string[] = [];
  const session = await createSession({
    ...dirs,
    model: fake.model,
    onWarning: (warning) => warnings.push(warning),
    models: withModelStream(
      fake.models,
      withAuxiliaryRequests(
        () => {
          started.resolve();
          return primary;
        },
        {
          titles: (_model, _context, options) => {
            titleSignal = options?.signal;
            return title;
          },
        },
      ),
    ),
  });
  try {
    const run = session.run("Build a login page");
    await started.promise;
    expect(session.title).toBe("Build a login page");
    await session.rename("User's final title");
    expect(titleSignal?.aborted).toBe(true);
    const stale = fauxAssistantMessage("Late automatic title");
    title.push({ type: "done", reason: "stop", message: stale });
    title.end(stale);
    const response = fauxAssistantMessage("Primary answer");
    primary.push({ type: "done", reason: "stop", message: response });
    primary.end(response);
    expect((await run).text).toBe("Primary answer");
    expect(session.title).toBe("User's final title");
    expect(session.titleSource).toBe("user");
    expect(warnings).toEqual([]);
    await session.rename("Idle title");
    await session.close();
    const resumed = await createSession({ ...dirs, ...fake, resumeId: session.id });
    expect(resumed.title).toBe("Idle title");
    expect(resumed.titleSource).toBe("user");
    await resumed.close();
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

for (const [label, response] of [
  [
    "tool output",
    fauxAssistantMessage(
      fauxToolCall("bash", { description: "Run test command", command: "echo bad" }),
      { stopReason: "toolUse" },
    ),
  ],
  ["empty output", fauxAssistantMessage("   ")],
  [
    "model error",
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "title unavailable" }),
  ],
] as const)
  test(`title ${label} warns while preserving the fallback and primary answer`, async () => {
    const dirs = await tempDirs();
    const fake = fakeModel([fauxAssistantMessage("Primary answer")]);
    const warning = Promise.withResolvers<string>();
    const session = await createSession({
      ...dirs,
      ...fake,
      onWarning: (text) => warning.resolve(text),
      models: withModelStream(
        fake.models,
        withAuxiliaryRequests(modelStream(fake.models), {
          titles: () => {
            const stream = createAssistantMessageEventStream();
            stream.push({ type: "done", reason: "stop", message: response });
            stream.end(response);
            return stream;
          },
        }),
      ),
    });
    try {
      expect((await session.run("Fix the login error")).text).toBe("Primary answer");
      expect(await warning.promise).toContain("Session Title generation failed");
      expect(session.title).toBe("Fix the login error");
      expect(session.titleSource).toBe("prompt");
    } finally {
      await session.close();
      await dirs.cleanup();
    }
  });

test("a manual title before the first prompt suppresses all automatic generation", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("Done")]);
  let generated = false;
  const session = await createSession({
    ...dirs,
    ...fake,
    models: withModelStream(
      fake.models,
      withAuxiliaryRequests(modelStream(fake.models), {
        titles: (...args) => {
          generated = true;
          return modelStream(fake.models)(...args);
        },
      }),
    ),
  });
  try {
    await session.rename("Chosen name");
    await session.run("A different title");
    expect(session.title).toBe("Chosen name");
    expect(generated).toBe(false);
    await expect(session.rename("\x1b[31m\x1b[0m\n")).rejects.toThrow("empty");
    expect(session.title).toBe("Chosen name");
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

test("title requests have bounded UTF-8 input, no tools, and a cleaned 80-byte result", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("Done")]);
  const changed = Promise.withResolvers<void>();
  let input = "";
  let outputLimit: number | undefined;
  let tools = false;
  const session = await createSession({
    ...dirs,
    ...fake,
    models: withModelStream(
      fake.models,
      withAuxiliaryRequests(modelStream(fake.models), {
        titles: (_model, context, options) => {
          input = JSON.stringify(context.messages.at(-1));
          const message = context.messages.at(-1)!;
          input =
            typeof message.content === "string"
              ? message.content
              : message.content
                  .filter((block) => block.type === "text")
                  .map((block) => block.text)
                  .join("");
          outputLimit = options?.maxTokens;
          tools = context.messages.some(
            (message) => message.role === "system" && (message.toolsAdded?.length ?? 0) > 0,
          );
          const stream = createAssistantMessageEventStream();
          const response = fauxAssistantMessage("\x1b[31m" + "中文标题".repeat(30) + "\x1b[0m\n");
          stream.push({ type: "done", reason: "stop", message: response });
          stream.end(response);
          return stream;
        },
      }),
    ),
  });
  session.subscribe((event) => {
    if (event.type === "session_title_changed" && event.source === "model") changed.resolve();
  });
  try {
    await session.run("登录界面".repeat(1000));
    await changed.promise;
    expect(new TextEncoder().encode(input).length).toBeLessThanOrEqual(4096);
    expect(outputLimit).toBe(64);
    expect(tools).toBe(false);
    expect(new TextEncoder().encode(session.title).length).toBe(78);
    expect(session.title).toBe("中文标题中文标题中文标题中文标题中文标题中文标题中文");
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

test("project titleModel overrides the user title model and routes an isolated request", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("Done")]);
  const original = process.env.RUKIE_TEST_TITLE_KEY;
  process.env.RUKIE_TEST_TITLE_KEY = "test-key";
  await Bun.write(
    join(dirs.homeDir, ".rukie/settings.json"),
    JSON.stringify({
      titleModel: "title-test/other",
      providers: [
        {
          id: "title-test",
          api: "openai-completions",
          baseUrl: "https://invalid.example",
          apiKeyEnv: "RUKIE_TEST_TITLE_KEY",
          models: [{ id: "cheap" }, { id: "other" }],
        },
      ],
    }),
  );
  await Bun.write(
    join(dirs.cwd, ".rukie/settings.json"),
    JSON.stringify({ titleModel: "title-test/cheap" }),
  );
  fake.models = withModelAlias(fake.models, "title-test", ["cheap", "other"]);
  const { settings } = await loadSettings(dirs);
  const requested = Promise.withResolvers<string>();
  const session = await createSession({
    ...dirs,
    ...fake,
    settings,
    models: withModelStream(
      fake.models,
      withAuxiliaryRequests(modelStream(fake.models), {
        titles: (model, context, options) => {
          requested.resolve(`${model.provider}/${model.id}`);
          return modelStream(fake.models)(model, context, options);
        },
      }),
    ),
  });
  try {
    await session.run("Build a login page");
    expect(await requested.promise).toBe("title-test/cheap");
    expect(fake.contexts).toHaveLength(1);
  } finally {
    await session.close();
    await dirs.cleanup();
    if (original === undefined) delete process.env.RUKIE_TEST_TITLE_KEY;
    else process.env.RUKIE_TEST_TITLE_KEY = original;
  }
});

test("delegated and forked child sessions use the description without another title model request", async () => {
  const dirs = await tempDirs();
  const response = () => fauxAssistantMessage("Finished");
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description:
          "Inspect authentication, permission decisions, interrupted requests and restored conversation behavior",
        prompt: "inspect",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    response,
    response,
    fauxAssistantMessage(
      fauxToolCall("subagent_fork", {
        description: "Check test coverage",
        prompt: "tests",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    response,
    response,
  ]);
  let titleCalls = 0;
  const session = await createSession({
    ...dirs,
    ...fake,
    models: withModelStream(
      fake.models,
      withAuxiliaryRequests(modelStream(fake.models), {
        titles: (...args) => {
          titleCalls++;
          return modelStream(fake.models)(...args);
        },
      }),
    ),
  });
  try {
    await session.run("Delegate inspection");
    await session.run("Delegate tests");
    expect(titleCalls).toBe(1);
    const children = session.toolState("subagents");
    if (!Array.isArray(children)) throw new Error("Expected child identities");
    const names: (string | undefined)[] = [];
    for (const identity of children) {
      if (
        typeof identity !== "object" ||
        identity === null ||
        !("id" in identity) ||
        typeof identity.id !== "string"
      )
        throw new Error("Expected a child conversation ID");
      const child = await session.readSubagent(identity.id);
      names.push(child?.title);
      expect(child?.title).toBe(child?.description);
    }
    expect(names.sort()).toEqual([
      "Check test coverage",
      "Inspect authentication, permission decisions, interrupted requests and restored conversation behavior",
    ]);
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

test("rewinding the conversation preserves a user's fixed title on resume", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("Done")]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    await session.run("First task");
    await session.rename("A fixed title");
    await session.rewind(session.checkpoints()[0]!.promptEntryId, {
      code: false,
      conversation: true,
    });
    await session.close();
    const resumed = await createSession({ ...dirs, ...fake, resumeId: session.id });
    expect(resumed.title).toBe("A fixed title");
    expect(resumed.titleSource).toBe("user");
    await resumed.close();
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

test("an idle rename and model selection can persist concurrently without losing either value", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("Done")]);
  const original = process.env.RUKIE_TITLE_CONCURRENT_KEY;
  process.env.RUKIE_TITLE_CONCURRENT_KEY = "test-key";
  const settings = {
    providers: [
      {
        id: "title-concurrent",
        api: "openai-completions" as const,
        baseUrl: "https://invalid.example",
        apiKeyEnv: "RUKIE_TITLE_CONCURRENT_KEY",
        models: [{ id: "cheap" }],
      },
    ],
  };
  fake.models = withModelAlias(fake.models, "title-concurrent", ["cheap"]);
  const session = await createSession({ ...dirs, ...fake, settings });
  try {
    await session.run("Initial work");
    await Promise.all([session.rename("Chosen name"), session.setModel("title-concurrent/cheap")]);
    await session.close();
    const resumed = await createSession({ ...dirs, ...fake, settings, resumeId: session.id });
    expect(resumed.title).toBe("Chosen name");
    expect(resumed.titleSource).toBe("user");
    expect(resumed.model).toBe("title-concurrent/cheap");
    await resumed.close();
  } finally {
    await session.close();
    await dirs.cleanup();
    if (original === undefined) delete process.env.RUKIE_TITLE_CONCURRENT_KEY;
    else process.env.RUKIE_TITLE_CONCURRENT_KEY = original;
  }
});

test("interrupting and disposing a Run while renaming preserves the fixed title", async () => {
  const dirs = await tempDirs();
  const primary = abortingModel();
  const title = createAssistantMessageEventStream();
  const session = await createSession({
    ...dirs,
    ...primary,
    models: withModelStream(
      primary.models,
      withAuxiliaryRequests(modelStream(primary.models), { titles: () => title }),
    ),
  });
  try {
    const run = session.run("Interrupted task").catch((error) => error);
    await primary.started;
    const rename = session.rename("Saved through interruption");
    await session.abort();
    await rename;
    expect(await run).toBeInstanceOf(Error);
    await session.close();
    const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    expect(resumed.title).toBe("Saved through interruption");
    expect(resumed.titleSource).toBe("user");
    await resumed.close();
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

test("rename persists while a manual summary is pending and survives compacted resume", async () => {
  const dirs = await tempDirs();
  const summarizing = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const fake = fakeModel(
    [
      fauxAssistantMessage("Work completed " + "old fact ".repeat(9000)),
      fauxAssistantMessage("Recent retained answer"),
      async () => {
        summarizing.resolve();
        await finish.promise;
        return fauxAssistantMessage("Summary of the completed work.");
      },
    ],
    { chunkTokens: 30000 },
  );
  const title = createAssistantMessageEventStream();
  const session = await createSession({
    ...dirs,
    ...fake,
    models: withModelStream(
      fake.models,
      withAuxiliaryRequests(modelStream(fake.models), { titles: () => title }),
    ),
  });
  try {
    await session.run("First task");
    await session.run("Recent retained task");
    const compact = session.compact();
    await summarizing.promise;
    await session.rename("Work summary");
    finish.resolve();
    await compact;
    await session.close();
    const resumed = await createSession({ ...dirs, ...fake, resumeId: session.id });
    expect(resumed.title).toBe("Work summary");
    expect(resumed.titleSource).toBe("user");
    expect(JSON.stringify(resumed.messages)).toContain("Summary of the completed work.");
    await resumed.close();
  } finally {
    finish.resolve();
    await session.close();
    await dirs.cleanup();
  }
});

test("a user can keep a meaningful manual title longer than the automatic model title limit", async () => {
  const dirs = await tempDirs();
  const session = await createSession({ ...dirs, ...fakeModel([]) });
  const name =
    "Investigate authentication, permission state, interrupted requests and restored conversation behavior";
  try {
    await session.rename(name);
    expect(session.title).toBe(name);
    await session.close();
    const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    expect(resumed.title).toBe(name);
    await resumed.close();
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});
