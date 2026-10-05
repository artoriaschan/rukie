import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { createSession } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());
const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

test("a human Run can create a Goal in ask mode and continuation starts only after its answer", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("create_goal", { objective: "Verify migration", max_goal_rounds: 1 }),
    (context) => {
      expect(context.messages.at(-1)).toMatchObject({
        role: "toolResult",
        isError: false,
        content: [
          {
            text: '{"goal":{"objective":"Verify migration","phase":"active","roundsStarted":0,"maxRounds":1},"armed":true}',
          },
        ],
      });
      expect(session.goal).toMatchObject({ roundsStarted: 0 });
      return fauxAssistantMessage("starting work");
    },
    fauxAssistantMessage("round finished"),
  ]);
  const session = await createSession({ ...dirs, ...fake, onWarning: () => {} });
  await session.run("Keep working until migration is verified");
  await session.waitForIdle();
  expect(session.goal).toMatchObject({ phase: "blocked", roundsStarted: 1, armed: false });
  expect(fake.contexts).toHaveLength(3);
  const tools = getCurrentSystemMessage(fake.contexts[0]!.messages)!.toolsAdded!.map(
    (tool) => tool.name,
  );
  expect(tools).toContain("create_goal");
  expect(tools).toContain("update_goal");
  expect(tools).not.toContain("get_goal");
});

test.each(["complete", "blocked"] as const)(
  "a Goal round marks %s and writes its grounded wrapup within one Run",
  async (action) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      call("update_goal", {
        action,
        ...(action === "blocked" && { blocked_reason: "Missing deployment credential" }),
      }),
      (context) => {
        expect(context.messages.at(-1)).toMatchObject({ role: "user", source: "goal" });
        const text = JSON.stringify(context.messages.at(-1));
        expect(text).toContain(`<goal_${action}>`);
        expect(text).toContain(
          "Report only what earlier rounds and tool results in this session actually establish",
        );
        expect(text).toContain("Ship verified release");
        if (action === "blocked") expect(text).toContain("Missing deployment credential");
        expect(session.running).toBe(true);
        expect(session.goal).toMatchObject({ phase: action, armed: false, roundsStarted: 1 });
        return fauxAssistantMessage("Closing report with verified artifacts");
      },
    ]);
    const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    const results: string[] = [];
    session.subscribe((event) => {
      if (event.type === "result") results.push(event.text);
    });
    await session.createGoal("Ship verified release");
    await session.waitForIdle();
    expect(fake.contexts).toHaveLength(2);
    expect(results).toEqual(["Closing report with verified artifacts"]);
    expect(session.checkpoints()).toEqual([]);
    expect(session.title).toBe("");
    const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    expect(resumed.goal).toEqual(session.goal);
    expect(resumed.messages.filter((message) => message.role === "user")).toMatchObject([
      { source: "goal" },
      { source: "goal" },
    ]);
  },
);

test.each([
  ["create_goal", { objective: "new" }],
  ["update_goal", { action: "edit", objective: "new" }],
  ["update_goal", { action: "pause" }],
  ["update_goal", { action: "resume" }],
] as const)(
  "%s cannot change intent in a Goal round without current human input",
  async (name, args) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage("historical human answer"),
      call(name, args),
      (context) => {
        expect(JSON.stringify(context.messages.at(-1))).toContain("direct human input");
        return fauxAssistantMessage("continue work");
      },
    ]);
    const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    await session.run("historical direct human request");
    await session.createGoal("original", { maxRounds: 1 });
    await session.waitForIdle();
    expect(session.goal).toMatchObject({
      objective: "original",
      phase: "blocked",
      roundsStarted: 1,
    });
  },
);

test("human steering inside a Goal round authorizes an edit and continuation retains that objective", async () => {
  dirs = await tempDirs();
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<void>();
  const fake = fakeModel([
    async () => {
      started.resolve();
      await response.promise;
      return fauxAssistantMessage("read your correction");
    },
    call("update_goal", { action: "edit", objective: "corrected objective" }),
    (context) => {
      expect(context.messages.at(-1)).toMatchObject({ isError: false });
      return fauxAssistantMessage("corrected", { stopReason: "length" });
    },
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.createGoal("original");
  await started.promise;
  session.steer("Change direction to corrected objective");
  response.resolve();
  await session.waitForIdle();
  expect(session.goal).toMatchObject({
    objective: "corrected objective",
    roundsStarted: 1,
    armed: false,
  });
});

test("the model cannot undo a human pause but may complete the paused Goal in the same round", async () => {
  dirs = await tempDirs();
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<void>();
  const fake = fakeModel([
    async () => {
      started.resolve();
      await response.promise;
      return fauxAssistantMessage("paused, checking result");
    },
    call("update_goal", { action: "resume" }),
    (context) => {
      expect(JSON.stringify(context.messages.at(-1))).toContain("cannot resume a paused Goal");
      return call("update_goal", { action: "complete" });
    },
    fauxAssistantMessage("completed with verification"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.createGoal("finish safely");
  await started.promise;
  await session.pauseGoal();
  session.steer("Continue only if it is already complete");
  response.resolve();
  await session.waitForIdle();
  expect(session.goal).toMatchObject({ phase: "complete", roundsStarted: 1, armed: false });
});

const invalidUpdates: Parameters<typeof call>[1][] = [
  { action: "edit" },
  { action: "edit", objective: "new", blocked_reason: "reason" },
  { action: "pause", objective: "new" },
  { action: "resume", blocked_reason: "reason" },
  { action: "complete", objective: "new" },
  { action: "complete", blocked_reason: "reason" },
  { action: "blocked" },
  { action: "blocked", blocked_reason: "  " },
  { action: "blocked", blocked_reason: "reason", objective: "new" },
];
test.each(invalidUpdates)(
  "invalid update combination %j returns an error without changing the Goal",
  async (args) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage("idle", { stopReason: "length" }),
      call("update_goal", args),
      (context) => {
        expect(context.messages.at(-1)).toMatchObject({ isError: true });
        return fauxAssistantMessage("invalid input handled");
      },
    ]);
    const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    await session.createGoal("original");
    await session.waitForIdle();
    const before = session.goal;
    await session.run("adjust my Goal");
    await session.waitForIdle();
    expect(session.goal).toEqual(before);
  },
);

test("human model controls edit, pause and resume a disarmed active Goal without resetting its rounds", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("idle", { stopReason: "length" }),
    call("update_goal", { action: "edit", objective: "edited" }),
    call("update_goal", { action: "resume" }),
    call("update_goal", { action: "pause" }),
    fauxAssistantMessage("paused by request"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.createGoal("original");
  await session.waitForIdle();
  await session.run("Edit, rearm and pause after preparing the next work");
  await session.waitForIdle();
  expect(session.goal).toMatchObject({
    objective: "edited",
    phase: "paused",
    roundsStarted: 1,
    armed: false,
  });
  expect(fake.contexts).toHaveLength(5);
});

test("a human pause racing model resume cannot be reversed by that tool", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("idle", { stopReason: "length" }),
    call("update_goal", { action: "resume" }),
    fauxAssistantMessage("pause respected"),
  ]);
  let paused: Promise<unknown> | undefined;
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    onToolCallAllowed: ({ toolName }) => {
      if (toolName === "update_goal") paused = session.pauseGoal();
    },
  });
  await session.createGoal("respect pause");
  await session.waitForIdle();
  await session.run("Resume work");
  await paused;
  await session.waitForIdle();
  expect(session.goal).toMatchObject({ phase: "paused", armed: false, roundsStarted: 1 });
  const result = session.messages.find((message) => message.role === "toolResult");
  expect(result).toMatchObject({
    isError: true,
    details: { code: "goal-tool-resume-paused", params: {} },
  });
});

test("completion after a human pause in the automatic round requires no extra human prompt", async () => {
  dirs = await tempDirs();
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<void>();
  const fake = fakeModel([
    async () => {
      started.resolve();
      await response.promise;
      return call("update_goal", { action: "complete" });
    },
    fauxAssistantMessage("Already complete; here is the evidence"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.createGoal("verified work");
  await started.promise;
  await session.pauseGoal();
  response.resolve();
  await session.waitForIdle();
  expect(session.goal).toMatchObject({ phase: "complete", armed: false, roundsStarted: 1 });
  expect(fake.contexts).toHaveLength(2);
  expect(session.messages.filter((message) => message.role === "user")).toMatchObject([
    { source: "goal" },
    { source: "goal" },
  ]);
});
