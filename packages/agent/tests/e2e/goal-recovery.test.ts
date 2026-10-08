import { expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { createSession, createJsonlStore } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { crashGoalRound } from "../helpers/goal-crash.ts";
import { abortingModel } from "../helpers/aborting-model.ts";
import type { Storage } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

test.each(["initial", "later", "placed"] as const)(
  "accepted Goal survives %s round fact commit before native input admission",
  async (cut) => {
    const dirs = await tempDirs();
    let session: Awaited<ReturnType<typeof createSession>> | undefined;
    try {
      const saved = await crashGoalRound(dirs.cwd, cut);
      const fake = fakeModel([
        fauxAssistantMessage("first recovered answer"),
        fauxAssistantMessage("second recovered answer"),
      ]);
      session = await createSession({
        cwd: dirs.cwd,
        homeDir: dirs.cwd,
        ...fake,
        resumeId: saved.sessionId,
        permissionMode: "full-access",
      });
      expect(session.currentRequestId).not.toContain(":round:");
      await session.waitForRequest(session.currentRequestId!);
      await session.waitForIdle();
      expect(session.goal).toMatchObject({
        id: saved.goalId,
        phase: "blocked",
        roundsStarted: 2,
        armed: false,
      });
      const goalInputs = session.messages.filter(
        (message) => message.role === "user" && message.source === "goal",
      );
      expect(goalInputs).toHaveLength(2);
      expect(JSON.stringify(goalInputs[0])).toContain("Round: 1/2");
      expect(JSON.stringify(goalInputs[1])).toContain("Round: 2/2");
      expect(
        fake.contexts.some((context) => JSON.stringify(context.messages).includes("Round: 2/2")),
      ).toBe(true);
      await session.close();
      const idle = fakeModel([]);
      session = await createSession({
        cwd: dirs.cwd,
        homeDir: dirs.cwd,
        ...idle,
        resumeId: saved.sessionId,
      });
      await session.waitForIdle();
      expect(idle.contexts).toHaveLength(0);
      expect(session.goal).toMatchObject({
        id: saved.goalId,
        phase: "blocked",
        roundsStarted: 2,
        armed: false,
      });
    } finally {
      await session?.close();
      await dirs.cleanup();
    }
  },
);

test("an accepted placed round settles its completion after admission acknowledgement loss", async () => {
  const dirs = await tempDirs();
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  try {
    const saved = await crashGoalRound(dirs.cwd, "placed");
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("update_goal", { action: "complete" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("recovered grounded completion"),
    ]);
    session = await createSession({
      cwd: dirs.cwd,
      homeDir: dirs.cwd,
      ...fake,
      resumeId: saved.sessionId,
      permissionMode: "full-access",
    });
    const requestId = session.currentRequestId!;
    expect(requestId).not.toContain(":round:");
    expect(await session.waitForRequest(requestId)).toMatchObject({
      text: "recovered grounded completion",
      success: true,
    });
    expect(session.goal).toMatchObject({ phase: "complete", roundsStarted: 1, armed: false });
    expect(
      session.messages.filter(
        (message) =>
          message.role === "user" &&
          message.source === "goal" &&
          JSON.stringify(message.content).includes("Round: 1/2"),
      ),
    ).toHaveLength(1);
  } finally {
    await session?.close();
    await dirs.cleanup();
  }
});

test("a Goal activation settles all rounds with nonoverlapping native provider usage", async () => {
  const dirs = await tempDirs();
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  try {
    const fake = fakeModel([
      fauxAssistantMessage("first round"),
      fauxAssistantMessage("last round"),
    ]);
    session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    await session.rename("usage fixture");
    const goal = await session.createGoal("Exactly two rounds", { maxRounds: 2 });
    const result = await session.waitForRequest(goal.requestId);
    expect(result).toMatchObject({ text: "last round", success: true });
    const expected = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
    for (const message of session.messages)
      if (message.role === "assistant")
        for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const)
          expected[key] += message.usage[key];
    expect(result.usage).toEqual(expected);
    expect(fake.contexts).toHaveLength(2);
  } finally {
    await session?.close();
    await dirs.cleanup();
  }
});

test("Rewind rejects accepted Goal work before its driver can target another conversation", async () => {
  const dirs = await tempDirs();
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  const release = Promise.withResolvers<void>();
  try {
    const fake = fakeModel([
      fauxAssistantMessage("checkpoint answer"),
      async () => {
        await release.promise;
        return fauxAssistantMessage("Goal answer");
      },
    ]);
    session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    await session.rename("Rewind fixture");
    await session.run("checkpoint prompt");
    const checkpoint = session.checkpoints()[0]!.promptEntryId;
    await session.createGoal("Accepted work", { maxRounds: 1 });
    await expect(session.rewind(checkpoint, { code: false, conversation: true })).rejects.toThrow();
    release.resolve();
    await session.waitForIdle();
    expect(
      session.messages.some((message) => JSON.stringify(message).includes("checkpoint prompt")),
    ).toBe(true);
  } finally {
    release.resolve();
    await session?.close();
    await dirs.cleanup();
  }
});

test("explicit Goal cancellation retains committed round usage and the aborted partial receipt", async () => {
  const dirs = await tempDirs();
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  try {
    const fake = fakeModel([fauxAssistantMessage("completed first round")]);
    const held = abortingModel();
    const original = fake.models.getProvider(fake.model.provider)!;
    const aborted = held.models.getProvider(held.model.provider)!;
    let calls = 0;
    fake.models.setProvider({
      ...original,
      streamSimple: (model, input, options) =>
        calls++ === 0
          ? original.streamSimple(model, input, options)
          : aborted.streamSimple(model, input, options),
    });
    session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    await session.rename("cancel fixture");
    const partial = Promise.withResolvers<void>();
    session.subscribe((event) => {
      if (
        (event.type === "message_start" || event.type === "message_update") &&
        event.message &&
        JSON.stringify(event.message).includes("partial output")
      )
        partial.resolve();
    });
    const accepted = await session.createGoal("Two rounds", { maxRounds: 2 });
    await held.started;
    await partial.promise;
    await session.abort();
    const result = await session.waitForRequest(accepted.requestId);
    expect(result).toMatchObject({ success: false, text: "partial output" });
    const expected = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
    for (const message of session.messages)
      if (message.role === "assistant")
        for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const)
          expected[key] += message.usage[key];
    expect(result.usage).toEqual(expected);
    expect(session.goal).toMatchObject({ phase: "active", roundsStarted: 2, armed: false });
    const id = session.id;
    await session.close();
    session = undefined;
    const lease = await createJsonlStore(dirs).open({ id }, BACKGROUND_CONTEXT);
    try {
      const tasks = await lease.storage.scanTasks({}, 100000, undefined, BACKGROUND_CONTEXT);
      expect(tasks.items.find((task) => task.kind === "rukie.goal-driver")?.state).toMatchObject({
        status: "terminal",
        outcome: { status: "aborted" },
      });
    } finally {
      await lease.storage.close(BACKGROUND_CONTEXT);
      await lease.release();
    }
  } finally {
    await session?.close();
    await dirs.cleanup();
  }
});

test.each(["pause", "clear", "resume"] as const)(
  "%s withdraws the old queued automatic round while preserving the active Human answer",
  async (action) => {
    const dirs = await tempDirs();
    let session: Awaited<ReturnType<typeof createSession>> | undefined;
    const human = Promise.withResolvers<void>();
    const queued = Promise.withResolvers<void>();
    let steered: Promise<void> | undefined;
    const store = createJsonlStore(dirs);
    let inject = true;
    const wrapped: typeof store = {
      ...store,
      async open(...args) {
        const lease = await store.open(...args);
        return {
          ...lease,
          storage: new Proxy(lease.storage, {
            get(target, key) {
              if (key === "commit")
                return async (...args: Parameters<typeof target.commit>) => {
                  const seq = await target.commit(...args);
                  if (
                    inject &&
                    args[0].some(
                      (write) =>
                        write.type === "task" &&
                        write.value.kind === "rukie.goal-driver" &&
                        write.value.state.status === "running" &&
                        write.value.state.checkpoint !== null &&
                        typeof write.value.state.checkpoint === "object" &&
                        !Array.isArray(write.value.state.checkpoint) &&
                        write.value.state.checkpoint.phase === "admit" &&
                        write.value.state.checkpoint.round === 2,
                    )
                  ) {
                    inject = false;
                    steered = session!.steer("Human priority input");
                  }
                  if (
                    args[0].some(
                      (write) =>
                        write.type === "submission" &&
                        write.value.requestId?.startsWith("goal:") &&
                        write.value.status === "queued",
                    )
                  )
                    queued.resolve();
                  return seq;
                };
              const value = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            },
          }),
        };
      },
    };
    try {
      const fake = fakeModel([
        fauxAssistantMessage("first round"),
        async () => {
          await human.promise;
          return fauxAssistantMessage("Human answer survives");
        },
        fauxAssistantMessage("unwanted round"),
      ]);
      session = await createSession({
        ...dirs,
        ...fake,
        store: wrapped,
        permissionMode: "full-access",
      });
      await session.rename("queued fixture");
      await session.createGoal("Two rounds", { maxRounds: 2 });
      await queued.promise;
      expect(session.goal).toMatchObject({ roundsStarted: 1 });
      if (action === "clear") await session.clearGoal();
      else await session.pauseGoal();
      human.resolve();
      await steered;
      await session.waitForIdle();
      if (action === "resume") {
        await session.resumeGoal();
        await session.waitForIdle();
      }
      if (action === "clear") expect(session.goal).toBeUndefined();
      else
        expect(session.goal).toMatchObject({
          phase: action === "resume" ? "blocked" : "paused",
          roundsStarted: action === "resume" ? 2 : 1,
          armed: false,
        });
      expect(fake.contexts).toHaveLength(action === "resume" ? 3 : 2);
      expect(
        session.messages.some((message) =>
          JSON.stringify(message).includes("Human answer survives"),
        ),
      ).toBe(true);
    } finally {
      human.resolve();
      await session?.close();
      await dirs.cleanup();
    }
  },
);

test("cancelled Goal driver does not join or cancel its independently held background child", async () => {
  const dirs = await tempDirs();
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  let storage: Storage | undefined;
  const store = createJsonlStore(dirs);
  const child = Promise.withResolvers<void>();
  const childStarted = Promise.withResolvers<void>();
  const parentEnded = Promise.withResolvers<void>();
  const response: Parameters<typeof fakeModel>[0][number] = async (context) => {
    const parent = getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
      (tool) => tool.name === "subagent",
    );
    if (!parent) {
      childStarted.resolve();
      await child.promise;
      return fauxAssistantMessage("child finished independently");
    }
    return fauxAssistantMessage("waiting parent");
  };
  try {
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Held child",
          prompt: "child work",
          run_in_background: true,
        }),
        { stopReason: "toolUse" },
      ),
      response,
      response,
      fauxAssistantMessage("delivered child report"),
    ]);
    session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      store: {
        ...store,
        async open(...args) {
          const lease = await store.open(...args);
          storage = lease.storage;
          return lease;
        },
      },
    });
    await session.rename("independent child fixture");
    session.subscribe((event) => {
      if (event.type === "run_end" && event.sessionId === session!.id) parentEnded.resolve();
    });
    const accepted = await session.createGoal("Delegate and continue", { maxRounds: 2 });
    await childStarted.promise;
    await parentEnded.promise;
    const inputs = await storage!.scanSubmissions({}, 100000, undefined, BACKGROUND_CONTEXT);
    const roundRequest = inputs.items.find((input) =>
      input.requestId?.startsWith(`${accepted.requestId}:round:`),
    )!.requestId!;
    await session.abort();
    expect(await session.waitForRequest(accepted.requestId)).toMatchObject({
      success: false,
      text: "waiting parent",
    });
    expect(structuredClone(session.toolState("subagents"))).toMatchObject([{ active: true }]);
    expect(session.goal).toMatchObject({ roundsStarted: 1, armed: false });
    child.resolve();
    await session.waitForRequest(roundRequest);
    await session.waitForIdle();
    expect(fake.contexts).toHaveLength(4);
    expect(
      session.messages.some((message) =>
        JSON.stringify(message).includes("delivered child report"),
      ),
    ).toBe(true);
  } finally {
    child.resolve();
    await session?.close();
    await dirs.cleanup();
  }
});

test("pause after placement accounts that accepted round before explicit resume", async () => {
  const dirs = await tempDirs();
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  const placed = Promise.withResolvers<void>();
  const acknowledge = Promise.withResolvers<void>();
  const store = createJsonlStore(dirs);
  let intercept = true;
  const wrapped: typeof store = {
    ...store,
    async open(...args) {
      const lease = await store.open(...args);
      return {
        ...lease,
        storage: new Proxy(lease.storage, {
          get(target, key) {
            if (key === "commit")
              return async (...args: Parameters<typeof target.commit>) => {
                const seq = await target.commit(...args);
                if (
                  intercept &&
                  args[0].some(
                    (write) =>
                      write.type === "submission" &&
                      write.value.requestId?.startsWith("goal:") &&
                      write.value.status === "placed",
                  )
                ) {
                  intercept = false;
                  placed.resolve();
                  await acknowledge.promise;
                }
                return seq;
              };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      };
    },
  };
  try {
    const fake = fakeModel([
      fauxAssistantMessage("placed answer"),
      fauxAssistantMessage("resumed final answer"),
    ]);
    session = await createSession({
      ...dirs,
      ...fake,
      store: wrapped,
      permissionMode: "full-access",
    });
    await session.rename("placed pause fixture");
    await session.createGoal("Two placed rounds", { maxRounds: 2 });
    await placed.promise;
    expect(fake.contexts).toHaveLength(0);
    const pausing = session.pauseGoal();
    acknowledge.resolve();
    await pausing;
    await session.waitForIdle();
    expect(session.goal).toMatchObject({ phase: "paused", roundsStarted: 1, armed: false });
    expect(fake.contexts).toHaveLength(1);
    const resumed = await session.resumeGoal();
    expect(await session.waitForRequest(resumed.requestId!)).toMatchObject({
      text: "resumed final answer",
      success: true,
    });
    expect(session.goal).toMatchObject({ phase: "blocked", roundsStarted: 2, armed: false });
    expect(JSON.stringify(fake.contexts[1]!.messages)).toContain("Round: 2/2");
  } finally {
    acknowledge.resolve();
    await session?.close();
    await dirs.cleanup();
  }
});

test("fast Human-created Goal usage counts the Human and each round exactly once", async () => {
  const dirs = await tempDirs();
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  try {
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("create_goal", { objective: "Account work", max_goal_rounds: 2 }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Human accepted"),
      fauxAssistantMessage("round one"),
      fauxAssistantMessage("round two"),
    ]);
    session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    await session.rename("usage fixture");
    const human = await session.run("Finish this work");
    await session.waitForIdle();
    const result = await session.waitForRequest(human.requestId);
    const expected = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
    for (const message of session.messages)
      if (message.role === "assistant")
        for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const)
          expected[key] += message.usage[key];
    expect(result.text).toBe("round two");
    expect(result.usage).toEqual(expected);
  } finally {
    await session?.close();
    await dirs.cleanup();
  }
});

test("Goal causal usage includes initial parent, held child and delivered report once", async () => {
  const dirs = await tempDirs();
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  const childStarted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const response: Parameters<typeof fakeModel>[0][number] = async (context) => {
    if (
      !getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
        (tool) => tool.name === "subagent",
      )
    ) {
      childStarted.resolve();
      await release.promise;
      return fauxAssistantMessage("child evidence");
    }
    return fauxAssistantMessage("parent waiting");
  };
  try {
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Usage child",
          prompt: "child work",
          run_in_background: true,
        }),
        { stopReason: "toolUse" },
      ),
      response,
      response,
      fauxAssistantMessage("delivered evidence"),
    ]);
    session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    await session.rename("causal usage fixture");
    const goal = await session.createGoal("Delegate once", { maxRounds: 1 });
    await childStarted.promise;
    const waiting = session.waitForRequest(goal.requestId);
    release.resolve();
    const result = await waiting;
    const directory = session.toolState("subagents");
    if (!Array.isArray(directory) || !directory[0] || typeof directory[0].id !== "string")
      throw new Error("Expected child identity");
    const child = await session.readSubagent(directory[0].id);
    const expected = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
    for (const message of [...session.messages, ...(child?.messages ?? [])])
      if (message.role === "assistant")
        for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const)
          expected[key] += message.usage[key];
    expect(result.text).toBe("delivered evidence");
    expect(result.usage).toEqual(expected);
  } finally {
    release.resolve();
    await session?.close();
    await dirs.cleanup();
  }
});
