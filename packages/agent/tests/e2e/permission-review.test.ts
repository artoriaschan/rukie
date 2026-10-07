import {
  withAuxiliaryRequests,
  modelStream,
  withModelStream,
  withModelAlias,
  deferredModelStream,
  type ModelStream,
} from "../helpers/auxiliary-model.ts";
import { afterEach, expect, jest, test } from "bun:test";
import {
  fauxAssistantMessage,
  fauxToolCall,
  createAssistantMessageEventStream,
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import {
  awaitWithContext,
  withAbortSignal,
  BACKGROUND_CONTEXT,
} from "@earendil-works/chord/context";
import { join } from "node:path";
import {
  createSession as createSessionImpl,
  type Session,
  type PermissionAskRequest,
  type SessionEvent,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { abortingModel } from "../helpers/aborting-model.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
async function createSession(options: Parameters<typeof createSessionImpl>[0]) {
  const session = await createSessionImpl(options);
  sessions.push(session);
  return session;
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await dirs?.cleanup();
});

function reviewedModel(review = fauxAssistantMessage('{"risk":"low","decision":"allow"}')) {
  const main = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("write", { path: "reviewed.txt", content: "safe" }, { id: "write-review" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const reviewer = fakeModel([review]);
  const streamFn: ModelStream = withAuxiliaryRequests((model, context, options) =>
    context.messages.some(
      (message) => message.role === "system" && JSON.stringify(message).includes("REVIEW_POLICY"),
    )
      ? modelStream(reviewer.models)(model, context, options)
      : modelStream(main.models)(model, context, options),
  );
  return { ...main, models: withModelStream(main.models, streamFn), reviewer, main };
}

test("auto-review allows a safe call and emits its review outcome without asking", async () => {
  dirs = await tempDirs();
  const fake = reviewedModel();
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "auto-review",
    onPermissionAsk: async () => {
      throw new Error("safe calls must not ask");
    },
  });
  expect(
    (
      await session.run("write the file", {
        onEvent: (event) => {
          events.push(event);
        },
      })
    ).text,
  ).toBe("done");
  expect(await Bun.file(join(dirs.cwd, "reviewed.txt")).text()).toBe("safe");
  expect(events.filter((event) => event.type === "permission_review")).toEqual([
    {
      type: "permission_review",
      phase: "start",
      sessionId: session.id,
      toolCallId: "write-review",
      toolName: "write",
    },
    {
      type: "permission_review",
      phase: "end",
      sessionId: session.id,
      toolCallId: "write-review",
      risk: "low",
      decision: "allow",
    },
  ]);
});

test("old review history truncates first while keeping current authorization and the pending action", async () => {
  dirs = await tempDirs();
  const fake = reviewedModel();
  // Keep old history below main compaction but above the half-window review budget.
  fake.models = withModelAlias(fake.models, "review-small", ["small-review"], {
    contextWindow: 16000,
  });
  const reviewerProvider = fake.models.getProvider("review-small")!;
  fake.models.setProvider({
    ...reviewerProvider,
    streamSimple: (model, context, options) =>
      modelStream(fake.reviewer.models)({ ...model, provider: "faux" }, context, options),
  });
  const replies = [
    fauxAssistantMessage("short"),
    fauxAssistantMessage(fauxToolCall("write", { path: "reviewed.txt", content: "safe" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ];
  for (const reply of replies)
    reply.usage = { ...reply.usage, input: 5000, cacheRead: 0, cacheWrite: 0 };
  const main = fakeModel(replies);
  fake.main.models = withModelStream(fake.main.models, modelStream(main.models));
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "auto-review",
    settings: { reviewModel: "review-small/small-review" },
  });
  await session.run("OLD_HISTORY ".repeat(3000));
  await session.run("CURRENT_AUTHORIZATION");
  expect(fake.reviewer.contexts).toHaveLength(1);
  const text = JSON.stringify(fake.reviewer.contexts[0]);
  expect(text).not.toContain("OLD_HISTORY");
  expect(text).toContain("CURRENT_AUTHORIZATION");
  expect(text).toContain("reviewed.txt");
  expect(await Bun.file(join(dirs.cwd, "reviewed.txt")).text()).toBe("safe");
});

test("oversized required review input asks without sending a reviewer request", async () => {
  dirs = await tempDirs();
  const fake = reviewedModel();
  fake.model.contextWindow = 4000;
  // Main turns may compact old work; an oversized pending action cannot be removed.
  fake.main.models = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("write", { path: "reviewed.txt", content: "x".repeat(10_000) }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("summary"),
    fauxAssistantMessage("done"),
  ]).models;
  const requests: PermissionAskRequest[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "auto-review",
    onPermissionAsk: async (request) => {
      requests.push(request);
      return "deny";
    },
  });
  await session.run("write");
  expect(requests[0]?.reason).toContain("half the context window");
  expect(fake.reviewer.contexts).toEqual([]);
  expect(await Bun.file(join(dirs.cwd, "reviewed.txt")).exists()).toBe(false);
});

test("review tokens and review messages are excluded from Run usage and Context Usage", async () => {
  dirs = await tempDirs();
  const fake = reviewedModel();
  const first = fauxAssistantMessage(
    fauxToolCall("write", { path: "reviewed.txt", content: "safe" }),
    { stopReason: "toolUse" },
  );
  const second = fauxAssistantMessage("done");
  const review = fauxAssistantMessage('{"risk":"medium","decision":"allow"}');
  for (const reply of [first, second])
    reply.usage = { ...reply.usage, input: 11, output: 5, totalTokens: 16 };
  review.usage = { ...review.usage, input: 40_000, output: 10_000, totalTokens: 50_000 };
  const responses = [first, review, second];
  const streamFn: ModelStream = withAuxiliaryRequests(() => {
    const reply = responses.shift()!;
    const stream = createAssistantMessageEventStream();
    stream.push({
      type: "done",
      reason: reply.stopReason === "toolUse" ? "toolUse" : "stop",
      message: reply,
    });
    stream.end(reply);
    return stream;
  });
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    models: withModelStream(fake.models, streamFn),
    permissionMode: "auto-review",
  });
  const result = await session.run("write", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(result.usage).toMatchObject({ input: 22, output: 10, totalTokens: 32 });
  expect(events.filter((event) => event.type === "context_usage").slice(1)).toMatchObject([
    { used: 11 },
    { used: 11 },
    { used: 11 },
  ]);
  expect(JSON.stringify(session.messages)).not.toContain("REVIEW_POLICY");
  expect(session.messages.filter((message) => message.role === "assistant")).toHaveLength(2);
});

test("reviewModel selects a separate model with temperature zero using the Session Models registry", async () => {
  dirs = await tempDirs();
  const fake = reviewedModel();
  let selected: Model<Api> | undefined;
  let temperature: number | undefined;
  fake.reviewer.models = withModelAlias(fake.reviewer.models, "review-test", ["cheap"], {
    contextWindow: 8000,
  });
  fake.models = withModelAlias(fake.models, "review-test", ["cheap"], { contextWindow: 8000 });
  const reviewStream = modelStream(fake.reviewer.models);
  fake.reviewer.models = withModelStream(
    fake.reviewer.models,
    withAuxiliaryRequests((model, context, options) => {
      selected = model;
      temperature = options?.temperature;
      return reviewStream(model, context, options);
    }),
  );
  const env = "RUKIE_PERMISSION_REVIEW_TEST_KEY";
  process.env[env] = "test-key";
  try {
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "auto-review",
      settings: {
        reviewModel: "review-test/cheap",
        providers: [
          {
            id: "review-test",
            api: "openai-completions",
            apiKeyEnv: env,
            baseUrl: "http://localhost:1",
            models: [{ id: "cheap", contextWindow: 8000 }],
          },
        ],
      },
    });
    await session.run("write");
    expect(selected).toMatchObject({ provider: "review-test", id: "cheap", contextWindow: 8000 });
    expect(temperature).toBe(0);
    expect(await Bun.file(join(dirs.cwd, "reviewed.txt")).text()).toBe("safe");
  } finally {
    delete process.env[env];
  }
});

test("an unavailable review model falls back to asking without failing the main Run", async () => {
  dirs = await tempDirs();
  const fake = reviewedModel();
  const requests: PermissionAskRequest[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "auto-review",
    settings: { reviewModel: "missing/model" },
    onPermissionAsk: async (request) => {
      requests.push(request);
      return "deny";
    },
  });
  expect((await session.run("write")).text).toBe("done");
  expect(requests[0]?.reason).toContain("Unknown model");
  expect(fake.reviewer.contexts).toEqual([]);
});

test("aborting an uncooperative review cancels it and never asks or executes", async () => {
  dirs = await tempDirs();
  const fake = reviewedModel();
  const started = Promise.withResolvers<AbortSignal>();
  fake.reviewer.models = withModelStream(
    fake.reviewer.models,
    withAuxiliaryRequests((_model, _context, options) => {
      started.resolve(options!.signal!);
      return createAssistantMessageEventStream();
    }),
  );
  const requests: PermissionAskRequest[] = [];
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "auto-review",
    onPermissionAsk: async (request) => {
      requests.push(request);
      return "allow";
    },
  });
  const controller = new AbortController();
  const run = session.run("write", {
    signal: controller.signal,
    onEvent: (event) => {
      events.push(event);
    },
  });
  void run.catch(() => {});
  const reviewSignal = await started.promise;
  controller.abort(new Error("cancel review"));
  await expect(run).rejects.toThrow("cancel review");
  expect(reviewSignal.aborted).toBe(true);
  expect(requests).toEqual([]);
  expect(events.filter((event) => event.type === "permission_review")).toMatchObject([
    { phase: "start" },
    { phase: "end", decision: "deny", reason: expect.stringContaining("cancelled") },
  ]);
  expect(events.at(-1)).toMatchObject({ type: "result", success: false });
  expect(await Bun.file(join(dirs.cwd, "reviewed.txt")).exists()).toBe(false);
});

test("a review still pending at 30s cancels its request and asks the user", async () => {
  dirs = await tempDirs();
  const fake = reviewedModel();
  const slow = abortingModel();
  fake.reviewer.models = withModelStream(fake.reviewer.models, modelStream(slow.models));
  const requests: PermissionAskRequest[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "auto-review",
    onPermissionAsk: async (request) => {
      requests.push(request);
      return "deny";
    },
  });
  jest.useFakeTimers();
  try {
    const run = session.run("write");
    await slow.started;
    jest.advanceTimersByTime(29_999);
    expect(requests).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect((await run).text).toBe("done");
    expect(requests[0]?.reason).toContain("30s timeout");
    expect(await Bun.file(join(dirs.cwd, "reviewed.txt")).exists()).toBe(false);
  } finally {
    try {
      await session.close();
    } finally {
      jest.useRealTimers();
    }
  }
}, 35_000);

test("review uses project instructions and user/call history without assistant text, thinking or results", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Do not publish outside this project.");
  await Bun.write(join(dirs.cwd, "file.txt"), "INJECTED_TOOL_RESULT");
  const fake = reviewedModel();
  const scripted = fakeModel([
    fauxAssistantMessage(
      [
        { type: "text", text: "INJECTED_ASSISTANT_TEXT" },
        { type: "thinking", thinking: "INJECTED_THINKING" },
        fauxToolCall("read", { path: "file.txt" }, { id: "earlier-read" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("write", { path: "reviewed.txt", content: "safe" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  fake.main.models = withModelStream(fake.main.models, modelStream(scripted.models));
  const session = await createSession({ ...dirs, ...fake, permissionMode: "auto-review" });
  await session.run("create the file within this project");
  const text = JSON.stringify(fake.reviewer.contexts[0]);
  expect(text).toContain(dirs.cwd);
  expect(text).toContain("Do not publish outside this project.");
  expect(text).toContain("create the file within this project");
  expect(text).toContain('\\"name\\":\\"read\\"');
  expect(text).toContain("file.txt");
  expect(text).toContain("description");
  expect(text).toContain("parameters");
  expect(text).not.toContain("INJECTED_");
});

test("review discards history and summary before the most recent compaction, including on resume", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Keep the public API stable.");
  const previous = fakeModel([
    fauxAssistantMessage("old work"),
    fauxAssistantMessage("after compaction"),
    fauxAssistantMessage("COMPACTED_SUMMARY"),
  ]);
  const original = await createSession({ ...dirs, ...previous });
  await original.run("OLD_AUTHORIZATION");
  await original.run("POST_COMPACTION_INSTRUCTION " + "retained fact ".repeat(6000));
  await original.compact();
  await original.close();
  const fake = reviewedModel();
  const session = await createSession({
    ...dirs,
    ...fake,
    resumeId: original.id,
    permissionMode: "auto-review",
  });
  await session.run("CURRENT_AUTHORIZATION");
  const text = JSON.stringify(fake.reviewer.contexts[0]);
  expect(text).toContain("Keep the public API stable.");
  expect(text).toContain("POST_COMPACTION_INSTRUCTION");
  expect(text).toContain("CURRENT_AUTHORIZATION");
  expect(text).not.toContain("OLD_AUTHORIZATION");
  expect(text).not.toContain("COMPACTED_SUMMARY");
});

test("parallel tool calls start their reviews before either review completes", async () => {
  dirs = await tempDirs();
  const fake = reviewedModel();
  const main = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("write", { path: "a.txt", content: "a" }, { id: "a" }),
        fauxToolCall("write", { path: "b.txt", content: "b" }, { id: "b" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const both = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let started = 0;
  fake.reviewer.models = withModelStream(
    fake.reviewer.models,
    withAuxiliaryRequests((model, context, options) =>
      deferredModelStream(
        (async () => {
          if (++started === 2) both.resolve();
          await release.promise;
          return modelStream(
            fakeModel([fauxAssistantMessage('{"risk":"low","decision":"allow"}')]).models,
          )(model, context, options);
        })(),
      ),
    ),
  );
  const models = withModelStream(
    main.models,
    withAuxiliaryRequests((model, context, options) =>
      context.messages.some(
        (message) => message.role === "system" && JSON.stringify(message).includes("REVIEW_POLICY"),
      )
        ? modelStream(fake.reviewer.models)(model, context, options)
        : modelStream(main.models)(model, context, options),
    ),
  );
  const session = await createSession({ ...dirs, ...main, models, permissionMode: "auto-review" });
  const controller = new AbortController();
  const run = session.run("create both files", { signal: controller.signal });
  void run.catch(() => {});
  try {
    // This deadline bounds an event wait; it does not pace or synchronize the test.
    await awaitWithContext(
      both.promise,
      withAbortSignal(AbortSignal.timeout(300), BACKGROUND_CONTEXT),
    );
  } catch (error) {
    throw new Error(`Only ${started} permission reviews started before completion`, {
      cause: error,
    });
  } finally {
    release.resolve();
    if (started !== 2) controller.abort();
    await run.catch(() => {});
  }
  expect(await Bun.file(join(dirs.cwd, "a.txt")).text()).toBe("a");
  expect(await Bun.file(join(dirs.cwd, "b.txt")).text()).toBe("b");
});

test.each(["medium", "high"])(
  "a %s review denial asks with its reason, but rejection is private from the model",
  async (risk) => {
    dirs = await tempDirs();
    const reason = "target was not explicitly authorized";
    const fake = reviewedModel(
      fauxAssistantMessage(JSON.stringify({ risk, decision: "deny", reason })),
    );
    const requests: PermissionAskRequest[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "auto-review",
      onPermissionAsk: async (request) => {
        requests.push(request);
        return "deny";
      },
    });
    expect((await session.run("inspect the project")).text).toBe("done");
    expect(requests).toMatchObject([{ mode: "auto-review", reason }]);
    expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
      role: "toolResult",
      isError: true,
      content: [
        { type: "text", text: expect.stringContaining("User denied this tool call: write") },
      ],
    });
    expect(JSON.stringify(fake.contexts)).not.toContain(reason);
    expect(await Bun.file(join(dirs.cwd, "reviewed.txt")).exists()).toBe(false);
  },
);

test("the user can allow a call rejected by the reviewer", async () => {
  dirs = await tempDirs();
  const fake = reviewedModel(fauxAssistantMessage('{"risk":"high","decision":"deny"}'));
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "auto-review",
    onPermissionAsk: async (request) => {
      expect(request.reason).toContain("high");
      return "allow";
    },
  });
  await session.run("write");
  expect(await Bun.file(join(dirs.cwd, "reviewed.txt")).text()).toBe("safe");
});

test("switching mode while answering a review applies to the next admitted Turn", async () => {
  dirs = await tempDirs();
  const fake = reviewedModel(fauxAssistantMessage('{"risk":"high","decision":"deny"}'));
  fake.main.models = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("write", { path: "first.txt", content: "first" }, { id: "first" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("write", { path: "second.txt", content: "second" }, { id: "second" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]).models;
  const requests: PermissionAskRequest[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "auto-review",
    onPermissionAsk: async (request) => {
      requests.push(request);
      session.setPermissionMode("full-access");
      return "deny";
    },
  });
  expect((await session.run("write both files")).text).toBe("done");
  expect(requests).toMatchObject([
    { toolCallId: "first", mode: "auto-review", reason: expect.stringContaining("high") },
  ]);
  expect(await Bun.file(join(dirs.cwd, "first.txt")).exists()).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "second.txt")).text()).toBe("second");
});

test.each([
  "not JSON",
  "[]",
  "null",
  '{"risk":"low","decision":"deny"}',
  '{"risk":"high","decision":"allow"}',
  '{"risk":"low","decision":"allow","reason":"safe"}',
  '{"risk":"medium","decision":"deny","extra":true}',
  '{"risk":"high","decision":"deny","reason":42}',
  '{"risk":"high","decision":"deny","decision":"allow"}',
  '```json\n{"risk":"low","decision":"allow"}\n```',
])("invalid review %s falls back to asking", async (reply) => {
  dirs = await tempDirs();
  const fake = reviewedModel(fauxAssistantMessage(reply));
  const requests: PermissionAskRequest[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "auto-review",
    onPermissionAsk: async (request) => {
      requests.push(request);
      return "allow";
    },
  });
  await session.run("write");
  expect(requests).toMatchObject([
    { mode: "auto-review", reason: expect.stringContaining("failed") },
  ]);
  expect(await Bun.file(join(dirs.cwd, "reviewed.txt")).text()).toBe("safe");
});

test.each(["error", "length", "toolUse"] as const)(
  "a review ending with %s falls back to asking",
  async (stopReason) => {
    dirs = await tempDirs();
    const fake = reviewedModel(
      fauxAssistantMessage('{"risk":"low","decision":"allow"}', {
        stopReason,
        errorMessage: "provider unavailable",
      }),
    );
    const requests: PermissionAskRequest[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "auto-review",
      onPermissionAsk: async (request) => {
        requests.push(request);
        return "deny";
      },
    });
    expect((await session.run("write")).text).toBe("done");
    expect(requests[0]?.reason).toContain("failed");
    expect(await Bun.file(join(dirs.cwd, "reviewed.txt")).exists()).toBe(false);
  },
);

test.each(["throw", "reject"])(
  "a provider that fails by %s falls back to asking",
  async (failure) => {
    dirs = await tempDirs();
    const fake = reviewedModel();
    fake.reviewer.models = withModelStream(
      fake.reviewer.models,
      withAuxiliaryRequests(() => {
        if (failure === "throw") throw new Error("provider offline");
        return deferredModelStream(Promise.reject(new Error("provider offline")));
      }),
    );
    const requests: PermissionAskRequest[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "auto-review",
      onPermissionAsk: async (request) => {
        requests.push(request);
        return "deny";
      },
    });
    expect((await session.run("write")).text).toBe("done");
    expect(requests[0]?.reason).toContain("provider offline");
    expect(await Bun.file(join(dirs.cwd, "reviewed.txt")).exists()).toBe(false);
  },
);

test("a batch reviews only valid calls that still require permission", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "file.txt"), "visible");
  const fake = reviewedModel();
  const main = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("read", { path: "file.txt" }, { id: "read" }),
        fauxToolCall(
          "bash",
          { description: "Run test command", command: "printf allowed" },
          { id: "allowed" },
        ),
        fauxToolCall("write", { path: "invalid.txt" }, { id: "invalid" }),
        fauxToolCall("write", { path: "reviewed.txt", content: "safe" }, { id: "reviewed" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  fake.main.models = withModelStream(fake.main.models, modelStream(main.models));
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "auto-review",
    allowRules: ["bash"],
    onPermissionAsk: async () => {
      throw new Error("must not ask");
    },
  });
  await session.run("inspect and write", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(fake.reviewer.contexts).toHaveLength(1);
  expect(events.filter((event) => event.type === "permission_review")).toMatchObject([
    { phase: "start", toolCallId: "reviewed" },
    { phase: "end", toolCallId: "reviewed", decision: "allow" },
  ]);
  expect(
    main.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
  ).toMatchObject([
    { toolCallId: "read", isError: false },
    { toolCallId: "allowed", isError: false },
    { toolCallId: "invalid", isError: true },
    { toolCallId: "reviewed", isError: false },
  ]);
  expect(await Bun.file(join(dirs.cwd, "reviewed.txt")).text()).toBe("safe");
});
