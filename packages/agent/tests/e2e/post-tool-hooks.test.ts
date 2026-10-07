import { afterEach, expect, test } from "bun:test";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type TextContent,
  type ImageContent,
} from "@earendil-works/pi-ai";
import { join } from "node:path";
import { watch } from "node:fs";
import { createSession, type SessionEvent } from "../../src/index.ts";
import type { HookHandler } from "@rukie/shared";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

async function hook(output: unknown, name = "post.sh", exitCode = 0) {
  await Bun.write(
    join(dirs.cwd, name),
    `cat > ${name}.input\nprintf '%s' '${JSON.stringify(output).replaceAll("'", "'\\''")}'\nexit ${exitCode}\n`,
  );
  return { type: "command", command: `sh ${name}` } satisfies HookHandler;
}

function toolModel(command = "printf original") {
  return fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", { description: "Run test command", command }, { id: "call" }),
      {
        stopReason: "toolUse",
      },
    ),
    fauxAssistantMessage("done"),
  ]);
}

test("successful tool hooks receive executed input and result, preserving output with feedback", async () => {
  dirs = await tempDirs();
  const handler = await hook({
    decision: "block",
    reason: "run lint",
    hookSpecificOutput: { additionalContext: "check formatting" },
  });
  const fake = toolModel();
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { hooks: { PostToolUse: [{ matcher: "bash", hooks: [handler] }] } },
  });
  await session.run("try");
  const input = await Bun.file(join(dirs.cwd, "post.sh.input")).json();
  expect(input.duration_ms).toBeGreaterThanOrEqual(0);
  expect(input).toMatchObject({
    session_id: session.id,
    hook_event_name: "PostToolUse",
    tool_name: "bash",
    tool_input: { command: "printf original" },
    tool_use_id: "call",
    tool_response: { content: [{ type: "text", text: "original" }] },
    duration_ms: expect.any(Number),
  });
  expect(
    fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
  ).toMatchObject([
    {
      isError: false,
      content: [
        { type: "text", text: "original" },
        { type: "text", text: "<system-reminder>\ncheck formatting\n</system-reminder>" },
        { type: "text", text: "<system-reminder>\nrun lint\n</system-reminder>" },
      ],
    },
  ]);
});

test.each([
  [[{ type: "text", text: "filtered" }], true],
  [[{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }], true],
  [[], true],
  ["filtered", false],
  [[{ type: "text", text: 3 }], false],
  [[{ type: "image", data: "abc" }], false],
  [[{ type: "toolCall", name: "bash" }], false],
] as const)("tool output replacement %j is applied only when valid", async (content, valid) => {
  dirs = await tempDirs();
  const handler = await hook({
    hookSpecificOutput: { updatedToolOutput: content, additionalContext: "keep this reminder" },
  });
  const fake = toolModel();
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    onWarning: () => {},
    settings: { hooks: { PostToolUse: [{ hooks: [handler] }] } },
  });
  await session.run("try", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  const result = session.messages.find((message) => message.role === "toolResult");
  expect(result).toMatchObject({
    isError: false,
    content: [
      ...(valid ? content : [{ type: "text", text: "original" }]),
      { type: "text", text: "<system-reminder>\nkeep this reminder\n</system-reminder>" },
    ],
  });
  expect(events.filter((event) => event.type === "hook_warning")).toHaveLength(valid ? 0 : 1);
  if (!valid)
    expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
      {
        event: "PostToolUse",
        error: {
          code: "hook-output-ignored",
          params: { field: "hookSpecificOutput.updatedToolOutput" },
        },
      },
    ]);
});

test("exit 2 adds stderr feedback without discarding a successful result", async () => {
  dirs = await tempDirs();
  const fake = toolModel();
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        PostToolUse: [
          { hooks: [{ type: "command", command: "cat > exit.input; echo fix-lint >&2; exit 2" }] },
        ],
      },
    },
  });
  await session.run("try");
  expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
    isError: false,
    content: [{ text: "original" }, { text: "<system-reminder>\nfix-lint\n</system-reminder>" }],
  });
});

test("execution failures receive troubleshooting context and ignore block or replacement outputs", async () => {
  dirs = await tempDirs();
  const handler = await hook({
    decision: "block",
    reason: "ignored reason",
    hookSpecificOutput: {
      updatedToolOutput: [{ type: "text", text: "hidden failure" }],
      additionalContext: "check exit status",
    },
  });
  const fake = toolModel("printf failed >&2; exit 1");
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    onWarning: () => {},
    settings: {
      hooks: {
        PostToolUseFailure: [{ matcher: "bash", hooks: [handler] }],
        PostToolUse: [{ hooks: [{ type: "command", command: "touch wrong-event" }] }],
      },
    },
  });
  await session.run("try", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  const input = await Bun.file(join(dirs.cwd, "post.sh.input")).json();
  expect(input.duration_ms).toBeGreaterThanOrEqual(0);
  expect(input).toMatchObject({
    hook_event_name: "PostToolUseFailure",
    tool_name: "bash",
    tool_input: { command: "printf failed >&2; exit 1" },
    tool_use_id: "call",
    is_interrupt: false,
    error: expect.stringContaining("failed"),
  });
  expect(await Bun.file(join(dirs.cwd, "wrong-event")).exists()).toBe(false);
  const result = session.messages.find((message) => message.role === "toolResult");
  expect(result).toMatchObject({ isError: true });
  expect(JSON.stringify(result)).toContain("failed");
  expect(JSON.stringify(result)).toContain("check exit status");
  expect(JSON.stringify(result)).not.toContain("hidden failure");
  expect(JSON.stringify(result)).not.toContain("ignored reason");
  expect(events.filter((event) => event.type === "hook_warning")).toHaveLength(2);
});

test.each(["invalid", "rule", "hook", "user"] as const)(
  "%s rejection does not trigger either after hook",
  async (kind) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall(
          "bash",
          kind === "invalid" ? {} : { description: "Run test command", command: "touch marker" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    const handler = { type: "command", command: "touch after-called" } satisfies HookHandler;
    const deny = await hook({ hookSpecificOutput: { permissionDecision: "deny" } });
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: kind === "user" ? "ask" : "full-access",
      onPermissionAsk: async () => "deny",
      settings: {
        ...(kind === "rule" && { permissions: { deny: ["bash"] } }),
        hooks: {
          ...(kind === "hook" && { PreToolUse: [{ hooks: [deny] }] }),
          PostToolUse: [{ hooks: [handler] }],
          PostToolUseFailure: [{ hooks: [handler] }],
        },
      },
    });
    await session.run("try");
    expect(await Bun.file(join(dirs.cwd, "after-called")).exists()).toBe(false);
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
    expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
      isError: true,
    });
  },
);

test("common continue false on an after hook stops before the next model call", async () => {
  dirs = await tempDirs();
  const handler = await hook({
    continue: false,
    stopReason: "stop after execution",
    systemMessage: "completed guard",
  });
  const fake = toolModel();
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { hooks: { PostToolUse: [{ hooks: [handler] }] } },
  });
  const result = await session.run("try", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(result).toMatchObject({ stopReason: "hook_stopped", reason: "stop after execution" });
  expect(fake.contexts).toHaveLength(1);
  expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
    isError: false,
    content: [{ text: "original" }],
  });
  expect(events.filter((event) => event.type === "hook_message")).toMatchObject([
    { event: "PostToolUse", message: "completed guard" },
  ]);
});

test("interrupted tool failures still run the failure hook and persist its context", async () => {
  dirs = await tempDirs();
  const handler = await hook({ hookSpecificOutput: { additionalContext: "interrupted cleanup" } });
  const fake = toolModel("echo ready; sleep 30");
  const controller = new AbortController();
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { hooks: { PostToolUseFailure: [{ hooks: [handler] }] } },
  });
  const run = session.run("try", {
    signal: controller.signal,
    onEvent: (event) => {
      if (
        event.type === "tool_execution_update" &&
        event.partialResult.content.some(
          (item: TextContent | ImageContent) => item.type === "text" && item.text.includes("ready"),
        )
      )
        controller.abort(new Error("cancel test"));
    },
  });
  await expect(run).rejects.toThrow("cancel test");
  expect(await Bun.file(join(dirs.cwd, "post.sh.input")).json()).toMatchObject({
    hook_event_name: "PostToolUseFailure",
    is_interrupt: true,
  });
  expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
    isError: true,
  });
  expect(JSON.stringify(session.messages)).toContain("interrupted cleanup");
});

test("dispose cancels a failure hook running after tool interruption", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "failure.sh"),
    "cat > failure.input\nsleep 30 &\nchild=$!\nprintf '%s %s\\n' $$ $child > failure.pid.tmp\nmv failure.pid.tmp failure.pid\nwait $child\ntouch late-hook\n",
  );
  const fake = toolModel("echo ready; sleep 30");
  const controller = new AbortController();
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: { PostToolUseFailure: [{ hooks: [{ type: "command", command: "sh failure.sh" }] }] },
    },
  });
  const ready = Promise.withResolvers<number[]>();
  let readyPids: number[] = [];
  const pidPath = join(dirs.cwd, "failure.pid");
  // Observe the atomic ready-file rename before starting the Run. The fixture
  // publishes both PIDs only after its real shell and sleeping child exist.
  const watcher = watch(dirs.cwd, (_event, filename) => {
    if (filename !== "failure.pid") return;
    void Bun.file(pidPath)
      .text()
      .then((text) => {
        const pids = text.trim().split(/\s+/u).map(Number);
        if (pids.length !== 2 || pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0))
          throw new Error(`Invalid failure-hook ready PIDs: ${text}`);
        readyPids = pids;
        ready.resolve(pids);
      })
      .catch(ready.reject);
  });
  watcher.on("error", ready.reject);
  // Real process startup and filesystem notification cannot use frontend time.
  const readyTimeout = setTimeout(
    () => ready.reject(new Error("Failure hook did not publish ready PIDs")),
    1000,
  );
  const run = session.run("try", {
    signal: controller.signal,
    onEvent: (event) => {
      if (
        event.type === "tool_execution_update" &&
        event.partialResult.content.some(
          (item: TextContent | ImageContent) => item.type === "text" && item.text.includes("ready"),
        )
      )
        controller.abort(new Error("cancel test"));
    },
  });
  void run.catch(() => {});
  let settlementTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const pids = await ready.promise;
    clearTimeout(readyTimeout);
    expect(await Bun.file(pidPath).exists()).toBe(true);
    expect(await Bun.file(join(dirs.cwd, "failure.input")).json()).toMatchObject({
      is_interrupt: true,
    });
    await Promise.race([
      Promise.all([session.dispose(), expect(run).rejects.toThrow("cancel test")]),
      new Promise<never>((_resolve, reject) => {
        settlementTimeout = setTimeout(
          () => reject(new Error("Disposed failure hook did not settle its Run")),
          1000,
        );
      }),
    ]);
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    expect(await Bun.file(join(dirs.cwd, "late-hook")).exists()).toBe(false);
  } finally {
    clearTimeout(readyTimeout);
    clearTimeout(settlementTimeout);
    watcher.close();
    // Failed assertions must not leave a 30-second fixture or let afterEach
    // remove storage while its Run is still writing. These are our own PIDs.
    for (const pid of readyPids.toReversed()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
    }
    let cleanupTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([session.dispose(), run.catch(() => {})]),
        new Promise<never>((_resolve, reject) => {
          cleanupTimeout = setTimeout(
            () => reject(new Error("Failure-hook fixture cleanup did not settle")),
            1000,
          );
        }),
      ]);
    } finally {
      clearTimeout(cleanupTimeout);
    }
  }
});

test("replacement retains PreToolUse context and child hooks include child identity", async () => {
  dirs = await tempDirs();
  const before = await hook(
    {
      hookSpecificOutput: {
        additionalContext: "before context",
        updatedInput: { description: "Run rewritten command", command: "printf rewritten" },
      },
    },
    "before.sh",
  );
  const after = await hook({
    hookSpecificOutput: { updatedToolOutput: [{ type: "text", text: "child filtered" }] },
  });
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", { description: "child", prompt: "try", run_in_background: false }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall(
        "bash",
        { description: "Run test command", command: "printf original" },
        { id: "child-call" },
      ),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("child done"),
    fauxAssistantMessage("parent done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        PreToolUse: [{ matcher: "bash", hooks: [before] }],
        PostToolUse: [{ matcher: "bash", hooks: [after] }],
      },
    },
  });
  await session.run("delegate");
  const input = await Bun.file(join(dirs.cwd, "post.sh.input")).json();
  expect(input.agent_id).not.toBe(session.id);
  expect(input.agent_id).toBe(input.session_id);
  expect(input).toMatchObject({
    agent_type: "general-purpose",
    tool_input: { command: "printf rewritten" },
    tool_response: { content: [{ text: "rewritten" }] },
  });
  const childResult = fake.contexts
    .find((context) =>
      context.messages.some(
        (message) => message.role === "toolResult" && message.toolCallId === "child-call",
      ),
    )!
    .messages.find(
      (message) => message.role === "toolResult" && message.toolCallId === "child-call",
    );
  expect(childResult).toMatchObject({
    isError: false,
    content: [
      { text: "child filtered" },
      { text: "<system-reminder>\nbefore context\n</system-reminder>" },
    ],
  });
});
