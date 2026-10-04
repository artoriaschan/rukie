import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
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
    stopReason: "hook_blocked",
    reason: "protected prompt",
  });
  expect(fake.contexts).toHaveLength(1);
  expect(JSON.stringify(fake.contexts[0])).toContain("Check this input:");
  expect(JSON.stringify(fake.contexts[0])).toContain("UserPromptSubmit");
  expect(JSON.stringify(session.messages)).not.toContain("secret");
  expect(JSON.stringify(session.messages)).not.toContain("protected prompt");
  expect(await Bun.file(transcriptPath).text()).not.toContain("protected prompt");
  expect(await Bun.file(transcriptPath).text()).not.toContain("secret");
  await session.dispose();
});

test("agent hooks inspect files with only read, glob and grep, without parent transcript writes", async () => {
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
    stopReason: "hook_blocked",
    reason: "policy check failed",
  });
  expect(fake.contexts).toHaveLength(2);
  expect(JSON.stringify(session.messages)).not.toContain("review-read");
  expect(JSON.stringify(session.messages)).not.toContain("policy check failed");
  await session.dispose();
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
      await session.dispose();
    }
  },
);

test.each(["prompt", "agent"] as const)(
  "%s hook denies a pending tool without executing it",
  async (type) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("bash", { command: "touch marker" }), {
        stopReason: "toolUse",
      }),
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
    await session.dispose();
  },
);

test.each([undefined, "override"])(
  "prompt hooks resolve reviewModel and handler model override: %s",
  async (override) => {
    dirs = await tempDirs();
    const fake = fakeModel([fauxAssistantMessage('{"ok":true}'), fauxAssistantMessage("done")]);
    const selected: string[] = [];
    const key = "NEANT_HOOK_MODEL_TEST_KEY";
    process.env[key] = "test-key";
    try {
      const session = await createSession({
        ...dirs,
        ...fake,
        streamFn: (model, context, options) => {
          selected.push(model.id);
          return fake.streamFn(model, context, options);
        },
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
      await session.dispose();
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
      streamFn: (model, context, options) => {
        if (calls++ === 0) {
          entered.resolve(options!.signal!);
          return new Promise(() => {});
        }
        return fake.streamFn(model, context, options);
      },
      onWarning() {},
      settings: {
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type, prompt: "check", timeout: 0.02 }] }],
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
    expect((await entered.promise).aborted).toBe(true);
    expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
      { error: { code: "hook-timeout", params: { timeout: "0.02" } } },
    ]);
    await session.dispose();
  },
);

test.each(["prompt", "agent"] as const)(
  "dispose cancels a pending %s hook without starting the main model",
  async (type) => {
    dirs = await tempDirs();
    const entered = Promise.withResolvers<AbortSignal>();
    const fake = fakeModel([]);
    let calls = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      streamFn: (_model, _context, options) => {
        calls++;
        entered.resolve(options!.signal!);
        return new Promise(() => {});
      },
      settings: {
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type, prompt: "check" }] }],
        },
      },
    });
    const run = session.run("hello").catch((error) => error);
    const signal = await entered.promise;
    await session.dispose();
    expect(await run).toMatchObject({ name: "AbortError" });
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
    await session.dispose();
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
    await session.dispose();
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
  await session.dispose();
});

test.each(["prompt", "agent"] as const)(
  "%s PermissionRequest rejection denies headless execution",
  async (type) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("bash", { command: "touch marker" }), {
        stopReason: "toolUse",
      }),
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
    await session.dispose();
  },
);
