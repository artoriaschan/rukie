import { expect, test, onTestFinished } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSession as nativeSession } from "@earendil-works/pi-durable";
import { createSession, createJsonlStore, readSessionSnapshot } from "../../src/index.ts";
import { goalState } from "../../src/tools/goal/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { fakeModel } from "../helpers/fake-model.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSf8AAAAASUVORK5CYII=";

async function fixture(replies: Parameters<typeof fakeModel>[0], clock = { now: 1000 }) {
  const dirs = await tempDirs();
  const sessions: Awaited<ReturnType<typeof createSession>>[] = [];
  const own = (session: Awaited<ReturnType<typeof createSession>>) => sessions.push(session);
  onTestFinished(async () => {
    try {
      for (const session of sessions) await session.close();
    } finally {
      await dirs.cleanup();
    }
  });
  const fake = fakeModel(replies);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    now: () => new Date(clock.now),
  });
  own(session);
  return { dirs, fake, session, clock, own };
}

test("image-only Goals refer to their first message attachments in reminders and later rounds", async () => {
  const { session, fake } = await fixture([
    fauxAssistantMessage("inspect"),
    fauxAssistantMessage("done"),
  ]);
  const accepted = await session.createGoal("  ", {
    images: [{ data: png, mimeType: "image/png" }],
    maxRounds: 2,
  });
  await session.waitForRequest(accepted.requestId);
  expect(session.goal).toMatchObject({ objective: "", attachments: 1 });
  expect(JSON.stringify(fake.contexts[0])).toContain("first Goal message's attachments (1 images)");
  const later = session.messages.find(
    (message) => message.role === "user" && message.source === "goal",
  );
  expect(JSON.stringify(later)).toContain("first Goal message's attachments (1 images)");
  expect(JSON.stringify(later)).not.toContain('Objective: ""');
  await session.clearGoal();
  await expect(session.createGoal("  ")).rejects.toThrow("empty");
  await expect(
    session.createGoal("invalid", { images: [{ data: "bad!", mimeType: "image/png" }] }),
  ).rejects.toThrow();
  expect(session.goal).toBeUndefined();
  expect(fake.contexts).toHaveLength(2);
});

test("Goal time settles each round and freezes at the round limit", async () => {
  const clock = { now: 1000 };
  const f = await fixture(
    [
      () => {
        clock.now = 1300;
        return fauxAssistantMessage("first");
      },
      () => {
        expect(f.session.goal).toMatchObject({ elapsedMs: 300, activeSince: 1300 });
        clock.now = 1800;
        return fauxAssistantMessage("second");
      },
    ],
    clock,
  );
  const accepted = await f.session.createGoal("two rounds", { maxRounds: 2 });
  await f.session.waitForRequest(accepted.requestId);
  expect(f.session.goal).toMatchObject({ elapsedMs: 800, phase: "blocked", armed: false });
  expect(f.session.goal).not.toHaveProperty("activeSince");
  clock.now = 10000;
  expect(f.session.goal!.elapsedMs).toBe(800);
});

test("pause settles immediately and ordinary paused work does not count before resume", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const clock = { now: 1000 };
  const { session } = await fixture(
    [
      async (_context, options) => {
        started.resolve();
        await Promise.race([
          release.promise,
          new Promise<void>((resolve) =>
            options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
          ),
        ]);
        return fauxAssistantMessage("current round finishes");
      },
      () => {
        clock.now = 5000;
        return fauxAssistantMessage("extra guidance");
      },
      () => {
        clock.now = 5400;
        return fauxAssistantMessage("resumed round");
      },
    ],
    clock,
  );
  onTestFinished(() => release.resolve());
  await session.createGoal("finish", { maxRounds: 2 });
  await started.promise;
  clock.now = 1200;
  await session.pauseGoal();
  expect(session.goal).toMatchObject({ phase: "paused", elapsedMs: 200, armed: false });
  expect(session.goal).not.toHaveProperty("activeSince");
  clock.now = 2000;
  release.resolve();
  await session.waitForIdle();
  await session.run("supplement");
  expect(session.goal!.elapsedMs).toBe(200);
  await session.resumeGoal();
  await session.waitForIdle();
  expect(session.goal!.elapsedMs).toBe(600);
});

test.each(["error", "aborted"] as const)(
  "%s settles Goal time and removes the active segment",
  async (stopReason) => {
    const clock = { now: 1000 };
    const { session } = await fixture(
      [
        () => {
          clock.now = 1750;
          return fauxAssistantMessage("stopped", { stopReason });
        },
      ],
      clock,
    );
    await session.createGoal("finish");
    await session.waitForIdle();
    expect(session.goal).toMatchObject({ elapsedMs: 750, armed: false });
    expect(session.goal).not.toHaveProperty("activeSince");
  },
);

test.each(["complete", "blocked"] as const)(
  "%s settles at the model decision and excludes closing narration",
  async (action) => {
    const clock = { now: 1000 };
    const { session } = await fixture(
      [
        () => {
          clock.now = 1500;
          return fauxAssistantMessage(
            fauxToolCall("update_goal", {
              action,
              ...(action === "blocked" ? { blocked_reason: "missing input" } : {}),
            }),
            { stopReason: "toolUse" },
          );
        },
        () => {
          clock.now = 9000;
          return fauxAssistantMessage("closing evidence");
        },
      ],
      clock,
    );
    await session.createGoal("finish");
    await session.waitForIdle();
    expect(session.goal).toMatchObject({ elapsedMs: 500, phase: action, armed: false });
    expect(session.goal).not.toHaveProperty("activeSince");
  },
);

test("recovery discards uncommitted time and starts a new segment for accepted work", async () => {
  const started = Promise.withResolvers<void>();
  const clock = { now: 1000 };
  const f = await fixture(
    [
      () => {
        clock.now = 1300;
        return fauxAssistantMessage("settled first round");
      },
      async (_context, options) => {
        started.resolve();
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
        return fauxAssistantMessage("closed", { stopReason: "aborted" });
      },
    ],
    clock,
  );
  await f.session.createGoal("survive", { maxRounds: 2 });
  await started.promise;
  clock.now = 1700;
  await f.session.close();
  clock.now = 100000;
  const next = fakeModel([
    () => {
      clock.now = 100500;
      return fauxAssistantMessage("resumed", { stopReason: "aborted" });
    },
  ]);
  const resumed = await createSession({
    ...f.dirs,
    ...next,
    resumeId: f.session.id,
    now: () => new Date(clock.now),
  });
  f.own(resumed);
  await resumed.waitForIdle();
  expect(resumed.goal).toMatchObject({ elapsedMs: 800, armed: false });
  expect(resumed.goal).not.toHaveProperty("activeSince");
});

test("Fork retains settled time and drops the parent active segment", async () => {
  const clock = { now: 1000 };
  const f = await fixture(
    [
      () => {
        clock.now = 1300;
        return fauxAssistantMessage("first round");
      },
      () => {
        clock.now = 1600;
        return fauxAssistantMessage(
          fauxToolCall("subagent_fork", {
            description: "Inspect",
            prompt: "child",
            run_in_background: false,
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("child done"),
      fauxAssistantMessage("parent done"),
    ],
    clock,
  );
  await f.session.createGoal("fork time", { maxRounds: 2 });
  await f.session.waitForIdle();
  await f.session.close();
  const lease = await createJsonlStore(f.dirs).open({ id: f.session.id }, BACKGROUND_CONTEXT);
  const native = nativeSession(lease.storage);
  try {
    const conversations = await lease.storage.scanConversations(
      {},
      100,
      undefined,
      BACKGROUND_CONTEXT,
    );
    const child = conversations.items.find((row) => row.owner);
    expect(child).toBeDefined();
    const fact = await native.snapshot(goalState.document, child!.id, BACKGROUND_CONTEXT);
    expect(fact?.value).toMatchObject({ elapsedMs: 300 });
    expect(fact?.value).not.toHaveProperty("activeSince");
  } finally {
    await native.close(BACKGROUND_CONTEXT);
    await lease.release();
  }
});

test.each(["abort", "clear"] as const)(
  "explicit %s stops the clock while preserving the accepted human message",
  async (action) => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const clock = { now: 1000 };
    const { session } = await fixture(
      [
        async (_context, options) => {
          started.resolve();
          await Promise.race([
            release.promise,
            new Promise<void>((resolve) =>
              options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
            ),
          ]);
          return fauxAssistantMessage(action === "abort" ? "aborted" : "answer retained", {
            stopReason: action === "abort" ? "aborted" : "stop",
          });
        },
      ],
      clock,
    );
    onTestFinished(() => release.resolve());
    await session.createGoal("preserve goal message");
    await started.promise;
    clock.now = 1350;
    if (action === "abort") await session.abort();
    else await session.clearGoal();
    release.resolve();
    await session.waitForIdle();
    if (action === "abort") {
      expect(session.goal).toMatchObject({ elapsedMs: 350, armed: false });
      expect(session.goal).not.toHaveProperty("activeSince");
    } else expect(session.goal).toBeUndefined();
    expect(
      session.messages.some(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("preserve goal message"),
      ),
    ).toBe(true);
  },
);

test("Rewind restores the settled elapsed value before the selected human message", async () => {
  const clock = { now: 1000 };
  const { session } = await fixture(
    [
      () => {
        clock.now = 1400;
        return fauxAssistantMessage("paused round", { stopReason: "aborted" });
      },
      fauxAssistantMessage("supplemented"),
      () => {
        clock.now = 2700;
        return fauxAssistantMessage("resumed round", { stopReason: "aborted" });
      },
      fauxAssistantMessage("later detail"),
    ],
    clock,
  );
  await session.createGoal("rewind time", { maxRounds: 3 });
  await session.waitForIdle();
  await session.run("first detail");
  clock.now = 2000;
  await session.resumeGoal();
  await session.waitForIdle();
  expect(session.goal!.elapsedMs).toBe(1100);
  await session.run("later detail");
  await session.rewind(session.checkpoints()[1]!.promptEntryId, {
    conversation: true,
    code: false,
  });
  expect(session.goal).toMatchObject({ elapsedMs: 400, armed: false });
  expect(session.goal).not.toHaveProperty("activeSince");
});

test("a blocked human Goal submission disarms without starting a round", async () => {
  const dirs = await tempDirs();
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  onTestFinished(async () => {
    try {
      await session?.close();
    } finally {
      await dirs.cleanup();
    }
  });
  const fake = fakeModel([]);
  session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: `echo '{"decision":"block","reason":"wait for review"}'`,
              },
            ],
          },
        ],
      },
    },
  });
  const accepted = await session.createGoal("requires review");
  await session.waitForRequest(accepted.requestId);
  expect(session.goal).toMatchObject({ armed: false, roundsStarted: 0 });
  expect(session.goal).not.toHaveProperty("activeSince");
  expect(fake.contexts).toHaveLength(0);
});

test("passive Goal snapshots freeze settled time and grant no live execution authority", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const clock = { now: 1000 };
  const f = await fixture(
    [
      async (_context, options) => {
        started.resolve();
        await Promise.race([
          release.promise,
          new Promise<void>((resolve) =>
            options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
          ),
        ]);
        return fauxAssistantMessage("stopped", { stopReason: "aborted" });
      },
    ],
    clock,
  );
  onTestFinished(() => release.resolve());
  await f.session.createGoal("passive observation");
  await started.promise;
  clock.now = 1400;
  const passive = await readSessionSnapshot({ ...f.dirs, id: f.session.id });
  expect(passive.toolStates?.goal).toMatchObject({ armed: false, elapsedMs: 0 });
  expect(passive.toolStates?.goal).not.toHaveProperty("activeSince");
  expect(f.session.goal).toMatchObject({ armed: true, activeSince: 1000 });
  release.resolve();
  await f.session.waitForIdle();
  await f.session.close();
  const closed = await readSessionSnapshot({ ...f.dirs, id: f.session.id });
  expect(closed.toolStates?.goal).toMatchObject({ armed: false, elapsedMs: 400 });
  expect(closed.toolStates?.goal).not.toHaveProperty("activeSince");
});

test.each([false, true])(
  "rewinding the first image-only Goal message restores its prior Goal facts (replacement: %s)",
  async (replacement) => {
    const f = await fixture([
      ...(replacement
        ? [
            fauxAssistantMessage(fauxToolCall("update_goal", { action: "complete" }), {
              stopReason: "toolUse",
            }),
            fauxAssistantMessage("prior goal completed"),
          ]
        : []),
      fauxAssistantMessage("image inspected", { stopReason: "aborted" }),
    ]);
    if (replacement) {
      await f.session.createGoal("prior complete goal");
      await f.session.waitForIdle();
    }
    const prior = f.session.goal;
    await f.session.createGoal("", { images: [{ data: png, mimeType: "image/png" }] });
    await f.session.waitForIdle();
    await f.session.close();
    const reopened = await createSession({ ...f.dirs, ...fakeModel([]), resumeId: f.session.id });
    f.own(reopened);
    const checkpoint = reopened.checkpoints().at(-1)!;
    await reopened.rewind(checkpoint.promptEntryId, { conversation: true, code: false });
    expect(reopened.goal).toEqual(prior);
    expect(
      reopened.messages.some(
        (message) =>
          message.role === "user" &&
          Array.isArray(message.content) &&
          message.content.some((part) => part.type === "image"),
      ),
    ).toBe(false);
    await reopened.close();
  },
);
