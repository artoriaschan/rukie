import { afterEach, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { createJsonlStore, createSession } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { join } from "node:path";
import { mkdir, rename, rm } from "node:fs/promises";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("Session Resume exposes abnormal and legacy child facts, then persists one summary on the first real prompt", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const stored = await store.create({ cwd: dirs.cwd }, BACKGROUND_CONTEXT);
  const branch = await stored.createBranch("main", null, BACKGROUND_CONTEXT);
  const known = ["completed", "aborted", "error", "length", "hook_stopped", "hook_blocked"].map(
    (outcome) => ({
      id: `child-${outcome}`,
      description: outcome,
      type: "general-purpose",
      latestRun: {
        id: `run-${outcome}`,
        sessionId: `child-${outcome}`,
        parentSessionId: stored.metadata.id,
        startedAt: 10,
        endedAt: 20,
        outcome,
        ...(outcome === "error" && { error: "saved provider failure" }),
      },
    }),
  );
  await branch.appendCustomEntry(
    "tool-state/subagents",
    {
      version: 2,
      value: [...known, { id: "legacy", description: "Old reader", type: "general-purpose" }],
    },
    BACKGROUND_CONTEXT,
  );
  await stored.close(BACKGROUND_CONTEXT);
  const fake = fakeModel([
    fauxAssistantMessage("first answer"),
    fauxAssistantMessage("second answer"),
  ]);
  const session = await createSession({ ...dirs, ...fake, resumeId: stored.metadata.id });
  expect(session.recovery.subagents.map((row) => row.outcome)).toEqual([
    "aborted",
    "error",
    "length",
    "hook_stopped",
    "hook_blocked",
    "unknown",
  ]);
  expect(session.recovery.subagents.find((row) => row.outcome === "error")).toMatchObject({
    id: "child-error",
    runId: "run-error",
    reason: "saved provider failure",
  });
  expect(fake.contexts).toHaveLength(0);
  expect(session.checkpoints()).toEqual([]);
  expect(
    session.messages.some(
      (message) => message.role === "system-reminder" && message.source === "session-resume",
    ),
  ).toBe(false);
  await session.run("verify the existing work");
  const summary = session.messages.filter(
    (message) => message.role === "system-reminder" && message.source === "session-resume",
  );
  expect(summary).toHaveLength(1);
  const text = JSON.stringify(summary);
  for (const fact of [
    "child-aborted",
    "child-error",
    "legacy",
    "unknown",
    "saved provider failure",
    "send_message",
    "not automatically",
    "completed",
  ])
    expect(text).toContain(fact);
  expect(text).not.toContain("child-completed");
  expect(JSON.stringify(fake.contexts[0]!.messages)).toContain("saved provider failure");
  expect(session.checkpoints()).toHaveLength(1);
  await session.run("second real prompt");
  expect(
    session.messages.filter(
      (message) => message.role === "system-reminder" && message.source === "session-resume",
    ),
  ).toEqual(summary);
  await session.dispose();
  const againFake = fakeModel([fauxAssistantMessage("again")]);
  const again = await createSession({ ...dirs, ...againFake, resumeId: session.id });
  expect(againFake.contexts).toHaveLength(0);
  expect(
    again.messages.filter(
      (message) => message.role === "system-reminder" && message.source === "session-resume",
    ),
  ).toHaveLength(1);
  await again.run("check on a new resume");
  expect(
    again.messages.filter(
      (message) => message.role === "system-reminder" && message.source === "session-resume",
    ),
  ).toHaveLength(2);
  expect(again.checkpoints()).toHaveLength(3);
  await again.dispose();
});

test("external shutdown waits for child Run persistence while dispose stays safe in the parent's event callback", async () => {
  dirs = await tempDirs();
  const childStarted = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  const reply: Parameters<typeof fakeModel>[0][number] = async (context, options) => {
    if (
      getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
        (tool) => tool.name === "subagent",
      )
    )
      return fauxAssistantMessage("parent waits");
    childStarted.resolve();
    if (!options!.signal!.aborted)
      await new Promise<void>((resolve) =>
        options!.signal!.addEventListener("abort", () => resolve(), { once: true }),
      );
    cancelled.resolve();
    await release.promise;
    return fauxAssistantMessage("partial work", { stopReason: "aborted" });
  };
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("subagent", { description: "Active", prompt: "working" }), {
      stopReason: "toolUse",
    }),
    reply,
    reply,
  ]);
  const session = await createSession({ ...dirs, ...fake });
  const run = session
    .run("delegate", {
      async onEvent(event) {
        if (event.type === "subagents_waiting") {
          await childStarted.promise;
          await session.dispose();
          waiting.resolve();
        }
      },
    })
    .catch((error) => error);
  try {
    await Promise.all([childStarted.promise, waiting.promise, cancelled.promise]);
    let settled = false;
    const done = session.waitForIdle().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release.resolve();
    await done;
    expect(await run).toBeInstanceOf(Error);
    const untouched = fakeModel([]);
    const restored = await createSession({ ...dirs, ...untouched, resumeId: session.id });
    expect(restored.recovery.subagents).toMatchObject([
      { outcome: "aborted", description: "Active" },
    ]);
    expect(untouched.contexts).toHaveLength(0);
    expect(fake.contexts).toHaveLength(3);
    await restored.dispose();
  } finally {
    release.resolve();
    await run;
    await session.dispose();
  }
});

test.each(["parent", "child"])(
  "shutdown records a failed %s save without rewriting durable child facts",
  async (target) => {
    dirs = await tempDirs();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const warnings: string[] = [];
    const store = createJsonlStore(dirs);
    let damagedPath: string | undefined;
    let childId: string | undefined;
    const blockSave = async (id: string) => {
      const metadata = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT)).find(
        (row) => row.id === id,
      )!;
      if (!("path" in metadata) || typeof metadata.path !== "string")
        throw new Error("Missing native Store path");
      damagedPath = metadata.path;
      await rename(damagedPath, `${damagedPath}.saved`);
      await mkdir(damagedPath);
    };
    const reply: Parameters<typeof fakeModel>[0][number] = async (context, options) => {
      if (
        getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
          (tool) => tool.name === "subagent",
        )
      )
        return fauxAssistantMessage("parent waits");
      started.resolve();
      if (!options!.signal!.aborted)
        await new Promise<void>((resolve) =>
          options!.signal!.addEventListener("abort", () => resolve(), { once: true }),
        );
      await release.promise;
      return fauxAssistantMessage("partial work", { stopReason: "aborted" });
    };
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("subagent", { description: "Active", prompt: "working" }), {
        stopReason: "toolUse",
      }),
      reply,
      reply,
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      onWarning: (warning) => warnings.push(warning),
    });
    const run = session
      .run("delegate", {
        async onEvent(event) {
          if (event.type === "subagents_waiting") {
            await started.promise;
            await session.dispose();
            if (target === "child") {
              childId = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT)).find(
                (row) => row.parentSessionId === session.id,
              )!.id;
              await blockSave(childId);
            }
            release.resolve();
          }
          if (
            target === "parent" &&
            event.type === "subagent_event" &&
            event.event.type === "result"
          ) {
            childId = event.agentId;
            await blockSave(session.id);
          }
        },
      })
      .catch((error) => error);
    try {
      expect(await run).toBeInstanceOf(Error);
      await session.waitForIdle();
      expect(warnings.join("\n")).toContain(
        target === "parent"
          ? "Could not save subagent Run summary"
          : "Could not save subagent Run fact",
      );
      expect(warnings.join("\n")).toContain(childId!);
      await rm(damagedPath!, { recursive: true, force: true });
      await rename(`${damagedPath!}.saved`, damagedPath!);
      damagedPath = undefined;
      const metadata = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT)).find(
        (row) => row.id === childId,
      )!;
      const child = await store.open(metadata, BACKGROUND_CONTEXT);
      try {
        const entries = await (await child.branch("main", BACKGROUND_CONTEXT))!.findEntries(
          { order: "oldestFirst" },
          BACKGROUND_CONTEXT,
        );
        expect(
          entries
            .filter(
              (entry) => entry.type === "custom" && entry.customType === "tool-state/subagent-run",
            )
            .at(-1),
        ).toMatchObject({
          data: {
            value: {
              ...(target === "parent" && { outcome: "aborted" }),
              parentSessionId: session.id,
            },
          },
        });
        if (target === "child")
          expect(JSON.stringify(entries)).not.toContain('"outcome":"completed"');
      } finally {
        await child.close(BACKGROUND_CONTEXT);
      }
    } finally {
      release.resolve();
      await run;
      await session.dispose();
      if (damagedPath) {
        await rm(damagedPath, { recursive: true, force: true });
        await rename(`${damagedPath}.saved`, damagedPath);
      }
    }
  },
);

test("Hook autoruns leave the resume summary pending until a real accepted prompt, without a Checkpoint", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const stored = await store.create({ cwd: dirs.cwd }, BACKGROUND_CONTEXT);
  await (
    await stored.createBranch("main", null, BACKGROUND_CONTEXT)
  ).appendCustomEntry(
    "tool-state/subagents",
    {
      version: 1,
      value: [{ id: "old-child", description: "Legacy work", type: "general-purpose" }],
    },
    BACKGROUND_CONTEXT,
  );
  await stored.close(BACKGROUND_CONTEXT);
  const finished = Promise.withResolvers<void>();
  const fake = fakeModel([
    fauxAssistantMessage("internal hook answer"),
    fauxAssistantMessage("real answer"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    resumeId: stored.metadata.id,
    settings: {
      hooks: {
        SessionStart: [
          {
            matcher: "resume",
            hooks: [
              {
                type: "command",
                command: "printf 'internal startup work' >&2; exit 2",
                asyncRewake: true,
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command:
                  'cat >/dev/null; if [ ! -f attempted ]; then touch attempted; printf \'{"decision":"block","reason":"rejected first prompt"}\'; fi',
              },
            ],
          },
        ],
      },
    },
  });
  session.subscribe((event) => {
    if (event.type === "result") finished.resolve();
  });
  await finished.promise;
  await session.waitForIdle();
  expect(fake.contexts).toHaveLength(1);
  expect(JSON.stringify(fake.contexts[0]!.messages)).not.toContain("Session Resume:");
  expect(
    session.messages.filter(
      (message) => message.role === "system-reminder" && message.source === "session-resume",
    ),
  ).toHaveLength(0);
  expect(session.checkpoints()).toHaveLength(0);
  expect((await session.run("rejected real prompt")).stopReason).toBe("hook_blocked");
  expect(session.checkpoints()).toHaveLength(0);
  expect(fake.contexts).toHaveLength(1);
  await session.run("accepted real prompt");
  expect(JSON.stringify(fake.contexts[1]!.messages)).toContain("old-child (Legacy work): unknown");
  expect(
    session.messages.filter(
      (message) => message.role === "system-reminder" && message.source === "session-resume",
    ),
  ).toHaveLength(1);
  expect(session.checkpoints()).toHaveLength(1);
  await session.dispose();
});

test("a completed-only resume has no warning or summary and keeps normal file Checkpoints", async () => {
  dirs = await tempDirs();
  const first = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Complete",
        prompt: "work",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("child done"),
    fauxAssistantMessage("parent done"),
  ]);
  const original = await createSession({ ...dirs, ...first });
  await original.run("delegate");
  await original.dispose();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("write", { path: "new.txt", content: "new work" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const resumed = await createSession({
    ...dirs,
    ...fake,
    resumeId: original.id,
    permissionMode: "full-access",
  });
  expect(resumed.recovery.subagents).toEqual([]);
  expect(fake.contexts).toHaveLength(0);
  await resumed.run("write new work");
  expect(JSON.stringify(fake.contexts)).not.toContain("Session Resume:");
  expect(resumed.checkpoints()).toHaveLength(2);
  await resumed.rewind(resumed.checkpoints()[1]!.promptEntryId, { code: true, conversation: true });
  expect(await Bun.file(join(dirs.cwd, "new.txt")).exists()).toBe(false);
  expect(resumed.recovery.subagents).toEqual([]);
  await resumed.dispose();
});

test("the public completion boundary waits for a cancelled Hook autorun without consuming recovery", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const stored = await store.create({ cwd: dirs.cwd }, BACKGROUND_CONTEXT);
  await (
    await stored.createBranch("main", null, BACKGROUND_CONTEXT)
  ).appendCustomEntry(
    "tool-state/subagents",
    { version: 1, value: [{ id: "legacy", description: "Old work", type: "general-purpose" }] },
    BACKGROUND_CONTEXT,
  );
  await stored.close(BACKGROUND_CONTEXT);
  const started = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fake = fakeModel([
    async (_context, options) => {
      started.resolve();
      if (!options!.signal!.aborted)
        await new Promise<void>((resolve) =>
          options!.signal!.addEventListener("abort", () => resolve(), { once: true }),
        );
      aborted.resolve();
      await release.promise;
      return fauxAssistantMessage("", { stopReason: "aborted" });
    },
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    resumeId: stored.metadata.id,
    settings: {
      hooks: {
        SessionStart: [
          {
            matcher: "resume",
            hooks: [
              {
                type: "command",
                command: "printf 'internal follow-up' >&2; exit 2",
                asyncRewake: true,
              },
            ],
          },
        ],
      },
    },
  });
  try {
    await started.promise;
    await session.dispose();
    await aborted.promise;
    let closed = false;
    const completion = session.waitForIdle().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release.resolve();
    await completion;
    expect(session.running).toBe(false);
    expect(fake.contexts).toHaveLength(1);
    const restored = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    expect(restored.checkpoints()).toHaveLength(0);
    expect(
      restored.messages.filter(
        (message) => message.role === "system-reminder" && message.source === "session-resume",
      ),
    ).toHaveLength(0);
    await restored.dispose();
  } finally {
    release.resolve();
    await session.waitForIdle();
    await session.dispose();
  }
});
