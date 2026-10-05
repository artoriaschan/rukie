import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

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
    expect(events.filter((event) => event.type === "reminder_injected")).toMatchObject([
      { source: "date" },
      {
        source: "project-instructions",
        content: expect.stringContaining("Current project contract."),
      },
      { source: "skills" },
    ]);
    expect(JSON.stringify(session.messages)).not.toContain("manual-compact-context");
    await session.run("next user");
    expect(fake.contexts[2]!.messages.slice(-2)).toMatchObject([
      { role: "user", content: [{ text: "next user" }] },
      { role: "user", content: [{ text: expect.stringContaining("manual-compact-context") }] },
    ]);
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
    expect(events.filter((event) => event.type.startsWith("compaction_"))).toHaveLength(0);
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
    await session.dispose();
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
    expect(
      events.filter(
        (event) => event.type === "compaction_start" || event.type === "compaction_end",
      ),
    ).toHaveLength(0);
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
  const ended = events.find((event) => event.type === "compaction_end")!;
  expect(await Bun.file(join(dirs.cwd, "post.json")).json()).toMatchObject({
    hook_event_name: "PostCompact",
    trigger: "auto",
    compact_summary: ended.summary,
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
  await session.run("third");
  expect(fake.contexts[3]!.messages.slice(-2)).toMatchObject([
    { role: "user", content: [{ text: "third" }] },
    {
      role: "user",
      content: [{ text: "<system-reminder>\ncritical-project-state\n</system-reminder>" }],
    },
  ]);
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
      fauxAssistantMessage("Saved summary."),
      fauxAssistantMessage("next answer"),
    ]);
    fake.model.contextWindow = 4000;
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
    expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(
      event === "PreCompact" ? 0 : 1,
    );
    expect(
      events.filter(
        (event) => event.type === "hook_warning" && event.error?.code === "hook-compaction-blocked",
      ),
    ).toHaveLength(0);
    expect(
      events.filter((event) => event.type === "message_end" && event.message.role === "assistant"),
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
        .flatMap((event) => (event.type === "agent_end" ? event.messages : []))
        .filter(
          (message) =>
            message.role === "assistant" &&
            (message.stopReason === "error" || message.stopReason === "aborted"),
        ),
    ).toHaveLength(0);
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

test("an oversized pending request without earlier Transcript messages to compact does not trigger PreCompact", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("old work ".repeat(2500)),
    fauxAssistantMessage("Saved summary."),
    fauxAssistantMessage("answered"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        PreCompact: [
          { hooks: [{ type: "command", command: "cat >> inputs.jsonl; echo >> inputs.jsonl" }] },
        ],
      },
    },
  });
  await session.run("first");
  await expect(
    session.run("second", {
      onEvent: (event) => {
        if (event.type === "compaction_end") throw new Error("pause after compaction");
      },
    }),
  ).rejects.toThrow("pause after compaction");
  const before = await Bun.file(join(dirs.cwd, "inputs.jsonl")).text();
  expect((await session.run("pending ".repeat(2500))).text).toBe("answered");
  expect(await Bun.file(join(dirs.cwd, "inputs.jsonl")).text()).toBe(before);
});

test("compact SessionStart context attaches to the next Stop feedback user in the same Run", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("old work ".repeat(2500)),
    fauxAssistantMessage("Saved summary."),
    fauxAssistantMessage("conclusion"),
    fauxAssistantMessage("verified"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
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
  await session.run("first");
  expect((await session.run("second")).text).toBe("verified");
  expect(JSON.stringify(fake.contexts[2])).not.toContain("critical-project-state");
  expect(fake.contexts[3]!.messages.slice(-2)).toMatchObject([
    { role: "user", source: "stop_hook", content: [{ text: "verify feedback" }] },
    {
      role: "user",
      content: [{ text: "<system-reminder>\ncritical-project-state\n</system-reminder>" }],
    },
  ]);
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.messages).toEqual(session.messages);
});

test("compact SessionStart context attaches to the next child notification user in the same Run", async () => {
  dirs = await tempDirs();
  const childRelease = Promise.withResolvers<void>();
  const parentWaiting = Promise.withResolvers<void>();
  const reply: Parameters<typeof fakeModel>[0][number] = async (context) => {
    const isChild = !context.messages.some(
      (message) =>
        message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
    );
    if (isChild) {
      await childRelease.promise;
      return fauxAssistantMessage("child finished");
    }
    return fauxAssistantMessage("parent waiting");
  };
  const fake = fakeModel([
    fauxAssistantMessage("old work ".repeat(2500)),
    fauxAssistantMessage("Saved summary."),
    fauxAssistantMessage(
      fauxToolCall("subagent", { description: "Inspect", prompt: "inspect project" }),
      { stopReason: "toolUse" },
    ),
    reply,
    reply,
    fauxAssistantMessage("parent finished"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
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
  await session.run("first");
  const run = session.run("second", {
    onEvent: (event) => {
      if (event.type === "subagents_waiting") parentWaiting.resolve();
    },
  });
  await parentWaiting.promise;
  childRelease.resolve();
  expect((await run).text).toBe("parent finished");
  expect(fake.contexts.at(-1)!.messages.slice(-2)).toMatchObject([
    { role: "user", content: [{ text: expect.stringContaining("child finished") }] },
    {
      role: "user",
      content: [{ text: "<system-reminder>\ncritical-project-state\n</system-reminder>" }],
    },
  ]);
});
