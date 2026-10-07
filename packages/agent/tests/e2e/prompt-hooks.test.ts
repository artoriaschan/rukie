import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each([
  ["UserPromptSubmit", "{branch state"],
  ["UserPromptSubmit", "branch state }"],
  ["SessionStart", "{branch state"],
  ["SessionStart", "branch state }"],
] as const)("%s accepts plain stdout %s with only one JSON boundary", async (event, text) => {
  dirs = await tempDirs();
  const warnings: string[] = [];
  const fake = fakeModel([fauxAssistantMessage("accepted")]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning: (warning) => {
      warnings.push(warning);
    },
    settings: {
      hooks: { [event]: [{ hooks: [{ type: "command", command: `printf '%s' '${text}'` }] }] },
    },
  });
  await session.run("prompt");
  expect(warnings).toEqual([]);
  expect(JSON.stringify(fake.contexts[0]!.messages)).toContain(
    `<system-reminder>\\n${text}\\n</system-reminder>`,
  );
});

test.each(["json", "exit"])(
  "UserPromptSubmit %s blocks without storing or sending the prompt",
  async (kind) => {
    dirs = await tempDirs();
    await Bun.write(
      join(dirs.cwd, "prompt.sh"),
      `cat > input.json\n${kind === "json" ? `echo '{"decision":"block","reason":"secret rejected"}'` : "echo 'secret rejected' >&2\nexit 2"}\n`,
    );
    const fake = fakeModel([fauxAssistantMessage("should not run")]);
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        hooks: {
          UserPromptSubmit: [
            { matcher: "ignored", hooks: [{ type: "command", command: "sh prompt.sh" }] },
          ],
        },
      },
    });
    const events: SessionEvent[] = [];
    const result = await session.run("private prompt", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(result).toMatchObject({
      success: true,
      stopReason: "hook_blocked",
      reason: "secret rejected",
    });
    expect(fake.contexts).toHaveLength(0);
    expect(session.messages.some((message) => message.role === "user")).toBe(false);
    const input = await Bun.file(join(dirs.cwd, "input.json")).json();
    expect(input).toMatchObject({
      hook_event_name: "UserPromptSubmit",
      prompt: "private prompt",
      session_id: session.id,
    });
    expect(await Bun.file(input.transcript_path).text()).not.toContain("private prompt");
    expect(events.findLast((event) => event.type === "result")).toMatchObject({
      type: "result",
      stopReason: "hook_blocked",
      reason: "secret rejected",
    });
  },
);

test.each(["UserPromptSubmit", "SessionStart"] as const)(
  "%s continue:false takes priority and stops only its run",
  async (event) => {
    dirs = await tempDirs();
    await Bun.write(
      join(dirs.cwd, "stop.sh"),
      `cat > stopped-input.json\nif [ ! -e stopped ]; then touch stopped; echo '{"continue":false,"stopReason":"stop now","decision":"block","reason":"block reason"}'; fi\n`,
    );
    const fake = fakeModel([fauxAssistantMessage("next run")]);
    const session = await createSession({
      ...dirs,
      ...fake,
      onWarning: () => {},
      settings: { hooks: { [event]: [{ hooks: [{ type: "command", command: "sh stop.sh" }] }] } },
    });
    const result = await session.run("stopped");
    expect(result).toMatchObject({ success: true, stopReason: "hook_stopped", reason: "stop now" });
    expect(fake.contexts).toHaveLength(0);
    expect(session.messages.some((message) => message.role === "user")).toBe(false);
    expect((await session.run("next")).text).toBe("next run");
  },
);

test.each(["json", "exit"])(
  "SessionStart ignores %s blocking and accepts plain stdout as context",
  async (kind) => {
    dirs = await tempDirs();
    const fake = fakeModel([fauxAssistantMessage("accepted")]);
    const session = await createSession({
      ...dirs,
      ...fake,
      onWarning: () => {},
      settings: {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    kind === "json"
                      ? `echo '{"decision":"block","reason":"cannot block"}'`
                      : "echo cannot-block >&2; exit 2",
                },
                { type: "command", command: "echo session-start-context" },
              ],
            },
          ],
        },
      },
    });
    expect((await session.run("accepted")).text).toBe("accepted");
    expect(JSON.stringify(fake.contexts[0]!.messages)).toContain(
      "<system-reminder>\\nsession-start-context\\n</system-reminder>",
    );
  },
);

test("fork SessionStart matches its source, while child prompts and completion notifications bypass UserPromptSubmit", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "submit.sh"), "cat >> submits.jsonl\necho >> submits.jsonl\n");
  await Bun.write(
    join(dirs.cwd, "start.sh"),
    "cat >> starts.jsonl\necho >> starts.jsonl\necho fork-project-state\n",
  );
  const childRelease = Promise.withResolvers<void>();
  const parentWaiting = Promise.withResolvers<void>();
  const reply: Parameters<typeof fakeModel>[0][number] = async (context) => {
    const isChild = !context.messages.some(
      (message) =>
        message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
    );
    if (isChild) {
      expect(JSON.stringify(context.messages)).toContain(
        "<system-reminder>\\nfork-project-state\\n</system-reminder>",
      );
      await childRelease.promise;
      return fauxAssistantMessage("child finished");
    }
    parentWaiting.resolve();
    return fauxAssistantMessage("parent finished");
  };
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent_fork", {
        description: "Fork",
        prompt: "child prompt",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    reply,
    reply,
    reply,
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "sh submit.sh" }] }],
        SessionStart: [{ matcher: "fork", hooks: [{ type: "command", command: "sh start.sh" }] }],
      },
    },
  });
  const run = session.run("parent prompt");
  await parentWaiting.promise;
  childRelease.resolve();
  expect((await run).text).toBe("parent finished");
  await session.waitForRequest(session.currentRequestId!);
  const starts = (await Bun.file(join(dirs.cwd, "starts.jsonl")).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(starts).toHaveLength(1);
  expect(starts[0]).toMatchObject({
    source: "fork",
    hook_event_name: "SessionStart",
    agent_id: expect.any(String),
    agent_type: "fork",
  });
  const submits = (await Bun.file(join(dirs.cwd, "submits.jsonl")).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(submits).toHaveLength(1);
  expect(submits[0]).toMatchObject({ prompt: "parent prompt", session_id: session.id });
  expect(session.messages.filter((message) => message.role === "user")).toHaveLength(2);
});

test("prompt context and plain stdout are persisted as reminders for each accepted prompt", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: `echo '{"hookSpecificOutput":{"additionalContext":"structured context"}}'`,
              },
              { type: "command", command: "echo branch-info" },
            ],
          },
        ],
      },
    },
  });
  await session.run("first");
  await session.run("second");
  for (const context of fake.contexts) {
    expect(JSON.stringify(context.messages)).toContain(
      "<system-reminder>\\nstructured context\\n</system-reminder>",
    );
    expect(JSON.stringify(context.messages)).toContain(
      "<system-reminder>\\nbranch-info\\n</system-reminder>",
    );
  }
  expect(
    session.messages.filter(
      (message) => message.role === "system-reminder" && message.source === "hook:UserPromptSubmit",
    ),
  ).toHaveLength(4);
});

test("SessionStart runs once during creation, matches startup/resume, and keeps context after a blocked prompt", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "start.sh"),
    `cat >> starts.jsonl\necho >> starts.jsonl\necho '{"hookSpecificOutput":{"additionalContext":"session state"},"systemMessage":"session notice"}'\n`,
  );
  await Bun.write(
    join(dirs.cwd, "submit.sh"),
    `cat > prompt-input.json\nif [ ! -e accepted ]; then touch accepted; echo blocked >&2; exit 2; fi\n`,
  );
  const settings = {
    hooks: {
      SessionStart: [
        {
          matcher: "startup|resume",
          hooks: [{ type: "command" as const, command: "sh start.sh" }],
        },
        { matcher: "fork", hooks: [{ type: "command" as const, command: "touch wrong-source" }] },
      ],
      UserPromptSubmit: [{ hooks: [{ type: "command" as const, command: "sh submit.sh" }] }],
    },
  };
  const fake = fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
  const session = await createSession({ ...dirs, ...fake, settings });
  const startupInput = JSON.parse((await Bun.file(join(dirs.cwd, "starts.jsonl")).text()).trim());
  expect(startupInput).toMatchObject({
    hook_event_name: "SessionStart",
    source: "startup",
    model: `${fake.model.provider}/${fake.model.id}`,
  });
  const events: SessionEvent[] = [];
  expect(
    (
      await session.run("blocked", {
        onEvent: (event) => {
          events.push(event);
        },
      })
    ).stopReason,
  ).toBe("hook_blocked");
  expect(session.messages).toContainEqual(
    expect.objectContaining({
      role: "session-notice",
      notice: { kind: "hook_message", message: "session notice" },
    }),
  );
  await session.run("accepted");
  await session.run("next");
  expect(
    session.messages.filter(
      (message) => message.role === "system-reminder" && message.source === "hook:SessionStart",
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(fake.contexts[0]!.messages)).toContain(
    "<system-reminder>\\nsession state\\n</system-reminder>",
  );
  await session.close();
  const resumedFake = fakeModel([fauxAssistantMessage("resumed")]);
  const resumed = await createSession({ ...dirs, ...resumedFake, settings, resumeId: session.id });
  await resumed.run("resume");
  const inputs = (await Bun.file(join(dirs.cwd, "starts.jsonl")).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(inputs.map((input) => input.source)).toEqual(["startup", "resume"]);
  expect(await Bun.file(join(dirs.cwd, "wrong-source")).exists()).toBe(false);
  await resumed.close();
});
