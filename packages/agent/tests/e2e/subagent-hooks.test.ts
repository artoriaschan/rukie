import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("SubagentStart continue:false ends only the child run without storing its prompt; an idle wakeup can run", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "halt-start.sh"),
    `cat > start.json\nif [ ! -f halted ]; then touch halted; echo '{"continue":false,"stopReason":"halt child","decision":"block"}'; fi\n`,
  );
  let parentCalls = 0;
  let childCalls = 0;
  let childId = "";
  const reply: Parameters<typeof fakeModel>[0][number] = (context) => {
    const parent = context.messages.some(
      (message) =>
        message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
    );
    if (!parent) {
      childCalls++;
      expect(JSON.stringify(context.messages)).not.toContain("blocked child prompt");
      expect(JSON.stringify(context.messages.at(-1))).toContain("wake child");
      return fauxAssistantMessage("child awake");
    }
    if (++parentCalls === 1)
      return fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Inspect",
          prompt: "blocked child prompt",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      );
    if (parentCalls === 3)
      return fauxAssistantMessage(
        fauxToolCall("send_message", { agent_id: childId, message: "wake child" }),
        { stopReason: "toolUse" },
      );
    return fauxAssistantMessage("parent complete");
  };
  const fake = fakeModel(Array.from({ length: 12 }, () => reply));
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning() {},
    settings: {
      hooks: { SubagentStart: [{ hooks: [{ type: "command", command: "sh halt-start.sh" }] }] },
    },
  });
  expect(
    await session.run("delegate", {
      onEvent(event) {
        events.push(event);
        if (event.type === "subagent_event") childId = event.agentId;
      },
    }),
  ).toMatchObject({ success: true, text: "parent complete" });
  expect(childCalls).toBe(0);
  expect(
    events.filter((event) => event.type === "subagent_event" && event.event.type === "result"),
  ).toMatchObject([{ event: { success: true, stopReason: "hook_stopped", reason: "halt child" } }]);
  const input = await Bun.file(join(dirs.cwd, "start.json")).json();
  expect(await Bun.file(input.transcript_path).text()).not.toContain("blocked child prompt");
  expect(await session.run("wake")).toMatchObject({ success: true, text: "parent complete" });
  expect(childCalls).toBe(1);
});

test.each([false, true])(
  "project type hooks require session trust and work without parent hooks: %s",
  async (trusted) => {
    dirs = await tempDirs();
    const path = join(dirs.cwd, ".agents/agents/custom.md");
    await Bun.write(
      path,
      `---\n${JSON.stringify({
        name: "custom",
        description: "Custom",
        hooks: {
          SubagentStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: `echo '{"hookSpecificOutput":{"additionalContext":"trusted child context"}}'`,
                },
              ],
            },
          ],
          PreToolUse: [
            {
              matcher: "todo_write",
              hooks: [
                {
                  type: "command",
                  command: `echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"type check"}}'`,
                },
              ],
            },
          ],
        },
      })}\n---\nProject body`,
    );
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          subagent_type: "custom",
          description: "Custom",
          prompt: "child",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall("todo_write", { todos: [] }), { stopReason: "toolUse" }),
      (context) => {
        expect(context.messages.at(-1)).toMatchObject({ role: "toolResult", isError: trusted });
        return fauxAssistantMessage("child done");
      },
      fauxAssistantMessage("parent done"),
    ]);
    const warnings: string[] = [];
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: { trustedProjects: trusted ? [dirs.cwd] : [] },
      onWarning(warning) {
        warnings.push(warning);
      },
    });
    expect(
      await session.run("delegate", {
        onEvent(event) {
          events.push(event);
        },
      }),
    ).toMatchObject({ success: true, text: "parent done" });
    expect(JSON.stringify(fake.contexts[1]!.messages)).toContain("Project body");
    expect(JSON.stringify(fake.contexts[1]!.messages).includes("trusted child context")).toBe(
      trusted,
    );
    expect(warnings).toHaveLength(trusted ? 0 : 1);
    const hookWarnings = events.filter((event) => event.type === "hook_warning");
    if (trusted) expect(hookWarnings).toEqual([]);
    else
      expect(hookWarnings).toMatchObject([
        { error: { code: "hook-project-untrusted", params: { source: path } } },
      ]);
  },
);

async function inputs(filename: string) {
  return (await Bun.file(join(dirs.cwd, filename)).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

test("SubagentStart matches the type on each child run, including idle send_message wakeups, and cannot block", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "start.sh"),
    `cat >> starts.jsonl\necho >> starts.jsonl\necho '{"decision":"block","hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"child instructions"}}'\nexit 2\n`,
  );
  let childId = "";
  const reply: Parameters<typeof fakeModel>[0][number] = (context) => {
    const parent = context.messages.some(
      (message) =>
        message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
    );
    return fauxAssistantMessage(parent ? "parent complete" : "second child conclusion");
  };
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Explore",
        prompt: "first child prompt",
        subagent_type: "explore",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("first child conclusion"),
    () => {
      return fauxAssistantMessage(
        fauxToolCall("send_message", { agent_id: childId, message: "wake child" }),
        { stopReason: "toolUse" },
      );
    },
    ...Array.from({ length: 8 }, () => reply),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        SubagentStart: [
          {
            matcher: "general-purpose",
            hooks: [{ type: "command", command: "cat > unexpected-start" }],
          },
          { matcher: "explore", hooks: [{ type: "command", command: "sh start.sh" }] },
        ],
      },
    },
  });
  await session.run("delegate", {
    onEvent(event) {
      if (event.type === "subagent_event") childId = event.agentId;
    },
  });
  const childContexts = fake.contexts.filter(
    (context) =>
      !context.messages.some(
        (message) =>
          message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
      ),
  );
  expect(childContexts).toHaveLength(2);
  for (const context of childContexts)
    expect(JSON.stringify(context.messages.at(-1))).toContain("child instructions");
  expect(await inputs("starts.jsonl")).toMatchObject([
    {
      agent_id: childId,
      agent_type: "explore",
      session_id: childId,
      hook_event_name: "SubagentStart",
    },
    {
      agent_id: childId,
      agent_type: "explore",
      session_id: childId,
      hook_event_name: "SubagentStart",
    },
  ]);
  expect(await Bun.file(join(dirs.cwd, "unexpected-start")).exists()).toBe(false);
});

test("SubagentStop ignores the ninth block, persists feedback, and resets the budget for an idle child wakeup", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "stop.sh"),
    `cat >> stops.jsonl\necho >> stops.jsonl\necho '{"decision":"block","reason":"keep checking"}'\n`,
  );
  const warnings: string[] = [];
  let childId = "";
  const childReply: Parameters<typeof fakeModel>[0][number] = (context) => {
    const parent = context.messages.some(
      (message) =>
        message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
    );
    return fauxAssistantMessage(parent ? "parent complete" : "child conclusion");
  };
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Inspect",
        prompt: "child",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    ...Array.from({ length: 9 }, () => fauxAssistantMessage("child conclusion")),
    fauxAssistantMessage("parent complete"),
    () =>
      fauxAssistantMessage(
        fauxToolCall("send_message", { agent_id: childId, message: "wake child" }),
        { stopReason: "toolUse" },
      ),
    ...Array.from({ length: 15 }, () => childReply),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning(warning) {
      warnings.push(warning);
    },
    settings: {
      hooks: { SubagentStop: [{ hooks: [{ type: "command", command: "sh stop.sh" }] }] },
    },
  });
  for (const prompt of ["delegate", "wake"]) {
    const events: SessionEvent[] = [];
    expect(
      await session.run(prompt, {
        onEvent(event) {
          events.push(event);
          if (event.type === "subagent_event") childId = event.agentId;
        },
      }),
    ).toMatchObject({ success: true, text: "parent complete" });
    const childEvents = events.flatMap((event) =>
      event.type === "subagent_event" ? [event.event] : [],
    );
    expect(childEvents.filter((event) => event.type === "hook_continued")).toHaveLength(8);
    expect(childEvents.filter((event) => event.type === "hook_warning")).toMatchObject([
      {
        event: "SubagentStop",
        error: { code: "hook-continuation-limit", params: { event: "SubagentStop", limit: "8" } },
      },
    ]);
    expect(childEvents.filter((event) => event.type === "result")).toHaveLength(1);
  }
  const recorded = await inputs("stops.jsonl");
  expect(recorded).toHaveLength(18);
  expect(recorded.map((input) => input.stop_hook_active)).toEqual([
    false,
    ...Array(8).fill(true),
    false,
    ...Array(8).fill(true),
  ]);
  expect(warnings).toHaveLength(2);
  const transcript = await Bun.file(recorded[0].agent_transcript_path).text();
  expect(transcript.match(/"source"\s*:\s*"stop_hook"/g)).toHaveLength(16);
});

test("parent cancellation during SubagentStop feedback prevents another child model call and completion notification", async () => {
  dirs = await tempDirs();
  const reply: Parameters<typeof fakeModel>[0][number] = (context) =>
    fauxAssistantMessage(
      context.messages.some(
        (message) =>
          message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
      )
        ? "parent waiting"
        : "child conclusion",
    );
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("subagent", { description: "Inspect", prompt: "child" }), {
      stopReason: "toolUse",
    }),
    reply,
    reply,
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        SubagentStop: [
          {
            hooks: [{ type: "command", command: `echo '{"decision":"block","reason":"verify"}'` }],
          },
        ],
      },
    },
  });
  const controller = new AbortController();
  await expect(
    session.run("delegate", {
      signal: controller.signal,
      onEvent(event) {
        if (event.type === "subagent_event" && event.event.type === "hook_continued")
          controller.abort(new Error("cancel child feedback"));
      },
    }),
  ).rejects.toThrow("cancel child feedback");
  expect(
    fake.contexts.filter(
      (context) =>
        !context.messages.some(
          (message) =>
            message.role === "system" &&
            message.toolsAdded?.some((tool) => tool.name === "subagent"),
        ),
    ),
  ).toHaveLength(1);
  expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
});

test("type frontmatter hooks add to inherited hooks only in that child; tool hooks include child identity", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.homeDir, ".rukie/agents/custom.md"),
    `---\n${JSON.stringify({
      name: "custom",
      description: "Custom",
      hooks: {
        SubagentStart: [
          {
            matcher: "custom",
            hooks: [
              {
                type: "command",
                command: `echo '{"hookSpecificOutput":{"additionalContext":"custom child context"}}'`,
              },
            ],
          },
        ],
        Stop: [
          {
            matcher: "custom",
            hooks: [
              {
                type: "command",
                command: "cat >> type-stops.jsonl; echo >> type-stops.jsonl; echo '{}'",
              },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: "todo_write",
            hooks: [
              {
                type: "command",
                command: "cat >> type-tools.jsonl; echo >> type-tools.jsonl; echo '{}'",
              },
            ],
          },
        ],
      },
    })}\n---\nCustom prompt`,
  );
  const delegate = (subagent_type: string) =>
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: subagent_type,
        prompt: "child prompt",
        subagent_type,
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    );
  const childTool = () =>
    fauxAssistantMessage(fauxToolCall("todo_write", { todos: [] }), { stopReason: "toolUse" });
  const fake = fakeModel([
    delegate("custom"),
    childTool(),
    fauxAssistantMessage("custom child done"),
    delegate("general-purpose"),
    childTool(),
    fauxAssistantMessage("other child done"),
    fauxAssistantMessage("parent done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        PreToolUse: [
          {
            matcher: "todo_write",
            hooks: [
              {
                type: "command",
                command: "cat >> inherited-tools.jsonl; echo >> inherited-tools.jsonl; echo '{}'",
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: "cat >> parent-stops.jsonl; echo >> parent-stops.jsonl; echo '{}'",
              },
            ],
          },
        ],
      },
    },
  });
  expect(await session.run("delegate")).toMatchObject({ success: true, text: "parent done" });
  expect(JSON.stringify(fake.contexts[1]!.messages.at(-1))).toContain("custom child context");
  expect(JSON.stringify(fake.contexts[4]!.messages)).not.toContain("custom child context");
  const inherited = await inputs("inherited-tools.jsonl");
  const own = await inputs("type-tools.jsonl");
  expect(inherited).toHaveLength(2);
  expect(own).toHaveLength(1);
  expect(own[0]).toMatchObject({
    hook_event_name: "PreToolUse",
    agent_type: "custom",
    agent_id: inherited[0].agent_id,
    session_id: inherited[0].agent_id,
    tool_name: "todo_write",
  });
  expect(inherited[1]).toMatchObject({
    agent_type: "general-purpose",
    agent_id: expect.any(String),
  });
  expect(await inputs("type-stops.jsonl")).toMatchObject([
    { hook_event_name: "SubagentStop", agent_type: "custom", agent_id: own[0].agent_id },
  ]);
  const parentStops = await inputs("parent-stops.jsonl");
  expect(parentStops).toHaveLength(1);
  expect(parentStops[0]).toMatchObject({ session_id: session.id, hook_event_name: "Stop" });
  expect(parentStops[0].agent_id).toBeUndefined();
});

test.each([0, 2])(
  "SubagentStop continues the child before the parent receives its final notification (exit %s)",
  async (exitCode) => {
    dirs = await tempDirs();
    await Bun.write(
      join(dirs.cwd, "stop.sh"),
      `cat >> stops.jsonl\necho >> stops.jsonl\nif [ ! -f checked ]; then\n touch checked\n ${exitCode === 2 ? "echo child-review >&2" : `echo '{"decision":"block","reason":"child-review"}'`}\n exit ${exitCode}\nfi\necho '{}'\n`,
    );
    const events: SessionEvent[] = [];
    const childReady = Promise.withResolvers<void>();
    const parentWaiting = Promise.withResolvers<void>();
    const releaseChild = Promise.withResolvers<void>();
    let childCalls = 0;
    const reply: Parameters<typeof fakeModel>[0][number] = async (context) => {
      const parent = context.messages.some(
        (message) =>
          message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
      );
      if (!parent) {
        childCalls++;
        if (childCalls === 1) {
          childReady.resolve();
          await releaseChild.promise;
          return fauxAssistantMessage("unchecked conclusion");
        }
        expect(context.messages.at(-1)).toMatchObject({
          role: "user",
          content: [{ text: "child-review" }],
        });
        return fauxAssistantMessage("verified child conclusion");
      }
      if (context.messages.at(-1)?.role === "user") {
        expect(JSON.stringify(context.messages.at(-1))).toContain("verified child conclusion");
        expect(JSON.stringify(context.messages.at(-1))).not.toContain("unchecked conclusion");
        return fauxAssistantMessage("parent complete");
      }
      return fauxAssistantMessage("parent waiting");
    };
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("subagent", { description: "Inspect", prompt: "child" }), {
        stopReason: "toolUse",
      }),
      ...Array.from({ length: 8 }, () => reply),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        hooks: {
          SubagentStop: [
            { matcher: "explore", hooks: [{ type: "command", command: "cat > unexpected-stop" }] },
            { matcher: "general-purpose", hooks: [{ type: "command", command: "sh stop.sh" }] },
          ],
        },
      },
    });
    const run = session.run("delegate", {
      onEvent(event) {
        events.push(event);
        if (event.type === "subagents_waiting") parentWaiting.resolve();
      },
    });
    await Promise.all([childReady.promise, parentWaiting.promise]);
    releaseChild.resolve();
    expect(await run).toMatchObject({ success: true, text: "parent complete" });
    const continued = events.filter(
      (event) => event.type === "subagent_event" && event.event.type === "hook_continued",
    );
    expect(continued).toMatchObject([{ event: { event: "SubagentStop", reason: "child-review" } }]);
    const childId = continued[0]?.type === "subagent_event" ? continued[0].agentId : "";
    const recorded = await inputs("stops.jsonl");
    expect(recorded).toHaveLength(2);
    expect(recorded).toMatchObject([
      {
        agent_id: childId,
        agent_type: "general-purpose",
        session_id: childId,
        hook_event_name: "SubagentStop",
        stop_hook_active: false,
        last_assistant_message: "unchecked conclusion",
      },
      {
        agent_id: childId,
        stop_hook_active: true,
        last_assistant_message: "verified child conclusion",
      },
    ]);
    expect(recorded[0].agent_transcript_path).toBe(recorded[0].transcript_path);
    expect(recorded[0].agent_transcript_path).toMatch(/\.jsonl$/);
    expect(await Bun.file(join(dirs.cwd, "unexpected-stop")).exists()).toBe(false);
  },
);
