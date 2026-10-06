import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, type SessionEvent } from "../../src/index.ts";
import type { HookHandler } from "@neant/shared";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

async function scriptedHook(
  output: unknown,
  name = "hook.sh",
  exitCode = 0,
): Promise<Extract<HookHandler, { type: "command" }>> {
  await Bun.write(
    join(dirs.cwd, name),
    `cat > ${name}.input\nprintf '%s' '${JSON.stringify(output).replaceAll("'", "'\\''")}'\nexit ${exitCode}\n`,
  );
  return { type: "command", command: `sh ${name}` };
}

function toolModel(
  name = "bash",
  args = { description: "Run test command", command: "touch marker" },
) {
  return fakeModel([
    fauxAssistantMessage(fauxToolCall(name, args, { id: "call" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
}

test.each(["ask", "auto-review"] as const)(
  "hook allow skips mode %s but obeys rule restrictions",
  async (permissionMode) => {
    dirs = await tempDirs();
    const handler = await scriptedHook({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    });
    for (const restriction of [undefined, "deny", "ask"] as const) {
      const fake = toolModel();
      const events: SessionEvent[] = [];
      let asks = 0;
      const session = await createSession({
        ...dirs,
        ...fake,
        permissionMode,
        settings: {
          hooks: { PreToolUse: [{ hooks: [handler] }] },
          ...(restriction && { permissions: { [restriction]: ["bash"] } }),
        },
        onPermissionAsk: async () => {
          asks++;
          return "deny";
        },
      });
      await session.run("try", {
        onEvent: (event) => {
          events.push(event);
        },
      });
      expect(asks).toBe(restriction === "ask" ? 1 : 0);
      expect(events.some((event) => event.type === "permission_review")).toBe(false);
      expect(events.filter((event) => event.type === "permission_denied").length).toBe(
        restriction ? 1 : 0,
      );
    }
  },
);

test.each([false, true])(
  "hook ask overrides full-access and requires frontend permission: %s",
  async (frontend) => {
    dirs = await tempDirs();
    const fake = toolModel();
    const handler = await scriptedHook({
      hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "verify" },
    });
    let asks = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      settings: {
        hooks: { PreToolUse: [{ hooks: [handler] }] },
      },
      ...(frontend && {
        onPermissionAsk: async (request) => {
          asks++;
          expect(request.reason).toBe("verify");
          return "allow" as const;
        },
      }),
    });
    await session.run("try");
    expect(asks).toBe(frontend ? 1 : 0);
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(frontend);
  },
);

test("valid updatedInput changes executed arguments and rules inspect the changed input", async () => {
  dirs = await tempDirs();
  const handler = await scriptedHook({
    hookSpecificOutput: {
      permissionDecision: "allow",
      updatedInput: { description: "Run rewritten command", command: "printf changed > changed" },
    },
  });
  for (const denied of [false, true]) {
    const fake = toolModel();
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      settings: {
        hooks: { PreToolUse: [{ hooks: [handler] }] },
        ...(denied && { permissions: { deny: ["bash(printf changed*)"] } }),
      },
    });
    await session.run("try");
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
    const result = fake.contexts[1]!.messages.find((message) => message.role === "toolResult");
    if (denied)
      expect(result).toMatchObject({
        isError: true,
        content: [{ text: "Denied by permission rule: bash(printf changed*)" }],
      });
    else expect(await Bun.file(join(dirs.cwd, "changed")).text()).toBe("changed");
  }
});

test("invalid updatedInput denies execution and context is attached to its tool result", async () => {
  dirs = await tempDirs();
  const fake = toolModel();
  const handler = await scriptedHook({
    hookSpecificOutput: {
      updatedInput: { description: "Run rewritten command", command: 3 },
      additionalContext: "x".repeat(10_001),
    },
  });
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { hooks: { PreToolUse: [{ hooks: [handler] }] } },
  });
  const events: SessionEvent[] = [];
  await session.run("try", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
  expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
    { by: "hook" },
  ]);
  const result = fake.contexts[1]!.messages.find((message) => message.role === "toolResult");
  expect(result).toMatchObject({ isError: true });
  expect(JSON.stringify(result)).toContain("invalid updatedInput");
  expect(JSON.stringify(result)).toContain("<system-reminder>");
  expect(JSON.stringify(result)).toContain("[truncated]");
  expect(JSON.stringify(result)).not.toContain("x".repeat(10_001));
});

test("command hooks read the protocol and deny tools before execution", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "hook.sh"),
    'cat > input.json\nprintf "%s" "$NEANT_PROJECT_DIR" > project-root\necho protected >&2\nexit 2\n',
  );
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall(
        "bash",
        { description: "Run test command", command: "touch marker" },
        { id: "call" },
      ),
      {
        stopReason: "toolUse",
      },
    ),
    fauxAssistantMessage("done"),
  ]);
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        PreToolUse: [{ matcher: "bash", hooks: [{ type: "command", command: "sh hook.sh" }] }],
      },
    },
  });
  await session.run("try", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
  expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
    { by: "hook", toolCallId: "call" },
  ]);
  expect(
    fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
  ).toMatchObject([
    { isError: true, content: [{ type: "text", text: "Denied by hook: protected" }] },
  ]);
  const input = await Bun.file(join(dirs.cwd, "input.json")).json();
  expect(input).toMatchObject({
    session_id: session.id,
    cwd: dirs.cwd,
    permission_mode: "full-access",
    hook_event_name: "PreToolUse",
    tool_name: "bash",
    tool_input: { command: "touch marker" },
    tool_use_id: "call",
  });
  expect(isAbsolute(input.transcript_path)).toBe(true);
  expect(await Bun.file(input.transcript_path).exists()).toBe(true);
  expect(await Bun.file(join(dirs.cwd, "project-root")).text()).toBe(dirs.cwd);
});

test.each([undefined, "", "*", "bash", "read|bash", "read,bash", "ash", "a.*", "write"])(
  "matcher %j selects exact names, lists, or unanchored regex",
  async (matcher) => {
    dirs = await tempDirs();
    const fake = toolModel();
    const handler = await scriptedHook({ hookSpecificOutput: { permissionDecision: "deny" } });
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      settings: {
        hooks: { PreToolUse: [{ matcher, hooks: [handler] }] },
      },
    });
    await session.run("try");
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(
      matcher === "ash" || matcher === "write",
    );
  },
);

test.each([
  ["bad-json", "echo '{bad}'", undefined],
  ["exit", "echo broken >&2; exit 1", undefined],
  ["crash", "kill -KILL $$", undefined],
  [
    "timeout",
    'echo \'{"hookSpecificOutput":{"permissionDecision":"deny"}}\'; sleep 1; touch late-marker',
    0.03,
  ],
] as const)(
  "%s warns through events and onWarning, then fails open",
  async (_name, command, timeout) => {
    dirs = await tempDirs();
    const fake = toolModel();
    const warnings: string[] = [];
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      onWarning: (warning) => {
        warnings.push(warning);
      },
      settings: { hooks: { PreToolUse: [{ hooks: [{ type: "command", command, timeout }] }] } },
    });
    await session.run("try", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(true);
    expect(await Bun.file(join(dirs.cwd, "late-marker")).exists()).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
      { event: "PreToolUse", hook: command, message: expect.any(String) },
    ]);
  },
);

test("nonzero exit still applies valid JSON decisions and exit 2 keeps blocking with malformed JSON", async () => {
  dirs = await tempDirs();
  for (const exitCode of [1, 2]) {
    const fake = toolModel();
    const warnings: string[] = [];
    const handler =
      exitCode === 1
        ? await scriptedHook(
            {
              hookSpecificOutput: {
                permissionDecision: "deny",
                permissionDecisionReason: "json decision",
              },
            },
            "hook.sh",
            1,
          )
        : { type: "command" as const, command: "echo '{bad}'; echo stderr-reason >&2; exit 2" };
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      onWarning: (warning) => {
        warnings.push(warning);
      },
      settings: { hooks: { PreToolUse: [{ hooks: [handler] }] } },
    });
    await session.run("try");
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(fake.contexts[1]!.messages)).toContain(
      exitCode === 1 ? "json decision" : "stderr-reason",
    );
  }
});

test("multiple hooks read original input and combine the strictest decisions and all deny reasons", async () => {
  dirs = await tempDirs();
  const handlers = await Promise.all([
    scriptedHook(
      {
        hookSpecificOutput: {
          permissionDecision: "allow",
          updatedInput: { description: "Run rewritten command", command: "touch changed" },
        },
      },
      "allow.sh",
    ),
    scriptedHook({ hookSpecificOutput: { permissionDecision: "ask" } }, "ask.sh"),
    scriptedHook(
      {
        hookSpecificOutput: {
          permissionDecision: "deny",
          permissionDecisionReason: "first-denial",
          additionalContext: "first context",
        },
      },
      "deny-one.sh",
    ),
    scriptedHook(
      {
        hookSpecificOutput: {
          permissionDecision: "deny",
          permissionDecisionReason: "second-denial",
          additionalContext: "second context",
        },
      },
      "deny-two.sh",
    ),
  ]);
  const fake = toolModel();
  let asks = 0;
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { hooks: { PreToolUse: [{ hooks: handlers }] } },
    onPermissionAsk: async () => {
      asks++;
      return "allow";
    },
  });
  await session.run("try");
  expect(asks).toBe(0);
  expect(await Bun.file(join(dirs.cwd, "changed")).exists()).toBe(false);
  for (const file of ["allow.sh", "ask.sh", "deny-one.sh", "deny-two.sh"]) {
    expect((await Bun.file(join(dirs.cwd, `${file}.input`)).json()).tool_input).toEqual({
      description: "Run test command",
      command: "touch marker",
    });
  }
  const messages = JSON.stringify(fake.contexts[1]!.messages);
  for (const text of ["first-denial", "second-denial", "first context", "second context"])
    expect(messages).toContain(text);
});

test("args executes directly and successful tools receive additionalContext", async () => {
  dirs = await tempDirs();
  const handler = await scriptedHook({
    hookSpecificOutput: { additionalContext: "check your work" },
  });
  const fake = toolModel();
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: { PreToolUse: [{ hooks: [{ ...handler, command: "sh", args: ["hook.sh"] }] }] },
    },
  });
  await session.run("try");
  expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(true);
  expect(JSON.stringify(fake.contexts[1]!.messages)).toContain(
    "<system-reminder>\\ncheck your work",
  );
});

test("continue false ends the run before followup and reports stopReason and systemMessage", async () => {
  dirs = await tempDirs();
  const handler = await scriptedHook({
    continue: false,
    stopReason: "stop now",
    systemMessage: "notice",
    hookSpecificOutput: { permissionDecision: "allow" },
  });
  const fake = toolModel();
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { hooks: { PreToolUse: [{ hooks: [handler] }] } },
  });
  const result = await session.run("try", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(result).toMatchObject({ stopReason: "hook_stopped", reason: "stop now" });
  expect(fake.contexts).toHaveLength(1);
  expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
  expect(events.filter((event) => event.type === "hook_message")).toMatchObject([
    { message: "notice" },
  ]);
});

test("a stopping hook also prevents sibling tools in the same batch", async () => {
  dirs = await tempDirs();
  const handler = await scriptedHook({ continue: false, stopReason: "halt" });
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("bash", { description: "Run test command", command: "touch marker" }),
        fauxToolCall("write", { path: "sibling", content: "must not write" }),
      ],
      { stopReason: "toolUse" },
    ),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { hooks: { PreToolUse: [{ matcher: "bash", hooks: [handler] }] } },
  });
  await session.run("try");
  expect(await Bun.file(join(dirs.cwd, "sibling")).exists()).toBe(false);
});

test("inherited hooks see child identity and deny subagent tools", async () => {
  dirs = await tempDirs();
  const handler = await scriptedHook({
    hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "child guard" },
  });
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", { description: "child", prompt: "try", run_in_background: false }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("bash", { description: "Run test command", command: "touch child-marker" }),
      {
        stopReason: "toolUse",
      },
    ),
    fauxAssistantMessage("child done"),
    fauxAssistantMessage("parent done"),
  ]);
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { hooks: { PreToolUse: [{ matcher: "bash", hooks: [handler] }] } },
  });
  await session.run("delegate", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  const input = await Bun.file(join(dirs.cwd, "hook.sh.input")).json();
  expect(input.agent_id).toBe(input.session_id);
  expect(input.agent_id).not.toBe(session.id);
  expect(input.agent_type).toBe("general-purpose");
  expect(
    events.some(
      (event) =>
        event.type === "subagent_event" &&
        event.event.type === "permission_denied" &&
        event.event.by === "hook",
    ),
  ).toBe(true);
  expect(await Bun.file(join(dirs.cwd, "child-marker")).exists()).toBe(false);
});

test("MCP and skill tools pass through PreToolUse hooks", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, ".neant/skills/review/SKILL.md"),
    "---\nname: review\ndescription: Review\n---\nSensitive instructions",
  );
  await Bun.write(join(dirs.homeDir, "manifest.json"), JSON.stringify({ tools: ["echo"] }));
  await Bun.write(
    join(dirs.homeDir, ".neant/mcp.json"),
    JSON.stringify({
      mcpServers: {
        local: {
          command: process.execPath,
          args: [fileURLToPath(new URL("../helpers/mcp-server.ts", import.meta.url))],
          env: {
            MCP_MANIFEST: join(dirs.homeDir, "manifest.json"),
            MCP_CALLS: join(dirs.homeDir, "calls"),
            MCP_PIDS: join(dirs.homeDir, "pids"),
          },
        },
      },
    }),
  );
  const handler = await scriptedHook({ hookSpecificOutput: { permissionDecision: "deny" } });
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("skill", { name: "review" }),
        fauxToolCall("mcp__local__echo", { text: "blocked" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { hooks: { PreToolUse: [{ hooks: [handler] }] } },
  });
  await session.run("try", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
    { by: "hook", toolName: "skill" },
    { by: "hook", toolName: "mcp__local__echo" },
  ]);
  expect(JSON.stringify(fake.contexts[1]!.messages)).not.toContain("Sensitive instructions");
  expect(await Bun.file(join(dirs.homeDir, "calls")).exists()).toBe(false);
});

test("matching duplicate handlers across wildcard and exact groups execute only once", async () => {
  dirs = await tempDirs();
  const handler = { type: "command" as const, command: "echo ran >> count" };
  const fake = toolModel();
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        PreToolUse: [
          { hooks: [handler] },
          { matcher: "*", hooks: [handler] },
          { matcher: "", hooks: [handler] },
          { matcher: "bash", hooks: [handler] },
        ],
      },
    },
  });
  await session.run("try");
  expect(await Bun.file(join(dirs.cwd, "count")).text()).toBe("ran\n");
});

test("a child session grant cannot approve a parent's pending hook ask", async () => {
  dirs = await tempDirs();
  const handler = await scriptedHook({ hookSpecificOutput: { permissionDecision: "ask" } });
  const parentAsked = Promise.withResolvers<void>();
  const parentReply = Promise.withResolvers<"deny">();
  let parentSignal: AbortSignal | undefined;
  let wasAutoApproved = false;
  let parentCalls = 0;
  let childCalls = 0;
  const response: Parameters<typeof fakeModel>[0][number] = async (context) => {
    const parent = context.messages.some(
      (message) =>
        message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
    );
    if (parent)
      return parentCalls++ === 0
        ? fauxAssistantMessage(
            fauxToolCall("bash", { description: "Run test command", command: "printf shared" }),
            {
              stopReason: "toolUse",
            },
          )
        : fauxAssistantMessage("parent done");
    if (childCalls++ === 0) {
      await parentAsked.promise;
      return fauxAssistantMessage(
        fauxToolCall("bash", { description: "Run test command", command: "printf shared" }),
        {
          stopReason: "toolUse",
        },
      );
    }
    wasAutoApproved = parentSignal!.aborted;
    parentReply.resolve("deny");
    return fauxAssistantMessage("child done");
  };
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("subagent", { description: "child", prompt: "child" }), {
      stopReason: "toolUse",
    }),
    ...Array.from({ length: 8 }, () => response),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { hooks: { PreToolUse: [{ matcher: "bash", hooks: [handler] }] } },
    onPermissionAsk: async (request) => {
      if (request.origin) return "allow-session";
      parentSignal = request.signal;
      parentAsked.resolve();
      return parentReply.promise;
    },
  });
  await session.run("try");
  expect(wasAutoApproved).toBe(false);
  const parentToolResults = fake.contexts
    .filter((context) =>
      context.messages.some(
        (message) =>
          message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
      ),
    )
    .at(-1)!.messages;
  expect(
    parentToolResults.filter(
      (message) => message.role === "toolResult" && message.toolName === "bash",
    ),
  ).toMatchObject([{ isError: true }]);
});

test.each([
  { permissionDecision: "DENY" },
  { permissionDecision: ["deny"] },
  { permissionDecision: null },
  { permissionDecision: 3 },
])("ignored invalid hook output %j warns and fails open", async ({ permissionDecision }) => {
  dirs = await tempDirs();
  const handler = await scriptedHook({
    unknownField: true,
    hookSpecificOutput: { permissionDecision, additionalContext: 3 },
  });
  const warnings: string[] = [];
  const events: SessionEvent[] = [];
  const fake = toolModel();
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { hooks: { PreToolUse: [{ hooks: [handler] }] } },
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });
  await session.run("try", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(true);
  expect(warnings).toHaveLength(3);
  expect(events.filter((event) => event.type === "hook_warning")).toHaveLength(3);
});
