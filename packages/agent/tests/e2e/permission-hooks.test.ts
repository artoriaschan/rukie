import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession, type SessionEvent } from "../../src/index.ts";
import type { HookEvent, HookHandler } from "@neant/shared";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

async function script(event: HookEvent, output: unknown, exitCode = 0): Promise<HookHandler> {
  const name = `${event}.sh`;
  await Bun.write(
    join(dirs.cwd, name),
    `cat >> ${event}.input\nprintf '%s' '${JSON.stringify(output).replaceAll("'", "'\\''")}'\nexit ${exitCode}\n`,
  );
  return { type: "command", command: `sh ${name}` };
}
function toolModel() {
  return fakeModel([
    fauxAssistantMessage(fauxToolCall("bash", { command: "touch marker" }, { id: "call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
}

test("headless PermissionRequest can answer allow and receives the proposed session rule", async () => {
  dirs = await tempDirs();
  const handler = await script("PermissionRequest", {
    hookSpecificOutput: { decision: { behavior: "allow" } },
  });
  const fake = toolModel();
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "ask",
    settings: { hooks: { PermissionRequest: [{ hooks: [handler] }] } },
  });
  await session.run("try");
  expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(true);
  expect(await Bun.file(join(dirs.cwd, "PermissionRequest.input")).json()).toMatchObject({
    hook_event_name: "PermissionRequest",
    tool_name: "bash",
    tool_input: { command: "touch marker" },
    permission_suggestions: [
      {
        type: "addRules",
        destination: "session",
        behavior: "allow",
        rules: ["bash(touch marker)"],
      },
    ],
  });
});

test.each(["deny", "ask", "none"] as const)(
  "PermissionRequest rewritten input remains subject to rule %s",
  async (restriction) => {
    dirs = await tempDirs();
    const handler = await script("PermissionRequest", {
      hookSpecificOutput: {
        decision: { behavior: "allow", updatedInput: { command: "touch rewritten" } },
      },
    });
    const fake = toolModel();
    let asks = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "ask",
      settings: {
        hooks: { PermissionRequest: [{ hooks: [handler] }] },
        ...(restriction !== "none" && {
          permissions: { [restriction]: ["bash(touch rewritten)"] },
        }),
      },
      onPermissionAsk: async (request) => {
        asks++;
        expect(request.args).toEqual({ command: "touch rewritten" });
        return "allow";
      },
    });
    await session.run("try");
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
    expect(await Bun.file(join(dirs.cwd, "rewritten")).exists()).toBe(restriction !== "deny");
    expect(asks).toBe(restriction === "ask" ? 1 : 0);
  },
);

test("invalid PermissionRequest rewritten input denies without running the tool", async () => {
  dirs = await tempDirs();
  const handler = await script("PermissionRequest", {
    hookSpecificOutput: { decision: { behavior: "allow", updatedInput: { command: 2 } } },
  });
  const fake = toolModel();
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: { hooks: { PermissionRequest: [{ hooks: [handler] }] } },
  });
  await session.run("try");
  expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
  expect(JSON.stringify(fake.contexts[1]!.messages)).toContain("invalid updatedInput");
});

test("PermissionRequest session allow rules cover later calls without persisting settings", async () => {
  dirs = await tempDirs();
  const handler = await script("PermissionRequest", {
    hookSpecificOutput: {
      decision: {
        behavior: "allow",
        updatedPermissions: [
          { type: "addRules", destination: "session", behavior: "allow", rules: ["bash(touch *)"] },
        ],
      },
    },
  });
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("bash", { command: "touch first" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("bash", { command: "touch second" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: { hooks: { PermissionRequest: [{ hooks: [handler] }] } },
  });
  await session.run("try");
  expect(await Bun.file(join(dirs.cwd, "first")).exists()).toBe(true);
  expect(await Bun.file(join(dirs.cwd, "second")).exists()).toBe(true);
  // The script would append a second JSON object if the second call still asked.
  expect(await Bun.file(join(dirs.cwd, "PermissionRequest.input")).json()).toMatchObject({
    tool_input: { command: "touch first" },
  });
  expect(await Bun.file(join(dirs.homeDir, ".neant/settings.json")).exists()).toBe(false);
});

test("non-session and unsupported permission updates warn without changing mode or settings", async () => {
  dirs = await tempDirs();
  const handler = await script("PermissionRequest", {
    hookSpecificOutput: {
      decision: {
        behavior: "allow",
        updatedPermissions: [
          { type: "addRules", destination: "userSettings", behavior: "allow", rules: ["bash"] },
          { type: "setMode", destination: "projectSettings", mode: "full-access" },
          { type: "addRules", destination: "session", behavior: "deny", rules: ["bash"] },
          { type: "setMode", destination: "session", mode: "unknown" },
          { type: "addRules", destination: "session", behavior: "allow", rules: ["bash("] },
          { type: "replaceRules", destination: "session", rules: [] },
        ],
      },
    },
  });
  const fake = toolModel();
  const events: SessionEvent[] = [];
  const warnings: string[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning: (warning) => {
      warnings.push(warning);
    },
    settings: { hooks: { PermissionRequest: [{ hooks: [handler] }] } },
  });
  await session.run("try", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(true);
  expect(session.permissionMode).toBe("ask");
  expect(warnings).toHaveLength(6);
  expect(events.filter((event) => event.type === "hook_warning")).toHaveLength(6);
  expect(await Bun.file(join(dirs.homeDir, ".neant/settings.json")).exists()).toBe(false);
});

test("child PermissionRequest session setMode changes the parent's shared permission mode", async () => {
  dirs = await tempDirs();
  const handler = await script("PermissionRequest", {
    hookSpecificOutput: {
      decision: {
        behavior: "allow",
        updatedPermissions: [{ type: "setMode", destination: "session", mode: "full-access" }],
      },
    },
  });
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", { description: "child", prompt: "try", run_in_background: false }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("bash", { command: "touch child-marker" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("child done"),
    fauxAssistantMessage(fauxToolCall("bash", { command: "touch parent-marker" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("parent done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: { hooks: { PermissionRequest: [{ matcher: "bash", hooks: [handler] }] } },
  });
  await session.run("delegate");
  expect(session.permissionMode).toBe("full-access");
  expect(await Bun.file(join(dirs.cwd, "child-marker")).exists()).toBe(true);
  expect(await Bun.file(join(dirs.cwd, "parent-marker")).exists()).toBe(true);
  expect(await Bun.file(join(dirs.cwd, "PermissionRequest.input")).json()).toMatchObject({
    agent_type: "general-purpose",
    tool_input: { command: "touch child-marker" },
  });
});

test.each(["rule", "hook", "mode", "review"] as const)(
  "PermissionRequest runs before frontend interaction for %s asks",
  async (source) => {
    dirs = await tempDirs();
    const request = await script("PermissionRequest", {
      hookSpecificOutput: { decision: { behavior: "deny", message: "request refused" } },
    });
    const pre = await script("PreToolUse", { hookSpecificOutput: { permissionDecision: "ask" } });
    const fake = toolModel();
    if (source === "review") {
      const main = fake.streamFn;
      fake.streamFn = (model, context, options) =>
        JSON.stringify(context).includes("REVIEW_POLICY")
          ? fakeModel([fauxAssistantMessage('{"risk":"high","decision":"deny"}')]).streamFn(
              model,
              context,
              options,
            )
          : main(model, context, options);
    }
    let asks = 0;
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode:
        source === "review" ? "auto-review" : source === "hook" ? "full-access" : "ask",
      settings: {
        ...(source === "rule" && { permissions: { ask: ["bash"] } }),
        hooks: {
          PermissionRequest: [{ hooks: [request] }],
          ...(source === "hook" && { PreToolUse: [{ hooks: [pre] }] }),
        },
      },
      onPermissionAsk: async () => {
        asks++;
        return "allow";
      },
    });
    await session.run("try", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(asks).toBe(0);
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
    expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
      { by: "hook", reason: "request refused" },
    ]);
    expect(await Bun.file(join(dirs.cwd, "PermissionRequest.input")).json()).toMatchObject({
      tool_name: "bash",
    });
  },
);

test("interrupting PermissionRequest denial stops the run and all sibling tools", async () => {
  dirs = await tempDirs();
  const handler = await script("PermissionRequest", {
    hookSpecificOutput: { decision: { behavior: "deny", message: "halt run", interrupt: true } },
  });
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("bash", { command: "touch marker" }),
        fauxToolCall("write", { path: "sibling", content: "must not write" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("must not run"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      permissions: { allow: ["write"] },
      hooks: { PermissionRequest: [{ matcher: "bash", hooks: [handler] }] },
    },
  });
  expect(await session.run("try")).toMatchObject({
    stopReason: "hook_stopped",
    reason: "halt run",
  });
  expect(fake.contexts).toHaveLength(1);
  expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "sibling")).exists()).toBe(false);
});

test.each(["rule", "hook", "user", "review"] as const)(
  "PermissionDenied records %s and retry only affects review feedback",
  async (by) => {
    dirs = await tempDirs();
    const denied = await script("PermissionDenied", {
      hookSpecificOutput: { retry: true, additionalContext: "denial audit" },
    });
    const pre = await script("PreToolUse", {
      hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "protected" },
    });
    const fake = toolModel();
    if (by === "review") {
      const main = fake.streamFn;
      fake.streamFn = (model, context, options) =>
        JSON.stringify(context).includes("REVIEW_POLICY")
          ? fakeModel([fauxAssistantMessage('{"risk":"high","decision":"deny"}')]).streamFn(
              model,
              context,
              options,
            )
          : main(model, context, options);
    }
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: by === "review" ? "auto-review" : "ask",
      settings: {
        ...(by === "rule" && { permissions: { deny: ["bash"] } }),
        hooks: {
          PermissionDenied: [{ hooks: [denied] }],
          ...(by === "hook" && { PreToolUse: [{ hooks: [pre] }] }),
        },
      },
      ...(by === "user" && { onPermissionAsk: async () => "deny" as const }),
    });
    await session.run("try");
    const input = await Bun.file(join(dirs.cwd, "PermissionDenied.input")).json();
    expect(input).toMatchObject({
      by,
      reason: expect.any(String),
      tool_name: "bash",
      tool_use_id: "call",
      tool_input: { command: "touch marker" },
      ...(by === "rule" && { rule: "bash" }),
    });
    const messages = JSON.stringify(fake.contexts[1]!.messages);
    expect(messages).toContain("denial audit");
    expect(messages.includes("You may adjust the tool input and retry")).toBe(by === "review");
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
  },
);

test.each(["PermissionRequest", "PermissionDenied"] as const)(
  "%s exit 2 does not block or change permissions",
  async (event) => {
    dirs = await tempDirs();
    const handler = await script(event, {}, 2);
    const fake = toolModel();
    let asks = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: { hooks: { [event]: [{ hooks: [handler] }] } },
      onPermissionAsk: async () => {
        asks++;
        return event === "PermissionRequest" ? "allow" : "deny";
      },
    });
    await session.run("try");
    expect(asks).toBe(1);
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(event === "PermissionRequest");
    expect(await Bun.file(join(dirs.cwd, `${event}.input`)).json()).toMatchObject({
      hook_event_name: event,
    });
  },
);

test.each(["allow", "deny"] as const)(
  "PermissionRequest exit 2 ignores JSON %s and permission updates",
  async (behavior) => {
    dirs = await tempDirs();
    const handler = await script(
      "PermissionRequest",
      {
        hookSpecificOutput: {
          decision: {
            behavior,
            ...(behavior === "allow"
              ? {
                  updatedInput: { command: "touch rewritten" },
                  updatedPermissions: [
                    { type: "setMode", destination: "session", mode: "full-access" },
                  ],
                }
              : { message: "ignore me", interrupt: true }),
          },
        },
      },
      2,
    );
    const fake = toolModel();
    let asks = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: { hooks: { PermissionRequest: [{ hooks: [handler] }] } },
      onPermissionAsk: async (request) => {
        asks++;
        expect(request.args).toEqual({ command: "touch marker" });
        return "allow";
      },
    });
    await session.run("try");
    expect(asks).toBe(1);
    expect(session.permissionMode).toBe("ask");
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(true);
    expect(await Bun.file(join(dirs.cwd, "rewritten")).exists()).toBe(false);
  },
);

test("PermissionDenied exit 2 ignores JSON retry after review denial", async () => {
  dirs = await tempDirs();
  const handler = await script("PermissionDenied", { hookSpecificOutput: { retry: true } }, 2);
  const fake = toolModel();
  const main = fake.streamFn;
  fake.streamFn = (model, context, options) =>
    JSON.stringify(context).includes("REVIEW_POLICY")
      ? fakeModel([fauxAssistantMessage('{"risk":"high","decision":"deny"}')]).streamFn(
          model,
          context,
          options,
        )
      : main(model, context, options);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "auto-review",
    settings: { hooks: { PermissionDenied: [{ hooks: [handler] }] } },
  });
  await session.run("try");
  expect(JSON.stringify(fake.contexts[1]!.messages)).not.toContain(
    "You may adjust the tool input and retry",
  );
  expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
});

test.each([false, true])(
  "PermissionRequest with no decision preserves normal interaction, frontend=%s",
  async (frontend) => {
    dirs = await tempDirs();
    const handler = await script("PermissionRequest", {});
    const fake = toolModel();
    let asks = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: { hooks: { PermissionRequest: [{ hooks: [handler] }] } },
      ...(frontend && {
        onPermissionAsk: async () => {
          asks++;
          return "allow" as const;
        },
      }),
    });
    await session.run("try");
    expect(asks).toBe(frontend ? 1 : 0);
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(frontend);
  },
);

test.each(["PermissionRequest", "PermissionDenied"] as const)(
  "%s common stop survives exit 2 and stops allowed siblings",
  async (event) => {
    dirs = await tempDirs();
    const handler = await script(
      event,
      {
        continue: false,
        stopReason: "common stop",
        systemMessage: "notice",
        hookSpecificOutput:
          event === "PermissionRequest" ? { decision: { behavior: "allow" } } : { retry: true },
      },
      2,
    );
    const fake = fakeModel([
      fauxAssistantMessage(
        [
          fauxToolCall("bash", { command: "touch marker" }),
          fauxToolCall("write", { path: "sibling", content: "must not write" }),
        ],
        { stopReason: "toolUse" },
      ),
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        permissions: { allow: ["write"] },
        hooks: { [event]: [{ matcher: "bash", hooks: [handler] }] },
      },
    });
    expect(
      await session.run("try", {
        onEvent: (event) => {
          events.push(event);
        },
      }),
    ).toMatchObject({ stopReason: "hook_stopped", reason: "common stop" });
    expect(events.filter((event) => event.type === "hook_message")).toMatchObject([
      { event, message: "notice" },
    ]);
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
    expect(await Bun.file(join(dirs.cwd, "sibling")).exists()).toBe(false);
  },
);

test("PermissionRequest combines every deny reason and deny beats allow", async () => {
  dirs = await tempDirs();
  const commands = [
    { behavior: "allow" },
    { behavior: "deny", message: "first guard" },
    { behavior: "deny", message: "second guard" },
  ].map((decision) => ({
    type: "command" as const,
    command: `printf '%s' '${JSON.stringify({ hookSpecificOutput: { decision } })}'`,
  }));
  const fake = toolModel();
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: { hooks: { PermissionRequest: [{ hooks: commands }] } },
  });
  await session.run("try");
  const messages = JSON.stringify(fake.contexts[1]!.messages);
  expect(messages).toContain("first guard");
  expect(messages).toContain("second guard");
  expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
});

test.each(["PermissionRequest", "PermissionDenied"] as const)(
  "%s malformed output fails open and reports the shared warning",
  async (event) => {
    dirs = await tempDirs();
    const fake = toolModel();
    const warnings: string[] = [];
    const events: SessionEvent[] = [];
    let asks = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        hooks: { [event]: [{ hooks: [{ type: "command", command: "echo '{broken}'" }] }] },
      },
      onWarning: (warning) => {
        warnings.push(warning);
      },
      onPermissionAsk: async () => {
        asks++;
        return event === "PermissionRequest" ? "allow" : "deny";
      },
    });
    await session.run("try", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(asks).toBe(1);
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(event === "PermissionRequest");
    expect(warnings).toHaveLength(1);
    expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
      { event, error: { code: "hook-invalid-json" } },
    ]);
  },
);

test("PermissionRequest accepts Claude-style session rule entries and never overrides a deny rule", async () => {
  dirs = await tempDirs();
  const handler = await script("PermissionRequest", {
    hookSpecificOutput: {
      decision: {
        behavior: "allow",
        updatedPermissions: [
          {
            type: "addRules",
            destination: "session",
            behavior: "allow",
            rules: [{ toolName: "bash", ruleContent: "touch *" }],
          },
        ],
      },
    },
  });
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("bash", { command: "touch first" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("bash", { command: "touch denied" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("bash", { command: "touch last" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      permissions: { deny: ["bash(touch denied)"] },
      hooks: { PermissionRequest: [{ hooks: [handler] }] },
    },
  });
  await session.run("try");
  expect(await Bun.file(join(dirs.cwd, "first")).exists()).toBe(true);
  expect(await Bun.file(join(dirs.cwd, "denied")).exists()).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "last")).exists()).toBe(true);
  expect(await Bun.file(join(dirs.cwd, "PermissionRequest.input")).json()).toMatchObject({
    tool_input: { command: "touch first" },
  });
});
