import { withAuxiliaryRequests, withModelStream, modelStream } from "../helpers/auxiliary-model.ts";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import {
  createSession as createSessionImpl,
  type Session,
  type PlanReviewRequest,
  type PlanReviewResult,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
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
const plan = "# Implementation\n\n1. Add storage\n2. Run tests";
const submit = () =>
  fauxAssistantMessage(fauxToolCall("exit_plan_mode", { plan }), { stopReason: "toolUse" });
test("approval exits Plan Mode, keeps permissions and injects execution guidance once", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    submit(),
    fauxAssistantMessage("executed"),
    fauxAssistantMessage("next"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onPlanReview: async (request, signal) => {
      expect(request.plan).toBe(plan);
      expect(signal).toBe(request.signal);
      return { kind: "approve" };
    },
    onPermissionAsk: async () => {
      throw new Error("unexpected permission ask");
    },
  });
  await session.setPlanMode(true);
  await session.run("plan");
  expect(session.planMode).toBe(false);
  expect(session.permissionMode).toBe("ask");
  expect(JSON.stringify(fake.contexts[0])).toContain("submit the plan with exit_plan_mode");
  expect(fake.contexts[1]!.messages.find((message) => message.role === "toolResult")).toMatchObject(
    { role: "toolResult", isError: false },
  );
  expect(JSON.stringify(fake.contexts[1])).toContain("You have exited Plan Mode");
  await session.run("next");
  expect(
    fake.contexts[2]!.messages.slice(fake.contexts[1]!.messages.length)
      .map((message) => JSON.stringify(message))
      .join(""),
  ).not.toContain("You have exited Plan Mode");
});
test.each(["", "Use SQLite 2, keep API stable"])(
  "revision preserves Plan Mode and returns feedback (%s)",
  async (feedback) => {
    dirs = await tempDirs();
    const fake = fakeModel([submit(), fauxAssistantMessage("revised")]);
    const session = await createSession({
      ...dirs,
      ...fake,
      onPlanReview: async () => ({ kind: "revise", feedback }),
    });
    await session.setPlanMode(true);
    expect((await session.run("plan")).text).toBe("revised");
    expect(session.planMode).toBe(true);
    const result = fake.contexts[1]!.messages.find((message) => message.role === "toolResult");
    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain(feedback || "continued planning");
  },
);
test("takeover terminates the Run before another model call", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([submit(), fauxAssistantMessage("must not execute")]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onPlanReview: async () => ({ kind: "takeover" }),
  });
  await session.setPlanMode(true);
  await session.run("plan");
  expect(session.planMode).toBe(true);
  expect(fake.contexts).toHaveLength(1);
  expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
    isError: true,
  });
});
test("aborting pending review cancels the request and ignores late approval", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([submit(), fauxAssistantMessage("unused")]);
  const arrived = Promise.withResolvers<PlanReviewRequest>();
  const reply = Promise.withResolvers<PlanReviewResult>();
  const session = await createSession({
    ...dirs,
    ...fake,
    onPlanReview: (request) => {
      arrived.resolve(request);
      return reply.promise;
    },
  });
  await session.setPlanMode(true);
  const controller = new AbortController();
  const run = session.run("plan", { signal: controller.signal });
  void run.catch(() => {});
  const request = await arrived.promise;
  controller.abort(new Error("cancel review"));
  await expect(run).rejects.toThrow("cancel review");
  expect(request.signal.aborted).toBe(true);
  reply.resolve({ kind: "approve" });
  await Promise.resolve();
  expect(session.planMode).toBe(true);
});
test("review outside Plan Mode fails without opening interaction", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([submit(), fauxAssistantMessage("retry")]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onPlanReview: async () => {
      throw new Error("unexpected review");
    },
  });
  await session.run("plan");
  expect(fake.contexts[1]!.messages.find((message) => message.role === "toolResult")).toMatchObject(
    {
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("Not in plan mode.") }],
    },
  );
});

test.each([true, false])(
  "review tool registration follows frontend capability (%s)",
  async (interactive) => {
    dirs = await tempDirs();
    const fake = fakeModel([fauxAssistantMessage("done")]);
    const session = await createSession({
      ...dirs,
      ...fake,
      ...(interactive && {
        onPlanReview: async (): Promise<PlanReviewResult> => ({ kind: "takeover" }),
      }),
    });
    await session.run("inspect");
    const tools =
      getCurrentSystemMessage(fake.contexts[0]!.messages)?.toolsAdded?.map((tool) => tool.name) ??
      [];
    expect(tools.includes("exit_plan_mode")).toBe(interactive);
  },
);

test.each(["ask", "auto-review", "full-access"] as const)(
  "review approval bypasses permission mode %s",
  async (permissionMode) => {
    dirs = await tempDirs();
    const fake = fakeModel([submit(), fauxAssistantMessage("done")]);
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode,
      onPlanReview: async () => ({ kind: "approve" }),
      onPermissionAsk: async () => {
        throw new Error("unexpected approval");
      },
    });
    await session.setPlanMode(true);
    await session.run("plan");
    expect(session.permissionMode).toBe(permissionMode);
    expect(session.planMode).toBe(false);
  },
);

test.each(["", "   "])("empty markdown plan %j never opens review", async (plan) => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("exit_plan_mode", { plan }), { stopReason: "toolUse" }),
    fauxAssistantMessage("retry"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onPlanReview: async () => {
      throw new Error("unexpected review");
    },
  });
  await session.setPlanMode(true);
  await session.run("plan");
  expect(fake.contexts[1]!.messages.find((message) => message.role === "toolResult")).toMatchObject(
    { isError: true },
  );
  expect(session.planMode).toBe(true);
});

test.each(["general-purpose", "explore", "custom", "fork"])(
  "%s subagent cannot submit plans",
  async (type) => {
    dirs = await tempDirs();
    await Bun.write(
      `${dirs.cwd}/.rukie/agents/custom.md`,
      "---\nname: custom\ndescription: Custom investigator\n---\nInspect.",
    );
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall(type === "fork" ? "subagent_fork" : "subagent", {
          description: "Inspect",
          prompt: "child",
          subagent_type: type,
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("child done"),
      fauxAssistantMessage("parent done"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      onPlanReview: async () => ({ kind: "takeover" }),
    });
    await session.run("delegate");
    await session.waitForRequest(session.currentRequestId!);
    const childTools = fake.contexts
      .map((context) =>
        getCurrentSystemMessage(context.messages)?.toolsAdded?.map((tool) => tool.name),
      )
      .find((tools) => tools && !tools.includes("exit_plan_mode"));
    expect(childTools).toBeDefined();
    expect(childTools).not.toContain("exit_plan_mode");
  },
);

test.each([false, true])(
  "takeover stops after the complete tool batch with review last=%s",
  async (reviewLast) => {
    dirs = await tempDirs();
    const calls = [
      fauxToolCall("exit_plan_mode", { plan }),
      fauxToolCall("todo_write", {
        todos: [{ content: "Complete this batch", status: "in_progress" }],
      }),
    ];
    const fake = fakeModel([
      fauxAssistantMessage(reviewLast ? calls.toReversed() : calls, { stopReason: "toolUse" }),
      fauxAssistantMessage("UNEXPECTED FOLLOWUP"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      onPlanReview: async () => ({ kind: "takeover" }),
    });
    await session.setPlanMode(true);
    await session.run("review plan");
    expect(session.toolState("todo")).toEqual([
      { content: "Complete this batch", status: "in_progress" },
    ]);
    expect(session.messages.filter((message) => message.role === "toolResult")).toHaveLength(2);
    expect(session.planMode).toBe(true);
    expect(fake.contexts).toHaveLength(1);
  },
);

test("takeover leaves its background child active and the next user Run remains available", async () => {
  dirs = await tempDirs();
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let childSignal: AbortSignal | undefined;
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("subagent", {
          description: "Active inspection",
          prompt: "child waiting",
          run_in_background: true,
        }),
        fauxToolCall("exit_plan_mode", { plan }),
      ],
      { stopReason: "toolUse" },
    ),
    async () => {
      ready.resolve();
      await release.promise;
      return fauxAssistantMessage("child settled");
    },
    fauxAssistantMessage("child result acknowledged"),
    fauxAssistantMessage("next user prompt handled"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    models: withModelStream(
      fake.models,
      withAuxiliaryRequests((model, context, options) => {
        if (
          context.messages.some(
            (message) =>
              message.role === "user" && JSON.stringify(message.content).includes("child waiting"),
          )
        ) {
          childSignal = options?.signal;
          childSignal?.addEventListener("abort", () => release.resolve(), { once: true });
        }
        return modelStream(fake.models)(model, context, options);
      }),
    ),
    onPlanReview: async () => {
      await ready.promise;
      return { kind: "takeover" };
    },
  });
  await session.setPlanMode(true);
  try {
    await session.run("inspect");
    expect(childSignal?.aborted).toBe(false);
    expect(fake.contexts).toHaveLength(2);
    expect(session.toolState("subagents")).toHaveLength(1);
    expect(session.messages.filter((message) => message.role === "toolResult")).toHaveLength(2);
    expect(session.planMode).toBe(true);
    release.resolve();
    await session.waitForRequest(session.currentRequestId!);
    expect((await session.run("next user prompt")).text).toBe("next user prompt handled");
    expect(fake.contexts).toHaveLength(4);
  } finally {
    release.resolve();
  }
});

test("a Plan Review pending at close is reissued and stale approval cannot exit planning", async () => {
  dirs = await tempDirs();
  const entered = Promise.withResolvers<PlanReviewRequest>();
  const oldReply = Promise.withResolvers<PlanReviewResult>();
  const session = await createSession({
    ...dirs,
    ...fakeModel([submit()]),
    onPlanReview: (request) => {
      entered.resolve(request);
      return oldReply.promise;
    },
  });
  await session.setPlanMode(true);
  const running = session.run("review this plan after restart").catch(() => undefined);
  const old = await entered.promise;
  await session.close();
  await running;
  expect(old.signal.aborted).toBe(true);
  let replacement: PlanReviewRequest | undefined;
  const cold = fakeModel([fauxAssistantMessage("revising the plan")]);
  const resumed = await createSession({
    ...dirs,
    ...cold,
    resumeId: session.id,
    onPlanReview: async (request) => {
      replacement = request;
      oldReply.resolve({ kind: "approve" });
      return { kind: "revise", feedback: "Keep planning with the replacement reviewer" };
    },
  });
  await resumed.waitForIdle();
  expect(replacement?.plan).toBe(plan);
  expect(old.identity.requestId).toBeString();
  expect(replacement?.identity.requestId).toBe(old.identity.requestId);
  expect(replacement?.identity.epoch).not.toBe(old.identity.epoch);
  expect(resumed.planMode).toBe(true);
  expect(
    JSON.stringify(cold.contexts[0]?.messages.findLast((message) => message.role === "toolResult")),
  ).toContain("replacement reviewer");
  expect(JSON.stringify(resumed.messages)).not.toContain("may have partially run");
});

test.each(["abort", "Headless"])(
  "pending Plan Review preserves planning across %s cold reopen",
  async (mode) => {
    dirs = await tempDirs();
    const entered = Promise.withResolvers<PlanReviewRequest>();
    const reply = Promise.withResolvers<PlanReviewResult>();
    const session = await createSession({
      ...dirs,
      ...fakeModel([submit()]),
      onPlanReview: (request) => {
        entered.resolve(request);
        return reply.promise;
      },
    });
    await session.setPlanMode(true);
    const running = session.run("pending planning review").catch(() => undefined);
    const old = await entered.promise;
    if (mode === "abort") await session.abort();
    await session.close();
    await running;
    let asked = 0;
    const cold = fakeModel([fauxAssistantMessage("new planning answer")]);
    const resumed = await createSession({
      ...dirs,
      ...cold,
      resumeId: session.id,
      ...(mode === "abort"
        ? {
            onPlanReview: async () => {
              asked++;
              return { kind: "approve" as const };
            },
          }
        : {}),
    });
    reply.resolve({ kind: "approve" });
    await resumed.waitForIdle();
    expect(old.signal.aborted).toBe(true);
    expect(asked).toBe(0);
    expect(resumed.planMode).toBe(true);
    expect(resumed.messages.findLast((message) => message.role === "toolResult")).toMatchObject({
      isError: true,
    });
    if (mode === "abort")
      expect((await resumed.run("new independent planning input")).text).toBe(
        "new planning answer",
      );
  },
);
