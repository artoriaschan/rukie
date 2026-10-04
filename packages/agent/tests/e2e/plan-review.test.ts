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
  expect(fake.contexts).toHaveLength(1);
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
