import { withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, type PlanReviewRequest, type PlanReviewResult } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());
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
    { isError: true, content: [{ type: "text", text: "Not in plan mode." }] },
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
    let tools: string[] = [];
    await session.run("inspect", {
      onEvent: (event) => {
        if (event.type === "session_start") tools = event.tools;
      },
    });
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
    let childTools: string[] | undefined;
    await session.run("delegate", {
      onEvent: (event) => {
        if (event.type === "subagent_event" && event.event.type === "session_start")
          childTools = event.event.tools;
      },
    });
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

test("takeover settles an active child without continuation and the next user Run remains available", async () => {
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
    fauxAssistantMessage("next user prompt handled"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    streamFn: withAuxiliaryRequests((model, context, options) => {
      if (
        context.messages.some(
          (message) =>
            message.role === "user" && JSON.stringify(message.content).includes("child waiting"),
        )
      ) {
        childSignal = options?.signal;
        childSignal?.addEventListener("abort", () => release.resolve(), { once: true });
      }
      return fake.streamFn(model, context, options);
    }),
    onPlanReview: async () => {
      await ready.promise;
      return { kind: "takeover" };
    },
  });
  await session.setPlanMode(true);
  await session.run("inspect");
  expect(childSignal?.aborted).toBe(true);
  expect(fake.contexts).toHaveLength(2);
  expect(session.toolState("subagents")).toHaveLength(1);
  expect(session.messages.filter((message) => message.role === "toolResult")).toHaveLength(2);
  expect(session.planMode).toBe(true);
  expect((await session.run("next user prompt")).text).toBe("next user prompt handled");
  expect(fake.contexts).toHaveLength(3);
});
