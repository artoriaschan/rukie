import {
  withAuxiliaryRequests,
  modelStream,
  withModelStream,
  withModelAlias,
  deferredModelStream,
} from "../helpers/auxiliary-model.ts";
import { afterEach, expect, jest, test } from "bun:test";
import {
  fauxAssistantMessage,
  fauxToolCall,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { join } from "node:path";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("prompt hooks block a user prompt using one standalone review request", async () => {
  dirs = await tempDirs();
  let transcriptPath = "";
  const fake = fakeModel([
    async (context) => {
      const user = context.messages.find((message) => message.role === "user");
      if (
        user?.role !== "user" ||
        typeof user.content === "string" ||
        user.content[0]?.type !== "text"
      )
        throw new Error("Expected review prompt");
      const input = JSON.parse(user.content[0].text.slice("Check this input: ".length));
      transcriptPath = input.transcript_path;
      expect(input.prompt).toBe("secret");
      return fauxAssistantMessage('{"ok":false,"reason":"protected prompt"}');
    },
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "prompt", prompt: "Check this input: $ARGUMENTS" }] }],
      },
    },
  });
  expect(await session.run("secret")).toMatchObject({
    success: true,
    stopReason: "hook_blocked",
    reason: "protected prompt",
  });
  expect(fake.contexts).toHaveLength(1);
  expect(JSON.stringify(fake.contexts[0])).toContain("Check this input:");
  expect(JSON.stringify(fake.contexts[0])).toContain("UserPromptSubmit");
  expect(JSON.stringify(session.messages)).not.toContain("secret");
  expect(session.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "session-notice",
        notice: { kind: "hook_blocked", reason: "protected prompt" },
      }),
    ]),
  );
  expect(await Bun.file(transcriptPath).text()).toContain("session-notice");
  expect(await Bun.file(transcriptPath).text()).not.toContain("secret");
  await session.close();
});

test("agent hooks inspect files with only read, glob and grep, without copying review messages to the parent Transcript", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "policy.txt"), "protected");
  const fake = fakeModel([
    async (context) => {
      const declarations = context.messages.flatMap((message) =>
        message.role === "system" ? (message.toolsAdded ?? []) : [],
      );
      expect(declarations.map((tool) => tool.name).sort()).toEqual(["glob", "grep", "read"]);
      return fauxAssistantMessage(
        fauxToolCall("read", { path: "policy.txt" }, { id: "review-read" }),
        { stopReason: "toolUse" },
      );
    },
    async (context) => {
      expect(JSON.stringify(context.messages)).toContain("protected");
      return fauxAssistantMessage('{"ok":false,"reason":"policy check failed"}');
    },
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "agent", prompt: "Read policy.txt and check $ARGUMENTS" }] },
        ],
      },
    },
  });
  expect(await session.run("perform action")).toMatchObject({
    success: true,
    stopReason: "hook_blocked",
    reason: "policy check failed",
  });
  expect(fake.contexts).toHaveLength(2);
  expect(JSON.stringify(session.messages)).not.toContain("review-read");
  expect(session.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "session-notice",
        notice: { kind: "hook_blocked", reason: "policy check failed" },
      }),
    ]),
  );
  await session.close();
});

test.each(["prompt", "agent"] as const)(
  "%s hook allows valid output and fails open on malformed output",
  async (type) => {
    dirs = await tempDirs();
    for (const reply of [
      '{"ok":true}',
      "invalid",
      '{"ok":"false"}',
      '{"ok":false,"reason":42}',
      "[]",
    ]) {
      const fake = fakeModel([fauxAssistantMessage(reply), fauxAssistantMessage("parent result")]);
      const events: SessionEvent[] = [];
      const session = await createSession({
        ...dirs,
        ...fake,
        onWarning() {},
        settings: {
          hooks: {
            UserPromptSubmit: [{ hooks: [{ type, prompt: "Evaluate $ARGUMENTS" }] }],
          },
        },
      });
      expect(
        await session.run("hello", {
          onEvent: (event) => {
            events.push(event);
          },
        }),
      ).toMatchObject({ text: "parent result" });
      expect(events.filter((event) => event.type === "hook_warning")).toHaveLength(
        reply === '{"ok":true}' ? 0 : 1,
      );
      expect(session.messages.filter((message) => message.role === "assistant")).toMatchObject([
        { content: [{ type: "text", text: "parent result" }] },
      ]);
      await session.close();
    }
  },
);

test.each(["prompt", "agent"] as const)(
  "%s hook denies a pending tool without executing it",
  async (type) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", { description: "Run test command", command: "touch marker" }),
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage('{"ok":false,"reason":"protected tool"}'),
      fauxAssistantMessage("parent done"),
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      settings: {
        hooks: {
          PreToolUse: [{ hooks: [{ type, prompt: "Check $ARGUMENTS" }] }],
        },
      },
    });
    await session.run("do it", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
    expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
      { by: "hook", reason: "Denied by hook: protected tool" },
    ]);
    expect(JSON.stringify(fake.contexts.at(-1)?.messages)).toContain("protected tool");
    await session.close();
  },
);

test.each([undefined, "override"])(
  "prompt hooks resolve reviewModel and handler model override: %s",
  async (override) => {
    dirs = await tempDirs();
    const fake = fakeModel([fauxAssistantMessage('{"ok":true}'), fauxAssistantMessage("done")]);
    fake.models = withModelAlias(fake.models, "hook-review", ["cheap", "override"]);
    const selected: string[] = [];
    const key = "RUKIE_HOOK_MODEL_TEST_KEY";
    process.env[key] = "test-key";
    try {
      const session = await createSession({
        ...dirs,
        ...fake,
        models: withModelStream(
          fake.models,
          withAuxiliaryRequests((model, context, options) => {
            selected.push(model.id);
            return modelStream(fake.models)(model, context, options);
          }),
        ),
        settings: {
          reviewModel: "hook-review/cheap",
          providers: [
            {
              id: "hook-review",
              api: "openai-completions",
              apiKeyEnv: key,
              baseUrl: "http://localhost:1",
              models: [{ id: "cheap" }, { id: "override" }],
            },
          ],
          hooks: {
            UserPromptSubmit: [
              {
                hooks: [
                  {
                    type: "prompt",
                    prompt: "check",
                    ...(override && { model: `hook-review/${override}` }),
                  },
                ],
              },
            ],
          },
        },
      });
      await session.run("hello");
      expect(selected[0]).toBe(override ?? "cheap");
      expect(selected[1]).toBe(fake.model.id);
      await session.close();
    } finally {
      delete process.env[key];
    }
  },
);

test.each(["prompt", "agent"] as const)(
  "%s hook timeout aborts its stream and fails open",
  async (type) => {
    dirs = await tempDirs();
    const entered = Promise.withResolvers<AbortSignal>();
    const fake = fakeModel([fauxAssistantMessage("parent result")]);
    let calls = 0;
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      models: withModelStream(
        fake.models,
        withAuxiliaryRequests((model, context, options) => {
          if (calls++ === 0) {
            entered.resolve(options!.signal!);
            return createAssistantMessageEventStream();
          }
          return modelStream(fake.models)(model, context, options);
        }),
      ),
      onWarning() {},
      settings: {
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type, prompt: "check", timeout: 0.02 }] }],
        },
      },
    });
    jest.useFakeTimers();
    try {
      const run = session.run("hello", {
        onEvent: (event) => {
          events.push(event);
        },
      });
      const signal = await entered.promise;
      jest.advanceTimersByTime(19);
      expect(signal.aborted).toBe(false);
      jest.advanceTimersByTime(1);
      expect(await run).toMatchObject({ text: "parent result" });
      expect(signal.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
    expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
      { error: { code: "hook-timeout", params: { timeout: "0.02" } } },
    ]);
    await session.close();
  },
);

test.each(["prompt", "agent"] as const)(
  "close cancels a pending %s hook without starting the main model",
  async (type) => {
    dirs = await tempDirs();
    const entered = Promise.withResolvers<AbortSignal>();
    const fake = fakeModel([]);
    let calls = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      models: withModelStream(
        fake.models,
        withAuxiliaryRequests((_model, _context, options) => {
          calls++;
          entered.resolve(options!.signal!);
          return createAssistantMessageEventStream();
        }),
      ),
      settings: {
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type, prompt: "check" }] }],
        },
      },
    });
    const run = session.run("hello").catch((error) => error);
    const signal = await entered.promise;
    await session.close();
    expect(await run).toMatchObject({ message: "Session is closed" });
    expect(signal.aborted).toBe(true);
    expect(calls).toBe(1);
  },
);

test.each(["prompt", "agent"] as const)(
  "%s Stop hook false continues the parent run and true allows completion",
  async (type) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage("initial result"),
      fauxAssistantMessage('{"ok":false,"reason":"finish verification"}'),
      fauxAssistantMessage("verified result"),
      fauxAssistantMessage('{"ok":true}'),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        hooks: {
          Stop: [{ hooks: [{ type, prompt: "Review $ARGUMENTS" }] }],
        },
      },
    });
    const events: SessionEvent[] = [];
    expect(
      await session.run("work", {
        onEvent: (event) => {
          events.push(event);
        },
      }),
    ).toMatchObject({ text: "verified result" });
    expect(events.filter((event) => event.type === "hook_continued")).toMatchObject([
      { event: "Stop", reason: "finish verification" },
    ]);
    expect(session.messages.filter((message) => message.role === "assistant")).toHaveLength(2);
    await session.close();
  },
);

test.each(["prompt", "agent"] as const)(
  "%s rejection does not block SessionStart",
  async (type) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage('{"ok":false,"reason":"startup check"}'),
      fauxAssistantMessage("parent result"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        hooks: {
          SessionStart: [{ hooks: [{ type, prompt: "Review $ARGUMENTS" }] }],
        },
      },
    });
    expect(await session.run("work")).toMatchObject({ text: "parent result" });
    await session.close();
  },
);

test("an unavailable hook model warns without calling it and the parent run proceeds", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("parent result")]);
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning() {},
    settings: {
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "prompt", model: "missing/model", prompt: "check" }] },
        ],
      },
    },
  });
  expect(
    await session.run("work", {
      onEvent: (event) => {
        events.push(event);
      },
    }),
  ).toMatchObject({ text: "parent result" });
  expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
    { error: { code: "hook-model-failed" } },
  ]);
  expect(fake.contexts).toHaveLength(1);
  await session.close();
});

test.each(["prompt", "agent"] as const)(
  "%s PermissionRequest rejection denies headless execution",
  async (type) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", { description: "Run test command", command: "touch marker" }),
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage('{"ok":false,"reason":"approval policy"}'),
      fauxAssistantMessage("parent done"),
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "ask",
      settings: {
        hooks: {
          PermissionRequest: [{ hooks: [{ type, prompt: "Review $ARGUMENTS" }] }],
        },
      },
    });
    await session.run("do it", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
    expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
      { by: "hook", reason: "approval policy" },
    ]);
    await session.close();
  },
);

test.each(["prompt", "agent"] as const)(
  "%s $ARGUMENTS substitution preserves literal replacement tokens",
  async (type) => {
    dirs = await tempDirs();
    const prompt = "literal $& $' $` $$ test";
    const fake = fakeModel([
      async (context) => {
        const user = context.messages.find((message) => message.role === "user");
        if (
          user?.role !== "user" ||
          typeof user.content === "string" ||
          user.content[0]?.type !== "text"
        )
          throw new Error("Expected review prompt");
        const input = JSON.parse(user.content[0].text.slice("check ".length));
        expect(input.prompt).toBe(prompt);
        return fauxAssistantMessage('{"ok":true}');
      },
      fauxAssistantMessage("parent done"),
    ]);
    const warnings: string[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      onWarning: (warning) => {
        warnings.push(warning);
      },
      settings: {
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type, prompt: "check $ARGUMENTS" }] }],
        },
      },
    });
    expect(await session.run(prompt)).toMatchObject({ text: "parent done" });
    expect(warnings).toHaveLength(0);
    await session.close();
  },
);

test.each(["prompt", "agent"] as const)(
  "%s PostToolUse rejection preserves the successful result and adds feedback",
  async (type) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", { description: "Run test command", command: "printf original" }),
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage('{"ok":false,"reason":"verify output"}'),
      fauxAssistantMessage("parent done"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      settings: {
        hooks: {
          PostToolUse: [{ hooks: [{ type, prompt: "Review $ARGUMENTS" }] }],
        },
      },
    });
    expect(await session.run("do it")).toMatchObject({ text: "parent done" });
    const toolResult = fake.contexts
      .at(-1)
      ?.messages.find((message) => message.role === "toolResult");
    expect(toolResult).toMatchObject({ isError: false });
    expect(JSON.stringify(toolResult)).toContain("original");
    expect(JSON.stringify(toolResult)).toContain("verify output");
    expect(JSON.stringify(toolResult)).toContain("<system-reminder>");
    await session.close();
  },
);

test.each(["prompt", "agent"] as const)(
  "%s hook ignores a late stream error after timeout",
  async (type) => {
    dirs = await tempDirs();
    const late = Promise.withResolvers<never>();
    const entered = Promise.withResolvers<void>();
    const fake = fakeModel([fauxAssistantMessage("parent result")]);
    let calls = 0;
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      models: withModelStream(
        fake.models,
        withAuxiliaryRequests((model, context, options) => {
          if (calls++ === 0) {
            entered.resolve();
            return deferredModelStream(late.promise);
          }
          return modelStream(fake.models)(model, context, options);
        }),
      ),
      onWarning() {},
      settings: {
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type, prompt: "check", timeout: 0.02 }] }],
        },
      },
    });
    jest.useFakeTimers();
    try {
      const run = session.run("hello", {
        onEvent: (event) => {
          events.push(event);
        },
      });
      await entered.promise;
      jest.advanceTimersByTime(19);
      expect(events.filter((event) => event.type === "hook_warning")).toHaveLength(0);
      jest.advanceTimersByTime(1);
      expect(await run).toMatchObject({ text: "parent result" });
    } finally {
      jest.useRealTimers();
    }
    late.reject(new Error("late hook stream failure"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(events.filter((event) => event.type === "hook_warning")).toHaveLength(1);
    expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
      { error: { code: "hook-timeout" } },
    ]);
    expect(session.messages.filter((message) => message.role === "assistant")).toMatchObject([
      { content: [{ text: "parent result" }] },
    ]);
    await session.close();
  },
);

test.each(["prompt", "agent"] as const)(
  "user cancellation interrupts a pending %s hook",
  async (type) => {
    dirs = await tempDirs();
    const entered = Promise.withResolvers<AbortSignal>();
    const fake = fakeModel([]);
    const session = await createSession({
      ...dirs,
      ...fake,
      models: withModelStream(
        fake.models,
        withAuxiliaryRequests((_model, _context, options) => {
          entered.resolve(options!.signal!);
          return createAssistantMessageEventStream();
        }),
      ),
      settings: { hooks: { UserPromptSubmit: [{ hooks: [{ type, prompt: "check" }] }] } },
    });
    const controller = new AbortController();
    const running = session.run("hello", { signal: controller.signal }).catch((error) => error);
    const signal = await entered.promise;
    controller.abort();
    expect(await running).toMatchObject({ name: "AbortError" });
    expect(signal.aborted).toBe(true);
    expect(
      session.messages.some((message) => message.role === "user" || message.role === "assistant"),
    ).toBe(false);
    await session.close();
  },
);

test.each(["prompt", "agent"] as const)(
  "%s Notification rejection never delays approval or enters the parent transcript",
  async (type) => {
    dirs = await tempDirs();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const returned = Promise.withResolvers<void>();
    let transcriptPath = "";
    let approved = false;
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", {
          description: "Run test command",
          command: "printf original > marker",
        }),
        {
          stopReason: "toolUse",
        },
      ),
      async (context) => {
        const user = context.messages.find((message) => message.role === "user");
        if (
          user?.role !== "user" ||
          typeof user.content === "string" ||
          user.content[0]?.type !== "text"
        )
          throw new Error("Expected notification review prompt");
        const text = user.content[0].text;
        expect(text.startsWith("notification guard ")).toBe(true);
        const input = JSON.parse(text.slice("notification guard ".length));
        expect(input.hook_event_name).toBe("Notification");
        transcriptPath = input.transcript_path;
        entered.resolve();
        await release.promise;
        returned.resolve();
        return fauxAssistantMessage('{"ok":false,"reason":"notification rejection"}');
      },
      async () => {
        expect(approved).toBe(true);
        release.resolve();
        await returned.promise;
        return fauxAssistantMessage("parent result");
      },
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "ask",
      onPermissionAsk: async () => {
        await entered.promise;
        approved = true;
        return "allow";
      },
      settings: {
        hooks: {
          Notification: [
            {
              matcher: "permission_prompt",
              hooks: [{ type, prompt: "notification guard $ARGUMENTS" }],
            },
          ],
        },
      },
    });
    try {
      expect(
        await session.run("do it", {
          onEvent: (event) => {
            events.push(event);
          },
        }),
      ).toMatchObject({ text: "parent result" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(await Bun.file(join(dirs.cwd, "marker")).text()).toBe("original");
      expect(
        events.filter(
          (event) =>
            event.type === "permission_denied" ||
            event.type === "hook_continued" ||
            event.type === "hook_warning",
        ),
      ).toHaveLength(0);
      expect(JSON.stringify(session.messages)).not.toContain("notification rejection");
      expect(JSON.stringify(session.messages)).not.toContain("notification guard");
      const transcript = await Bun.file(transcriptPath).text();
      expect(transcript).not.toContain("notification rejection");
      expect(transcript).not.toContain("notification guard");
    } finally {
      release.resolve();
      await session.close();
    }
  },
);
