import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import type { JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createSession as createNativeSession,
  ROOT_CONVERSATION_ID,
} from "@earendil-works/pi-durable";
import { goalState } from "../../src/tools/goal/index.ts";
import { join } from "node:path";
import {
  createSession as createSessionImpl,
  createJsonlStore,
  type Session,
  type SessionEvent,
} from "../../src/index.ts";
import { abortingModel } from "../helpers/aborting-model.ts";
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

function goalReminders(events: readonly SessionEvent[]) {
  return events.flatMap((event) =>
    event.type === "message_end"
      ? event.messages.filter(
          (message) => message.role === "system-reminder" && message.source === "goal",
        )
      : [],
  );
}

test("creating a Goal immediately runs rounds up to its cap without user prompt anchors", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
  const events: SessionEvent[] = [];
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  session.subscribe((event) => events.push(structuredClone(event)));
  await session.createGoal("Ship verified support", { maxRounds: 2 });
  await session.waitForIdle();
  expect(session.goal).toMatchObject({
    objective: "Ship verified support",
    phase: "blocked",
    roundsStarted: 2,
    maxRounds: 2,
    armed: false,
    blockedReason: expect.stringContaining("2"),
  });
  expect(fake.contexts).toHaveLength(2);
  for (const [index, context] of fake.contexts.entries()) {
    expect(JSON.stringify(context.messages)).toContain(`Round: ${index + 1}/2`);
    expect(JSON.stringify(context)).toContain(`round ${index + 1}/2`);
  }
  expect(session.messages.filter((message) => message.role === "user")).toMatchObject([
    { source: "goal" },
    { source: "goal" },
  ]);
  expect(session.checkpoints()).toEqual([]);
  expect(session.title).toBe("");
  expect(
    events.filter((event) => event.type === "tool_state_changed" && event.name === "goal"),
  ).toHaveLength(4);
});

test.each(["pause", "clear"] as const)(
  "%s during a Run preserves the current answer and stops continuation",
  async (action) => {
    dirs = await tempDirs();
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const fake = fakeModel([
      async () => {
        started.resolve();
        await finish.promise;
        return fauxAssistantMessage("current answer finished");
      },
    ]);
    const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    await session.createGoal("finish safely");
    await started.promise;
    await expect(session.createGoal("other")).rejects.toThrow("idle");
    await expect(session.editGoal("other")).rejects.toThrow("idle");
    await expect(session.resumeGoal()).rejects.toThrow("idle");
    if (action === "pause") await session.pauseGoal();
    else await session.clearGoal();
    expect(session.running).toBe(true);
    finish.resolve();
    await session.waitForIdle();
    expect(fake.contexts).toHaveLength(1);
    expect(session.messages.findLast((message) => message.role === "assistant")).toMatchObject({
      content: [{ text: "current answer finished" }],
    });
    if (action === "pause")
      expect(session.goal).toMatchObject({ phase: "paused", armed: false, roundsStarted: 1 });
    else expect(session.goal).toBeUndefined();
    await session.close();
    const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    expect(resumed.goal).toEqual(session.goal);
  },
);

test("idle Goal edits preserve round count and resume continues a paused Goal", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("first", { stopReason: "length" }),
    fauxAssistantMessage("second"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await expect(session.editGoal("missing")).rejects.toThrow("No Goal");
  await expect(session.resumeGoal()).rejects.toThrow("No Goal");
  await expect(session.pauseGoal()).rejects.toThrow("No Goal");
  await session.clearGoal();
  for (const maxRounds of [0, -1, 1.5, Infinity])
    await expect(session.createGoal("invalid", { maxRounds })).rejects.toThrow("positive integer");
  await expect(session.createGoal("   ")).rejects.toThrow("empty");
  await session.createGoal("old", { maxRounds: 2 });
  await session.waitForIdle();
  const id = session.goal!.id;
  await expect(session.createGoal("replacement")).rejects.toThrow("unfinished");
  await expect(session.editGoal("  ")).rejects.toThrow("empty");
  await session.editGoal("new");
  expect(session.goal).toMatchObject({
    id,
    objective: "new",
    phase: "active",
    armed: false,
    roundsStarted: 1,
  });
  await session.pauseGoal();
  await expect(session.pauseGoal()).rejects.toThrow("active");
  await session.resumeGoal();
  await session.waitForIdle();
  expect(session.goal).toMatchObject({ id, phase: "blocked", roundsStarted: 2, armed: false });
  await expect(session.resumeGoal()).rejects.toThrow("limit");
  await session.clearGoal();
  await expect(session.pauseGoal()).rejects.toThrow("No Goal");
});

test.each(["error", "aborted", "length"] as const)(
  "a %s model ending disarms and can resume without resetting rounds",
  async (stopReason) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage("stopped", {
        stopReason,
        ...(stopReason !== "length" && { errorMessage: "model failed" }),
      }),
      fauxAssistantMessage("continued"),
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    session.subscribe((event) => events.push(event));
    await session.createGoal("continue after repair", { maxRounds: 2 });
    await session.waitForIdle();
    expect(session.goal).toMatchObject({ phase: "active", armed: false, roundsStarted: 1 });
    expect(events.filter((event) => event.type === "run_end")).toHaveLength(1);
    await session.resumeGoal();
    await session.waitForIdle();
    expect(session.goal).toMatchObject({ phase: "blocked", roundsStarted: 2 });
    expect(JSON.stringify(fake.contexts[1]!.messages)).toContain("Round: 2/2");
  },
);

test.each(["abort", "close"] as const)(
  "%s preserves Goal facts and only close resumes the already accepted round",
  async (action) => {
    dirs = await tempDirs();
    const fake = abortingModel();
    const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    await session.createGoal("preserve unfinished work", { maxRounds: 2 });
    await fake.started;
    if (action === "abort") {
      await session.abort();
      await session.waitForIdle();
    } else await session.close();
    expect(session.goal).toMatchObject({
      phase: "active",
      armed: action === "close",
      roundsStarted: 1,
    });
    const resumedFake = fakeModel([fauxAssistantMessage("resumed", { stopReason: "length" })]);
    await session.close();
    const resumed = await createSession({ ...dirs, ...resumedFake, resumeId: session.id });
    await resumed.waitForIdle();
    expect(resumed.goal).toMatchObject({
      id: session.goal!.id,
      phase: "active",
      roundsStarted: 1,
      armed: false,
    });
    expect(resumedFake.contexts).toHaveLength(action === "close" ? 1 : 0);
  },
);

test("resume restores an active Goal without autorun, and conversation rewind restores its earlier state", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("before"),
    fauxAssistantMessage("one", { stopReason: "length" }),
    fauxAssistantMessage("after"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.run("before Goal");
  await session.createGoal("remember me", { maxRounds: 3 });
  await session.waitForIdle();
  await session.run("after Goal");
  await session.editGoal("edited");
  await session.pauseGoal();
  const next = fakeModel([fauxAssistantMessage("resumed", { stopReason: "length" })]);
  await session.close();
  const resumed = await createSession({
    ...dirs,
    ...next,
    resumeId: session.id,
    permissionMode: "full-access",
  });
  expect(resumed.goal).toEqual(session.goal);
  expect(next.contexts).toHaveLength(0);
  await resumed.rewind(resumed.checkpoints()[1]!.promptEntryId, {
    code: false,
    conversation: true,
  });
  expect(resumed.goal).toMatchObject({
    objective: "remember me",
    phase: "active",
    roundsStarted: 1,
    armed: false,
  });
  await resumed.resumeGoal();
  await resumed.waitForIdle();
  expect(resumed.goal).toMatchObject({ roundsStarted: 2, armed: false });
  await resumed.rewind(resumed.checkpoints()[0]!.promptEntryId, {
    code: false,
    conversation: true,
  });
  expect(resumed.goal).toBeUndefined();
});

test("a queued human Run takes precedence over the next Goal round without increasing its count", async () => {
  dirs = await tempDirs();
  const called = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<void>();
  const fake = fakeModel([
    async () => {
      called.resolve();
      await reply.promise;
      return fauxAssistantMessage("round one");
    },
    () => {
      expect(session.goal!.roundsStarted).toBe(1);
      return fauxAssistantMessage("human answer");
    },
    fauxAssistantMessage("round two"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.createGoal("finish work", { maxRounds: 2 });
  await called.promise;
  const human = session.steer("check this detail");
  reply.resolve();
  await human;
  await session.waitForIdle();
  expect(fake.contexts).toHaveLength(3);
  expect(fake.contexts[1]!.messages.findLast((message) => message.role !== "system")).toMatchObject(
    {
      content: [{ text: "check this detail" }],
    },
  );
  expect(JSON.stringify(fake.contexts[2]!.messages)).toContain("Round: 2/2");
  expect(session.checkpoints().map((checkpoint) => checkpoint.preview)).toEqual([
    "check this detail",
  ]);
});

test("Stop hook continuation finishes before the next Goal round and does not count as a round", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "stop.sh"),
    `cat >/dev/null\nif [ ! -f checked ]; then touch checked; echo '{"decision":"block","reason":"verify"}'; else echo '{}'; fi\n`,
  );
  const fake = fakeModel([
    fauxAssistantMessage("first"),
    () => {
      expect(session.goal!.roundsStarted).toBe(1);
      return fauxAssistantMessage("verified");
    },
    fauxAssistantMessage("next"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { hooks: { Stop: [{ hooks: [{ type: "command", command: "sh stop.sh" }] }] } },
  });
  await session.createGoal("finish", { maxRounds: 2 });
  await session.waitForIdle();
  expect(fake.contexts[1]!.messages.findLast((message) => message.role !== "system")).toMatchObject(
    { content: "verify" },
  );
  expect(JSON.stringify(fake.contexts[2]!.messages)).toContain("Round: 2/2");
  expect(session.goal).toMatchObject({ roundsStarted: 2, phase: "blocked" });
});

test("ask mode warns on create and resume without changing Permission Mode", async () => {
  dirs = await tempDirs();
  const warnings: string[] = [];
  const fake = fakeModel([
    fauxAssistantMessage("pause", { stopReason: "length" }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning: (warning) => warnings.push(warning),
  });
  await session.createGoal("warn", { maxRounds: 2 });
  await session.waitForIdle();
  await session.resumeGoal();
  await session.waitForIdle();
  expect(warnings).toEqual([
    expect.stringContaining("auto-review"),
    expect.stringContaining("auto-review"),
  ]);
  expect(session.permissionMode).toBe("ask");
});

async function writeGoalDocument(id: string, value: JsonValue) {
  const lease = await createJsonlStore(dirs).open({ id }, BACKGROUND_CONTEXT);
  const native = createNativeSession(lease.storage);
  try {
    await native.commit(async (tx) => {
      (await tx.doc(goalState.document, ROOT_CONVERSATION_ID)).value = value;
    }, BACKGROUND_CONTEXT);
  } finally {
    await native.close(BACKGROUND_CONTEXT);
    await lease.release();
  }
}

test.each(["extra activation", "negative rounds", "missing objective", "blocked without reason"])(
  "cold resume rejects malformed current Goal document before model execution: %s",
  async (fault) => {
    dirs = await tempDirs();
    const session = await createSession({
      ...dirs,
      ...fakeModel([fauxAssistantMessage("stopped", { stopReason: "length" })]),
      permissionMode: "full-access",
    });
    await session.createGoal("valid");
    await session.waitForIdle();
    const { armed: _armed, ...snapshot } = session.goal!;
    await session.close();
    const value =
      fault === "extra activation"
        ? { ...snapshot, armed: true }
        : fault === "negative rounds"
          ? { ...snapshot, roundsStarted: -1 }
          : fault === "missing objective"
            ? { ...snapshot, objective: "" }
            : { ...snapshot, phase: "blocked" };
    await writeGoalDocument(session.id, value);
    const fake = fakeModel([]);
    await expect(createSession({ ...dirs, ...fake, resumeId: session.id })).rejects.toThrow(
      "Invalid Goal snapshot",
    );
    expect(fake.contexts).toHaveLength(0);
  },
);

test("a complete restored Goal rejects resume, injects no reminder and edit creates a new Goal", async () => {
  dirs = await tempDirs();
  const session = await createSession({
    ...dirs,
    permissionMode: "full-access",
    ...fakeModel([
      fauxAssistantMessage(fauxToolCall("update_goal", { action: "complete" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("completed with evidence"),
    ]),
  });
  await session.createGoal("first", { maxRounds: 2 });
  await session.waitForIdle();
  expect(session.goal).toMatchObject({ phase: "complete", armed: false });
  const id = session.goal!.id;
  await session.close();
  const next = fakeModel([
    fauxAssistantMessage("human answer"),
    fauxAssistantMessage("new", { stopReason: "length" }),
  ]);
  const events: SessionEvent[] = [];
  const resumed = await createSession({
    ...dirs,
    ...next,
    resumeId: session.id,
    permissionMode: "full-access",
  });
  expect(next.contexts).toHaveLength(0);
  await expect(resumed.resumeGoal()).rejects.toThrow("complete");
  resumed.subscribe((event) => events.push(event));
  await resumed.run("human detail");
  expect(goalReminders(events)).toEqual([]);
  const replacement = await resumed.editGoal("next");
  expect(replacement).toMatchObject({
    objective: "next",
    roundsStarted: 0,
    maxRounds: 256,
    armed: true,
  });
  expect(replacement.id).not.toBe(id);
  await resumed.waitForIdle();
});

test("forked children do not inherit Goal reminders or register Goal tools", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("first", { stopReason: "length" }),
    fauxAssistantMessage(
      fauxToolCall("subagent_fork", {
        description: "Inspect",
        prompt: "child",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("child done"),
    fauxAssistantMessage("parent done"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.createGoal("parent only", { maxRounds: 2 });
  await session.waitForIdle();
  await session.resumeGoal();
  await session.waitForIdle();
  expect(fake.contexts).toHaveLength(4);
  const childContext = fake.contexts[2]!;
  expect(JSON.stringify(childContext.messages)).not.toContain("Current Goal:");
  const tools = getCurrentSystemMessage(childContext.messages)!.toolsAdded!.map(
    (tool) => tool.name,
  );
  expect(tools).not.toContain("create_goal");
  expect(tools).not.toContain("update_goal");
  expect(fake.contexts[3]!.messages.findLast((message) => message.role !== "system")).toMatchObject(
    { role: "toolResult", isError: false },
  );
  expect(session.goal).toMatchObject({ phase: "blocked", roundsStarted: 2 });
});

test("the next Goal round waits for child completion and its delivered notification", async () => {
  dirs = await tempDirs();
  const child = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  const response: Parameters<typeof fakeModel>[0][number] = async (context) => {
    const parent = getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
      (tool) => tool.name === "subagent",
    );
    if (!parent) {
      await child.promise;
      return fauxAssistantMessage("child conclusion");
    }
    return fauxAssistantMessage("waiting parent");
  };
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("subagent", { description: "Inspect", prompt: "child" }), {
      stopReason: "toolUse",
    }),
    response,
    response,
    (context) => {
      expect(session.goal!.roundsStarted).toBe(1);
      expect(
        JSON.stringify(context.messages.findLast((message) => message.role !== "system")),
      ).toContain("child conclusion");
      return fauxAssistantMessage("parent conclusion");
    },
    fauxAssistantMessage("second round"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  session.subscribe((event) => {
    if (event.type === "run_end" && event.sessionId === session.id) waiting.resolve();
  });
  const accepted = await session.createGoal("wait for delegated work", { maxRounds: 2 });
  await waiting.promise;
  expect(session.goal).toMatchObject({ roundsStarted: 1, armed: true });
  child.resolve();
  await session.waitForRequest(accepted.requestId);
  expect(fake.contexts).toHaveLength(5);
  expect(JSON.stringify(fake.contexts[4]!.messages)).toContain("Round: 2/2");
});

test("manual Compaction immediately restores Goal reminder and unchanged following Runs deduplicate it", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "old-goal.txt"), "old work ".repeat(5000));
  const read = () =>
    fauxAssistantMessage(fauxToolCall("read", { path: "old-goal.txt" }), { stopReason: "toolUse" });
  const fake = fakeModel([
    read(),
    fauxAssistantMessage("old Goal work", { stopReason: "length" }),
    read(),
    fauxAssistantMessage("older buffer"),
    fauxAssistantMessage("protected recent buffer"),
    fauxAssistantMessage("Goal work summary."),
    fauxAssistantMessage("continued"),
    fauxAssistantMessage("unchanged"),
  ]);
  fake.model.contextWindow = 128_000;
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.createGoal("retain the objective", { maxRounds: 2 });
  await session.waitForIdle();
  await session.run("older buffer");
  await session.run("protected recent buffer");
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  await session.compact();
  expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(1);
  expect(session.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "system-reminder",
        source: "goal",
        content: expect.stringContaining("retain the objective"),
      }),
    ]),
  );
  expect(goalReminders(events)).toHaveLength(1);
  expect(JSON.stringify(session.messages)).toContain("round 1/2");
  events.length = 0;
  await session.run("continue");
  await session.run("again");
  expect(goalReminders(events)).toEqual([]);
  expect(JSON.stringify(fake.contexts.at(-1))).toContain("retain the objective");
});

test("pausing immediately after creation still counts the current Goal round", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("current round")]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.createGoal("finish current round");
  await session.pauseGoal();
  await session.waitForIdle();
  expect(fake.contexts).toHaveLength(1);
  expect(session.goal).toMatchObject({ phase: "paused", roundsStarted: 1, armed: false });
});
