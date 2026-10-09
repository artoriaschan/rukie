import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { expect, test } from "bun:test";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
  awaitWithContext,
} from "@earendil-works/chord/context";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  GenerationTask,
  LiveDoc,
  hook,
} from "@earendil-works/pi-durable";
import { createGoalRuntime, readGoalReceipt } from "../../../src/tools/goal/index.ts";
import { goalState } from "../../../src/tools/goal/state.ts";
import { createRequestLedger, requestIds } from "../../../src/requests/index.ts";
import { fakeModel } from "../../helpers/fake-model.ts";

async function fixture(
  replies: Parameters<typeof fakeModel>[0] = [],
  admission?: {
    before(requestId: string): Promise<void>;
    after(requestId: string): void;
  },
) {
  const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
  const fake = fakeModel(replies);
  const storage = new MemoryStorage();
  const registry = createRegistry();
  const harness = await Harness.open(storage, { models: fake.models, registry }, context);
  const conversation = await harness.root(context, {
    agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
  });
  const ledger = createRequestLedger({
    harness,
    storage,
    context,
    conversation: () => conversation,
    history: async () => [...(await conversation.context(context)).entries],
    flush: async () => {},
    updateContext: () => {},
    fault: new Promise<never>(() => {}),
    assertAvailable: () => {},
    publish: () => {},
    goalReceipt: readGoalReceipt,
    subagentReceipt: () => ({
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    }),
  });
  const runtime = createGoalRuntime({
    harness,
    storage,
    context,
    conversation: () => conversation,
    ledger: () => ledger,
    submit: async (prompt, requestId, ctx) => {
      await admission?.before(requestId);
      const submission = await conversation.submit(
        { type: "input", content: prompt, requestId, whenBusy: "followUp" },
        ctx,
      );
      await ledger.registerSubmission(requestId, submission.id);
      admission?.after(requestId);
      return submission.id;
    },
    settle: (requestId, ctx) => awaitWithContext(ledger.waitForRequest(requestId), ctx),
    settleCancelled: (requestId, submissionId, ctx) =>
      awaitWithContext(ledger.resultFor(requestId, submissionId), ctx),
  });
  registry.install(runtime.extension);
  registry.install({
    name: "goal-fixture",
    hooks: [
      hook(GenerationTask, {
        beforeRequest: async (_request, _api, ctx) => {
          const live = await harness.snapshot(LiveDoc, conversation.id, ctx);
          const inputs = await Promise.all(
            (live?.run?.inputs ?? []).map((id) => storage.submission(id, ctx)),
          );
          await runtime.beforeRequest(inputs, ctx);
        },
      }),
    ],
  });
  const observer = harness.subscribeCommits((publication) => {
    for (const change of publication.changes) runtime.observe(change);
  });
  await runtime.restore(null);
  const snapshot = {
    id: "goal",
    objective: "Verify work",
    phase: "active" as const,
    roundsStarted: 0,
    maxRounds: 2,
  };
  return { context, harness, conversation, runtime, ledger, snapshot, observer };
}

test("accepted round placement counts once and rejects skipping an unplaced round", async () => {
  const f = await fixture();
  try {
    await f.runtime.persist(f.snapshot, true);
    const activation = f.runtime.activation;
    const requestId = requestIds.goalRound(activation.requestId!, activation.taskId!, 1);
    expect(await f.runtime.beforeRequest([{ requestId }], f.context)).toBe(true);
    await f.runtime.beforeRequest([{ requestId }], f.context);
    expect(
      (await f.harness.snapshot(goalState.document, f.conversation.id, f.context))?.value,
    ).toMatchObject({ roundsStarted: 1 });
    await expect(
      f.runtime.beforeRequest(
        [{ requestId: requestIds.goalRound(activation.requestId!, activation.taskId!, 3) }],
        f.context,
      ),
    ).rejects.toThrow("placement");
  } finally {
    f.observer();
    await f.harness.close(f.context);
  }
});

test("pausing an accepted Goal before its first placement consumes no round", async () => {
  const f = await fixture();
  try {
    await f.runtime.persist(f.snapshot, true);
    await f.runtime.persist({ ...f.snapshot, phase: "paused" }, false);
    await f.conversation.waitForIdle(f.context);
    expect(f.runtime.isArmed()).toBe(false);
    expect(
      (await f.harness.snapshot(goalState.document, f.conversation.id, f.context))?.value,
    ).toMatchObject({ phase: "paused", roundsStarted: 0 });
  } finally {
    f.observer();
    await f.harness.close(f.context);
  }
});

test("wrapup continuation is consumed once with committed Goal provenance", async () => {
  const f = await fixture();
  try {
    f.runtime.queueWrapup("Closing verified objective");
    expect(await f.runtime.yieldWrapup(123, f.context)).toEqual({
      continue: "Closing verified objective",
    });
    expect(await f.runtime.yieldWrapup(123, f.context)).toBeUndefined();
    expect((await f.conversation.context(f.context)).entries.at(-1)).toMatchObject({
      kind: "rukie.message-facts",
      data: { taskId: 123, content: "Closing verified objective", source: "goal" },
    });
  } finally {
    f.observer();
    await f.harness.close(f.context);
  }
});

test("driver reaches the round cap through accepted native inputs and retains its final receipt", async () => {
  const f = await fixture([fauxAssistantMessage("first"), fauxAssistantMessage("last")]);
  try {
    await f.runtime.persist(f.snapshot, true);
    const requestId = f.runtime.activation.requestId!;
    const result = await f.ledger.waitForRequest(requestId);
    expect(result).toMatchObject({ success: true, text: "last" });
    expect(
      (await f.harness.snapshot(goalState.document, f.conversation.id, f.context))?.value,
    ).toMatchObject({
      phase: "blocked",
      roundsStarted: 2,
      blockedReason: "Goal reached its 2 round limit. Start a new Goal to continue.",
    });
    expect(f.runtime.isArmed()).toBe(false);
    expect(f.runtime.activation.requestId).toBe(requestId);
  } finally {
    f.observer();
    await f.harness.close(f.context);
  }
});

test("restore rejects an activation belonging to another Goal and never grants new execution authority", async () => {
  const f = await fixture();
  try {
    await f.runtime.persist(f.snapshot, true);
    await expect(f.runtime.restore({ ...f.snapshot, id: "other" })).rejects.toThrow(
      "activation task",
    );
    await f.runtime.persist({ ...f.snapshot, phase: "paused" }, false);
    await f.conversation.waitForIdle(f.context);
    await f.runtime.restore({ ...f.snapshot, phase: "paused" });
    expect(f.runtime.isArmed()).toBe(false);
  } finally {
    f.observer();
    await f.harness.close(f.context);
  }
});

test("disarming retains the accepted Request receipt identity and ignores foreign round placement", async () => {
  const f = await fixture();
  try {
    await f.runtime.persist(f.snapshot, true);
    const accepted = f.runtime.activation.requestId;
    await f.runtime.beforeRequest(
      [{ requestId: "goal:other:activation:foreign:round:99:1" }],
      f.context,
    );
    expect(
      (await f.harness.snapshot(goalState.document, f.conversation.id, f.context))?.value,
    ).toMatchObject({ roundsStarted: 0 });
    await f.runtime.clearActivation(f.context);
    expect(f.runtime.activation).toEqual({ taskId: null, requestId: accepted });
    expect(await f.runtime.beforeRequest([{ requestId: requestIds.human() }], f.context)).toBe(
      false,
    );
  } finally {
    f.observer();
    await f.harness.close(f.context);
  }
});

test("pending wrapup is placed once before a subsequent request with Goal source facts", async () => {
  const f = await fixture();
  try {
    f.runtime.queueWrapup("Grounded closing report");
    await f.runtime.prepareWrapup(f.context);
    await f.runtime.prepareWrapup(f.context);
    const entries = (await f.conversation.context(f.context)).entries;
    expect(entries.filter((entry) => entry.kind === "rukie.goal-wrapup")).toHaveLength(1);
    expect(entries.at(-1)).toMatchObject({ kind: "rukie.message-facts", data: { source: "goal" } });
    expect(await f.runtime.yieldWrapup(321, f.context)).toBeUndefined();
  } finally {
    f.observer();
    await f.harness.close(f.context);
  }
});

test.each(["pause", "clear", "resume"] as const)(
  "%s withdraws a queued Goal round while preserving its independent Human answer",
  async (action) => {
    const admissionReady = Promise.withResolvers<void>();
    const admit = Promise.withResolvers<void>();
    const queued = Promise.withResolvers<void>();
    const humanStarted = Promise.withResolvers<void>();
    const humanAnswer = Promise.withResolvers<void>();
    let gateNextRound = true;
    const f = await fixture(
      [
        fauxAssistantMessage("first"),
        async () => {
          humanStarted.resolve();
          await humanAnswer.promise;
          return fauxAssistantMessage("Human survives");
        },
        fauxAssistantMessage("resumed round"),
      ],
      {
        async before(id) {
          if (gateNextRound && id.endsWith(":2")) {
            gateNextRound = false;
            admissionReady.resolve();
            await admit.promise;
          }
        },
        after(id) {
          if (id.endsWith(":2")) queued.resolve();
        },
      },
    );
    try {
      await f.runtime.persist(f.snapshot, true);
      f.harness.resume();
      await awaitWithContext(admissionReady.promise, f.context);
      const human = await f.conversation.submit(
        { type: "input", content: "Human priority", requestId: requestIds.human() },
        f.context,
      );
      await awaitWithContext(humanStarted.promise, f.context);
      admit.resolve();
      await awaitWithContext(queued.promise, f.context);
      const current = (await f.harness.snapshot(goalState.document, f.conversation.id, f.context))!
        .value;
      if (!current || typeof current !== "object" || Array.isArray(current))
        throw new Error("Missing Goal snapshot");
      expect(current).toMatchObject({ roundsStarted: 1 });
      await f.runtime.persist(
        action === "clear" ? null : { ...f.snapshot, roundsStarted: 1, phase: "paused" },
        false,
      );
      humanAnswer.resolve();
      expect(await human.wait(f.context)).toMatchObject({ status: "done" });
      await f.conversation.waitForIdle(f.context);
      if (action === "resume") {
        await f.runtime.persist({ ...f.snapshot, roundsStarted: 1 }, true);
        await f.ledger.waitForRequest(f.runtime.activation.requestId!);
      }
      const final = (await f.harness.snapshot(goalState.document, f.conversation.id, f.context))
        ?.value;
      if (action === "clear") expect(final).toBeNull();
      else
        expect(final).toMatchObject({
          phase: action === "resume" ? "blocked" : "paused",
          roundsStarted: action === "resume" ? 2 : 1,
        });
      expect(f.runtime.isArmed()).toBe(false);
    } finally {
      admit.resolve();
      humanAnswer.resolve();
      f.observer();
      await f.harness.close(f.context);
    }
  },
);
