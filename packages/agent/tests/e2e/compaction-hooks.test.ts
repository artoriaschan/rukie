import { withModelAlias } from "../helpers/auxiliary-model.ts";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import {
  createSession as createSessionImpl,
  type Session,
  type SessionEvent,
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

function oldToolEvidence() {
  return [
    fauxAssistantMessage(fauxToolCall("read", { path: "old.txt" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("old evidence inspected"),
    fauxAssistantMessage(fauxToolCall("read", { path: "old.txt" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("second evidence inspected"),
    fauxAssistantMessage("recent protected answer"),
  ];
}
async function seedHookHistory(session: Session) {
  await Bun.write(join(dirs.cwd, "old.txt"), "OLD_EVIDENCE widget contract ".repeat(2000));
  await session.run("inspect old work");
  await session.run("inspect second work");
  await session.run("recent retained work");
  await session.setModel("hook-window/small");
}

test.each([undefined, "keep API details"])(
  "manual compaction hooks receive focus %s and reinject current reminders for the next user",
  async (instructions) => {
    dirs = await tempDirs();
    await Bun.write(join(dirs.cwd, "AGENTS.md"), "Current project contract.");
    await Bun.write(join(dirs.cwd, "pre.sh"), "cat > pre.json\n");
    await Bun.write(join(dirs.cwd, "post.sh"), "cat > post.json\n");
    await Bun.write(join(dirs.cwd, "start.sh"), "cat > start.json\necho manual-compact-context\n");
    const fake = fakeModel([
      fauxAssistantMessage("old work"),
      fauxAssistantMessage("recent work"),
      fauxAssistantMessage("Manual summary."),
      fauxAssistantMessage("next answer"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        hooks: {
          PreCompact: [{ matcher: "manual", hooks: [{ type: "command", command: "sh pre.sh" }] }],
          PostCompact: [{ matcher: "manual", hooks: [{ type: "command", command: "sh post.sh" }] }],
          SessionStart: [
            { matcher: "compact", hooks: [{ type: "command", command: "sh start.sh" }] },
          ],
        },
      },
    });
    await session.run("first");
    await session.run("retained recent task " + "retained fact ".repeat(6000));
    const events: SessionEvent[] = [];
    session.subscribe((event) => events.push(event));
    await session.compact({ instructions });
    expect(await Bun.file(join(dirs.cwd, "pre.json")).json()).toMatchObject({
      trigger: "manual",
      custom_instructions: instructions ?? "",
    });
    expect(await Bun.file(join(dirs.cwd, "post.json")).json()).toMatchObject({
      trigger: "manual",
      custom_instructions: instructions ?? "",
      compact_summary: "Manual summary.",
    });
    expect(await Bun.file(join(dirs.cwd, "start.json")).json()).toMatchObject({
      source: "compact",
    });
    expect(session.messages).toContainEqual(
      expect.objectContaining({
        role: "system-reminder",
        source: "project-instructions",
        content: expect.stringContaining("Current project contract."),
      }),
    );
    expect(JSON.stringify(session.messages)).not.toContain("manual-compact-context");
    await session.run("next user");
    expect(JSON.stringify(fake.contexts[3]!.messages)).toContain("next user");
    expect(JSON.stringify(fake.contexts[3]!.messages)).toContain("manual-compact-context");
  },
);

test.each(["block", "stop"])(
  "manual PreCompact %s throws its reason and a later run still works",
  async (kind) => {
    dirs = await tempDirs();
    await Bun.write(
      join(dirs.cwd, "pre.sh"),
      `cat > pre.json\necho '${kind === "block" ? '{"decision":"block","reason":"preserve review evidence"}' : '{"continue":false,"stopReason":"preserve review evidence"}'}'\n`,
    );
    const fake = fakeModel([fauxAssistantMessage("old work"), fauxAssistantMessage("next answer")]);
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        hooks: {
          PreCompact: [{ matcher: "manual", hooks: [{ type: "command", command: "sh pre.sh" }] }],
        },
      },
    });
    await session.run("first");
    const before = structuredClone(session.messages);
    const events: SessionEvent[] = [];
    session.subscribe((event) => events.push(event));
    await expect(session.compact()).rejects.toMatchObject({
      code: kind === "block" ? "hook-compaction-blocked" : "compaction-hook-stopped-reason",
      params: { reason: "preserve review evidence" },
    });
    expect(session.messages).toEqual(before);
    expect(
      session.messages.filter(
        (message) => message.role === "session-notice" && message.notice.kind === "compaction",
      ),
    ).toEqual([]);
    expect(fake.contexts).toHaveLength(1);
    expect((await session.run("next prompt")).text).toBe("next answer");
  },
);

test("manual compaction stopped without a hook reason returns a locale-independent failure", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("old work")]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        PreCompact: [{ hooks: [{ type: "command", command: "echo '{\"continue\":false}'" }] }],
      },
    },
  });
  try {
    await session.run("first");
    const before = structuredClone(session.messages);
    await expect(session.compact()).rejects.toMatchObject({
      code: "compaction-hook-stopped",
      params: {},
    });
    expect(session.messages).toEqual(before);
    expect(fake.contexts).toHaveLength(1);
  } finally {
    await session.close();
  }
});

test.each(["json", "exit"])(
  "PreCompact %s skips once and retries at the next threshold",
  async (kind) => {
    dirs = await tempDirs();
    await Bun.write(
      join(dirs.cwd, "pre.sh"),
      `cat >> pre.jsonl\necho >> pre.jsonl\nif [ ! -e checked ]; then touch checked; ${kind === "json" ? `echo '{"decision":"block","reason":"keep history"}'` : "echo 'keep history' >&2; exit 2"}; fi\n`,
    );
    const fake = fakeModel([
      fauxAssistantMessage("old work ".repeat(2500)),
      fauxAssistantMessage("without compaction"),
      fauxAssistantMessage("Saved summary."),
      fauxAssistantMessage("after compaction"),
    ]);
    fake.model.contextWindow = 4000;
    fake.models = withModelAlias(fake.models, "hook-window", ["large"], { contextWindow: 128000 });
    const warnings: string[] = [];
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      onWarning: (warning) => {
        warnings.push(warning);
      },
      settings: {
        hooks: {
          PreCompact: [
            { matcher: "auto", hooks: [{ type: "command", command: "sh pre.sh" }] },
            { matcher: "manual", hooks: [{ type: "command", command: "touch wrong-trigger" }] },
          ],
        },
      },
    });
    await session.run("first");
    expect(await Bun.file(join(dirs.cwd, "pre.jsonl")).exists()).toBe(false);
    const onEvent = (event: SessionEvent) => {
      events.push(event);
    };
    expect((await session.run("second", { onEvent })).text).toBe("without compaction");
    expect(JSON.stringify(fake.contexts[1])).toContain("old work old work");
    // A declined native CompactionTask still has lifecycle events; only a
    // committed compaction changes the durable Transcript.
    expect(
      session.messages.filter(
        (message) => message.role === "session-notice" && message.notice.kind === "compaction",
      ),
    ).toHaveLength(0);
    expect(fake.contexts).toHaveLength(2);
    expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
      {
        event: "PreCompact",
        error: { code: "hook-compaction-blocked", params: { reason: "keep history" } },
      },
    ]);
    expect(warnings).toHaveLength(1);
    events.length = 0;
    expect((await session.run("third", { onEvent })).text).toBe("after compaction");
    expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(1);
    const inputs = (await Bun.file(join(dirs.cwd, "pre.jsonl")).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(inputs).toHaveLength(2);
    expect(inputs).toMatchObject([
      {
        hook_event_name: "PreCompact",
        trigger: "auto",
        custom_instructions: null,
        session_id: session.id,
      },
      { trigger: "auto" },
    ]);
    expect(await Bun.file(join(dirs.cwd, "wrong-trigger")).exists()).toBe(false);
  },
);

test("PostCompact receives the stored summary after compaction_end, then compact SessionStart waits for the next user", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "post.sh"),
    `cat > post.json\necho post >> order\necho '{"decision":"block","systemMessage":"summary saved"}'\nexit 2\n`,
  );
  await Bun.write(
    join(dirs.cwd, "start.sh"),
    "cat > start.json\necho start >> order\necho critical-project-state\n",
  );
  const fake = fakeModel([
    fauxAssistantMessage("old work ".repeat(2500)),
    fauxAssistantMessage("Saved summary."),
    fauxAssistantMessage("after compaction"),
    fauxAssistantMessage("next answer"),
  ]);
  fake.model.contextWindow = 4000;
  fake.models = withModelAlias(fake.models, "hook-window", ["large"], { contextWindow: 128000 });
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning: () => {},
    settings: {
      hooks: {
        PostCompact: [{ matcher: "auto", hooks: [{ type: "command", command: "sh post.sh" }] }],
        SessionStart: [
          { matcher: "compact", hooks: [{ type: "command", command: "sh start.sh" }] },
        ],
      },
    },
  });
  await session.run("first");
  const events: SessionEvent[] = [];
  await session.run("second", {
    onEvent: async (event) => {
      events.push(event);
      if (event.type === "compaction_end") {
        expect(await Bun.file(join(dirs.cwd, "post.json")).exists()).toBe(false);
        await Bun.write(join(dirs.cwd, "order"), "end\n");
      }
    },
  });
  expect(events.some((event) => event.type === "compaction_end")).toBe(true);
  expect(await Bun.file(join(dirs.cwd, "post.json")).json()).toMatchObject({
    hook_event_name: "PostCompact",
    trigger: "auto",
    compact_summary: "Saved summary.",
    session_id: session.id,
  });
  expect(await Bun.file(join(dirs.cwd, "start.json")).json()).toMatchObject({
    hook_event_name: "SessionStart",
    source: "compact",
    model: `${fake.model.provider}/${fake.model.id}`,
  });
  expect(await Bun.file(join(dirs.cwd, "order")).text()).toBe("end\npost\nstart\n");
  expect(events.filter((event) => event.type === "hook_message")).toMatchObject([
    { event: "PostCompact", message: "summary saved" },
  ]);
  expect(JSON.stringify(fake.contexts[2])).not.toContain("critical-project-state");
  await session.setModel("hook-window/large");
  await session.run("third");
  expect(fake.contexts[3]!.messages.slice(-2)).toMatchObject([
    { role: "user", content: [{ text: "third" }] },
    {
      role: "user",
      content: [{ text: "<system-reminder>\ncritical-project-state\n</system-reminder>" }],
    },
  ]);
  await session.close();
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.messages).toEqual(session.messages);
});

test.each(["PreCompact", "PostCompact", "SessionStart"] as const)(
  "%s continue:false stops compaction work before the next model request",
  async (event) => {
    dirs = await tempDirs();
    await Bun.write(
      join(dirs.cwd, "halt.sh"),
      `cat > halt.json\nif [ ! -e halted ]; then touch halted; echo '{"continue":false,"stopReason":"halt compaction","decision":"block","reason":"must not win"}'; fi\n`,
    );
    const fake = fakeModel([
      fauxAssistantMessage("old work ".repeat(2500)),
      ...(event === "PreCompact" ? [] : [fauxAssistantMessage("Saved summary.")]),
      fauxAssistantMessage("next answer"),
    ]);
    fake.model.contextWindow = 4000;
    fake.models = withModelAlias(fake.models, "hook-window", ["large"], { contextWindow: 128000 });
    const session = await createSession({
      ...dirs,
      ...fake,
      onWarning: () => {},
      settings: {
        hooks: {
          [event]: [
            {
              matcher: event === "SessionStart" ? "compact" : "auto",
              hooks: [{ type: "command", command: "sh halt.sh" }],
            },
          ],
        },
      },
    });
    await session.run("first");
    const events: SessionEvent[] = [];
    expect(
      await session.run("halted prompt", {
        onEvent: (event) => {
          events.push(event);
        },
      }),
    ).toMatchObject({ success: true, stopReason: "hook_stopped", reason: "halt compaction" });
    expect(fake.contexts).toHaveLength(event === "PreCompact" ? 1 : 2);
    expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(1);
    expect(
      session.messages.filter(
        (message) => message.role === "session-notice" && message.notice.kind === "compaction",
      ),
    ).toHaveLength(event === "PreCompact" ? 0 : 1);
    expect(
      events.filter(
        (event) => event.type === "hook_warning" && event.error?.code === "hook-compaction-blocked",
      ),
    ).toHaveLength(0);
    expect(
      events.filter(
        (event) =>
          event.type === "message_end" &&
          event.messages.some((message) => message.role === "assistant"),
      ),
    ).toHaveLength(0);
    expect(
      session.messages.filter(
        (message) =>
          message.role === "assistant" &&
          (message.stopReason === "error" || message.stopReason === "aborted"),
      ),
    ).toHaveLength(0);
    const input = await Bun.file(join(dirs.cwd, "halt.json")).json();
    const transcript = await Bun.file(input.transcript_path).text();
    expect(transcript).not.toContain("Hook request stopped:");
    expect(transcript).not.toContain('"errorMessage"');
    expect(
      events
        .flatMap((event) => (event.type === "message_end" ? event.messages : []))
        .filter(
          (message) =>
            message.role === "assistant" &&
            (message.stopReason === "error" || message.stopReason === "aborted"),
        ),
    ).toHaveLength(0);
    await session.setModel("hook-window/large");
    expect((await session.run("next prompt")).text).toBe("next answer");
  },
);

test.each([
  ["bad JSON", `echo '{broken}'`, "hook-invalid-json"],
  ["timeout", "sleep 1", "hook-timeout"],
  ["exit failure", "echo failed >&2; exit 1", "hook-exit"],
])("PreCompact %s warns and compaction proceeds", async (_kind, command, code) => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("old work ".repeat(2500)),
    fauxAssistantMessage("Saved summary."),
    fauxAssistantMessage("continued"),
  ]);
  fake.model.contextWindow = 4000;
  fake.models = withModelAlias(fake.models, "hook-window", ["large"], { contextWindow: 128000 });
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning: () => {},
    settings: {
      hooks: { PreCompact: [{ hooks: [{ type: "command", command: command!, timeout: 0.02 }] }] },
    },
  });
  await session.run("first");
  const events: SessionEvent[] = [];
  expect(
    (
      await session.run("second", {
        onEvent: (event) => {
          events.push(event);
        },
      })
    ).text,
  ).toBe("continued");
  expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
    { event: "PreCompact", error: { code } },
  ]);
  expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(1);
});

test("an oversized first request preserves its input when native Compaction summarizes initial reminders", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("Initial guidance summary."),
    fauxAssistantMessage("answered"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: { PreCompact: [{ hooks: [{ type: "command", command: "cat >> inputs.jsonl" }] }] },
    },
  });
  const prompt = "pending ".repeat(2500);
  expect((await session.run(prompt)).text).toBe("answered");
  expect(fake.contexts).toHaveLength(2);
  expect(JSON.stringify(fake.contexts[1])).toContain(prompt);
  expect(await Bun.file(join(dirs.cwd, "inputs.jsonl")).json()).toMatchObject({
    trigger: "auto",
    custom_instructions: null,
  });
  expect(JSON.stringify(fake.contexts[1])).toContain("Initial guidance summary.");
});

test("compact SessionStart context attaches to the next Stop feedback user in the same Run", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    ...oldToolEvidence(),
    fauxAssistantMessage("Saved summary."),
    fauxAssistantMessage("conclusion"),
    fauxAssistantMessage("verified"),
  ]);
  fake.models = withModelAlias(fake.models, "hook-window", ["large"], { contextWindow: 128000 });
  const provider = fake.models.getProvider("hook-window")!;
  const large = provider.getModels()[0]!;
  fake.models.setProvider({
    ...provider,
    getModels: () => [large, { ...large, id: "small", contextWindow: 16000 }],
  });
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      model: "hook-window/large",
      hooks: {
        SessionStart: [
          {
            matcher: "compact",
            hooks: [{ type: "command", command: "touch compacted; echo critical-project-state" }],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `if [ -f compacted ] && [ ! -f checked ]; then touch checked; echo '{"decision":"block","reason":"verify feedback"}'; fi`,
              },
            ],
          },
        ],
      },
    },
  });
  await seedHookHistory(session);
  expect((await session.run("second")).text).toBe("verified");
  expect(JSON.stringify(fake.contexts[6])).not.toContain("critical-project-state");
  expect(fake.contexts[7]!.messages.slice(-2)).toMatchObject([
    { role: "user", source: "stop_hook", content: [{ text: "verify feedback" }] },
    {
      role: "user",
      content: [{ text: "<system-reminder>\ncritical-project-state\n</system-reminder>" }],
    },
  ]);
  await session.close();
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.messages).toEqual(session.messages);
});

test("compact SessionStart context attaches to the next child notification user in the same Run", async () => {
  dirs = await tempDirs();
  const childRelease = Promise.withResolvers<void>();
  const childStarted = Promise.withResolvers<void>();
  const reply: Parameters<typeof fakeModel>[0][number] = async (context) => {
    const isChild = context.messages.some(
      (message) =>
        message.role === "user" && JSON.stringify(message.content).includes("inspect project"),
    );
    if (isChild) {
      childStarted.resolve();
      await childRelease.promise;
      return fauxAssistantMessage("child finished");
    }
    return fauxAssistantMessage("parent waiting");
  };
  const fake = fakeModel([
    ...oldToolEvidence(),
    fauxAssistantMessage("Saved summary."),
    fauxAssistantMessage(
      fauxToolCall("subagent", { description: "Inspect", prompt: "inspect project" }),
      { stopReason: "toolUse" },
    ),
    reply,
    reply,
    fauxAssistantMessage("parent finished"),
  ]);
  fake.models = withModelAlias(fake.models, "hook-window", ["large"], { contextWindow: 128000 });
  const provider = fake.models.getProvider("hook-window")!;
  const large = provider.getModels()[0]!;
  fake.models.setProvider({
    ...provider,
    getModels: () => [large, { ...large, id: "small", contextWindow: 16000 }],
  });
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      model: "hook-window/large",
      hooks: {
        SessionStart: [
          {
            matcher: "compact",
            hooks: [{ type: "command", command: "echo critical-project-state" }],
          },
        ],
      },
    },
  });
  await seedHookHistory(session);
  const run = session.run("second");
  await childStarted.promise;
  childRelease.resolve();
  await run;
  expect(await session.waitForRequest(session.currentRequestId!)).toMatchObject({
    text: "parent finished",
  });
  expect(JSON.stringify(fake.contexts.at(-1)!.messages)).toContain("child finished");
  expect(JSON.stringify(fake.contexts.at(-1)!.messages)).toContain("critical-project-state");
});
