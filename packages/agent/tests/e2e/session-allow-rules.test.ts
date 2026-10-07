import { afterEach, expect, test } from "bun:test";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  hook,
  ToolTask,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
  awaitWithContext,
} from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord";
import type { ToolCall } from "@earendil-works/pi-ai";
import { createPermissionGate, parsePermissionRules } from "../../src/permissions/index.ts";
import { createJobs } from "../../src/tools/jobs/index.ts";
import { createBuiltinTools } from "../../src/tools/builtin.ts";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { mkdir, symlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import {
  createSession,
  type PermissionAskRequest,
  type SessionAllowRule,
  type Session,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
let toolJobs: ReturnType<typeof createJobs> | undefined;
const sessions: Session[] = [];
async function openSession(options: Parameters<typeof createSession>[0]) {
  const session = await createSession(options);
  sessions.push(session);
  return session;
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await toolJobs?.clear(true);
  toolJobs = undefined;
  await dirs?.cleanup();
});
/** Execute an actual native ToolTask, including the gate's beforeTool hook. */
async function runNativeCall(
  call: ToolCall,
  tools: ToolRegistration[],
  gate: ReturnType<typeof createPermissionGate>,
  context: Context,
) {
  const fake = fakeModel([
    fauxAssistantMessage(call, { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const registry = createRegistry();
  registry.install({
    name: "permission-tools",
    tools,
    hooks: [hook(ToolTask, { beforeTool: gate.beforeTool })],
  });
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: fake.models, registry, env: () => new NodeExecutionEnv({ cwd: dirs.cwd }) },
    context,
  );
  try {
    const conversation = await harness.root(context, {
      agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
    });
    const request = await conversation.submit({ type: "input", content: "execute" }, context);
    expect((await request.wait(context)).status).toBe("done");
    const result = (await conversation.context(context)).messages.findLast(
      (message) => message.role === "toolResult",
    );
    if (!result || result.role !== "toolResult") throw new Error("Native tool receipt missing.");
    return result;
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
}
const commandTurn = (command: string) =>
  fauxAssistantMessage(fauxToolCall("bash", { description: "Run test command", command }), {
    stopReason: "toolUse",
  });

test("session command grant allows the same literal command and still asks for another", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    commandTurn("printf 'literal*'"),
    commandTurn(" printf 'literal*' "),
    commandTurn("printf 'literal-wide'"),
    fauxAssistantMessage("done"),
  ]);
  const requests: PermissionAskRequest[] = [];
  const session = await openSession({
    ...dirs,
    ...fake,
    onPermissionAsk: async (request) => {
      requests.push(request);
      return requests.length === 1 ? "allow-session" : "deny";
    },
  });
  await session.run("run commands");
  expect(requests.map((request) => request.args)).toEqual([
    { description: "Run test command", command: "printf 'literal*'" },
    { description: "Run test command", command: "printf 'literal-wide'" },
  ]);
  expect(requests[0]!.sessionAllow).toEqual({ kind: "command", rule: "bash(printf 'literal\\*')" });
  expect(
    fake.contexts[3]!.messages.filter((message) => message.role === "toolResult"),
  ).toMatchObject([{ isError: false }, { isError: false }, { isError: true }]);
});

test.each([
  ["printf 'a?'", "printf 'ax'"],
  ["printf '[ab]'", "printf 'a'"],
  ["printf '{a,b}'", "printf 'a'"],
  ["printf 'a\\b'", "printf 'ab'"],
  ["printf '$(pwd)'", "printf '$(whoami)'"],
  ["printf '`pwd`'", "printf '`whoami`'"],
  ["printf one && printf two", "printf one && printf three"],
  ["printf one\nprintf two", "printf one\nprintf three"],
] as const)("session grant keeps %s exact", async (command, other) => {
  dirs = await tempDirs();
  const fake = fakeModel([
    commandTurn(command),
    commandTurn(command),
    commandTurn(other),
    fauxAssistantMessage("done"),
  ]);
  const asked: unknown[] = [];
  const session = await openSession({
    ...dirs,
    ...fake,
    onPermissionAsk: async (request) => {
      asked.push(request.args);
      return asked.length === 1 ? "allow-session" : "deny";
    },
  });
  await session.run("run");
  expect(asked).toEqual([
    { description: "Run test command", command },
    { description: "Run test command", command: other },
  ]);
  expect(
    fake.contexts[3]!.messages.filter((message) => message.role === "toolResult"),
  ).toMatchObject([{ isError: false }, { isError: false }, { isError: true }]);
});

const writeTurn = (path: string) =>
  fauxAssistantMessage(fauxToolCall("write", { path, content: "written" }), {
    stopReason: "toolUse",
  });
test("session directory grant follows canonical paths and respects deny and ask", async () => {
  dirs = await tempDirs();
  await mkdir(join(dirs.cwd, "allowed"));
  await mkdir(join(dirs.cwd, "outside"));
  await symlink(join(dirs.cwd, "allowed"), join(dirs.cwd, "alias"));
  await symlink(join(dirs.cwd, "outside"), join(dirs.cwd, "allowed/escape"));
  const fake = fakeModel([
    writeTurn("alias/first"),
    writeTurn("allowed/second"),
    writeTurn("allowed/blocked"),
    writeTurn("allowed/asked"),
    writeTurn("allowed/asked"),
    writeTurn("allowed/escape/last"),
    fauxAssistantMessage("done"),
  ]);
  const requests: PermissionAskRequest[] = [];
  const session = await openSession({
    ...dirs,
    ...fake,
    settings: { permissions: { deny: ["write(allowed/blocked)"], ask: ["write(allowed/asked)"] } },
    onPermissionAsk: async (request) => {
      requests.push(request);
      return requests.length <= 2 ? "allow-session" : "deny";
    },
  });
  await session.run("write");
  expect(requests.map((request) => (request.args as { path: string }).path)).toEqual([
    join(dirs.cwd, "alias/first"),
    join(dirs.cwd, "allowed/asked"),
    join(dirs.cwd, "allowed/asked"),
    join(dirs.cwd, "allowed/escape/last"),
  ]);
  expect(requests[0]!.sessionAllow).toEqual({
    kind: "directory",
    rule: `write(${realpathSync(dirs.cwd)}/allowed/**)`,
  });
  expect(await Bun.file(join(dirs.cwd, "allowed/second")).text()).toBe("written");
  expect(await Bun.file(join(dirs.cwd, "allowed/blocked")).exists()).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "outside/last")).exists()).toBe(false);
});

test("session command grants are absent from transcript and expire on resume", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([commandTurn("printf approved"), fauxAssistantMessage("done")]);
  const session = await openSession({
    ...dirs,
    ...fake,
    onPermissionAsk: async () => "allow-session",
  });
  await session.run("run");
  expect(JSON.stringify(session.messages)).not.toContain("bash(printf approved)");
  await session.close();
  const resumedFake = fakeModel([commandTurn("printf approved"), fauxAssistantMessage("done")]);
  let asked = 0;
  const resumed = await openSession({
    ...dirs,
    ...resumedFake,
    resumeId: session.id,
    onPermissionAsk: async () => {
      asked++;
      return "deny";
    },
  });
  await resumed.run("again");
  expect(asked).toBe(1);
  expect(
    resumedFake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({ isError: true });
});

test.each(["command", "directory"] as const)(
  "concurrent %s requests are withdrawn only when covered",
  async (kind) => {
    dirs = await tempDirs();
    const fake = fakeModel([]);
    toolJobs = createJobs();
    const tools = createBuiltinTools({
      cwd: dirs.cwd,
      homeDir: dirs.homeDir,
      jobs: toolJobs,
      getSkill: () => undefined,
      setTodo: async () => {},
    });
    const calls =
      kind === "command"
        ? [
            fauxToolCall(
              "bash",
              { description: "Run test command", command: "printf shared" },
              { id: "first" },
            ),
            fauxToolCall(
              "bash",
              { description: "Run test command", command: "printf shared" },
              { id: "covered" },
            ),
            fauxToolCall(
              "bash",
              { description: "Run test command", command: "printf different" },
              { id: "different" },
            ),
          ]
        : [
            fauxToolCall("write", { path: "same/first", content: "ok" }, { id: "first" }),
            fauxToolCall("write", { path: "same/second", content: "ok" }, { id: "covered" }),
            fauxToolCall("write", { path: "other/first", content: "ok" }, { id: "different" }),
            fauxToolCall("write", { path: "same/ask", content: "no" }, { id: "ask" }),
            fauxToolCall("write", { path: "same/deny", content: "no" }, { id: "deny" }),
          ];
    const replies = new Map<
      string,
      ReturnType<typeof Promise.withResolvers<"allow" | "deny" | "allow-session">>
    >();
    const requests = new Map<string, PermissionAskRequest>();
    const asked = Promise.withResolvers<void>();
    const gate = createPermissionGate({
      ...dirs,
      ...fake,
      rules: parsePermissionRules({ ask: ["write(same/ask)"], deny: ["write(same/deny)"] }),
      getMode: () => "ask",
      getTools: () => tools,
      getMessages: async () => [],
      getProjectInstructions: () => [],
      getReviewModel: () => fake.model,
      onEvent: () => {},
      onPermissionAsk: (request) => {
        requests.set(request.toolCallId, request);
        const reply = Promise.withResolvers<"allow" | "deny" | "allow-session">();
        replies.set(request.toolCallId, reply);
        if (requests.size === (kind === "command" ? 3 : 4)) asked.resolve();
        return reply.promise;
      },
    });
    // Separate native conversations enter the same gate concurrently; each native task
    // validates and executes its registered tool through the public Harness boundary.
    const abort = new AbortController();
    const context = withAbortSignal(
      AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]),
      BACKGROUND_CONTEXT,
    );
    const running = calls.map((call) => runNativeCall(call, tools, gate, context));
    try {
      await awaitWithContext(asked.promise, context);
      const withdrawn = Promise.withResolvers<void>();
      requests
        .get("covered")!
        .signal.addEventListener("abort", () => withdrawn.resolve(), { once: true });
      replies.get("first")!.resolve("allow-session");
      await awaitWithContext(withdrawn.promise, context);
      expect((await running[0]!).isError).toBe(false);
      expect((await running[1]!).isError).toBe(false);
      expect(requests.get("different")!.signal.aborted).toBe(false);
      if (kind === "directory") expect(requests.get("ask")!.signal.aborted).toBe(false);
      replies.get("different")!.resolve("deny");
      replies.get("ask")?.resolve("deny");
      const results = await Promise.all(running);
      expect(results.map((result) => result.isError)).toEqual(
        kind === "command" ? [false, false, true] : [false, false, true, true, true],
      );
      expect(requests.has("deny")).toBe(false);
      // A late frontend answer to a withdrawn request cannot install another rule.
      replies.get("covered")!.resolve("allow-session");
    } finally {
      abort.abort();
      await Promise.all(running);
    }
  },
);

test.each(["glob", "grep"] as const)(
  "%s session directory description uses directory itself or file parent",
  async (tool) => {
    dirs = await tempDirs();
    await mkdir(join(dirs.cwd, "target"));
    await Bun.write(join(dirs.cwd, "target/file"), "content");
    const paths = ["target", "target/file", undefined];
    const fake = fakeModel([
      ...paths.map((path) =>
        fauxAssistantMessage(
          fauxToolCall(tool, { pattern: "content", ...(path !== undefined && { path }) }),
          { stopReason: "toolUse" },
        ),
      ),
      fauxAssistantMessage("done"),
    ]);
    const requests: PermissionAskRequest[] = [];
    const session = await openSession({
      ...dirs,
      ...fake,
      settings: { permissions: { ask: [tool] } },
      onPermissionAsk: async (request) => {
        requests.push(request);
        return "allow-session";
      },
    });
    await session.run("search");
    expect(requests.map((request) => request.sessionAllow)).toEqual([
      { kind: "directory", rule: `${tool}(${realpathSync(dirs.cwd)}/target/**)` },
      { kind: "directory", rule: `${tool}(${realpathSync(dirs.cwd)}/target/**)` },
      { kind: "directory", rule: `${tool}(${realpathSync(dirs.cwd)}/**)` },
    ]);
  },
);

test("related Sessions share memory grants by reference and ordinary rules do not gain exact unsafe grants", async () => {
  dirs = await tempDirs();
  const shared: SessionAllowRule[] = [];
  const command = "printf '$(pwd)'";
  const fakeA = fakeModel([commandTurn(command), fauxAssistantMessage("done")]);
  const fakeB = fakeModel([commandTurn(command), fauxAssistantMessage("done")]);
  let asksB = 0;
  const a = await openSession({
    ...dirs,
    ...fakeA,
    sessionAllowRules: shared,
    onPermissionAsk: async () => "allow-session",
  });
  // Construct B before A appends: a startup copy would miss the grant.
  const b = await openSession({
    ...dirs,
    ...fakeB,
    sessionAllowRules: shared,
    onPermissionAsk: async () => {
      asksB++;
      return "deny";
    },
  });
  await a.run("grant");
  await b.run("repeat");
  expect(asksB).toBe(0);
  expect(
    fakeB.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({ isError: false });
  const configured = fakeModel([commandTurn(command), fauxAssistantMessage("done")]);
  let asksConfigured = 0;
  const c = await openSession({
    ...dirs,
    ...configured,
    allowRules: [`bash(${command})`],
    onPermissionAsk: async () => {
      asksConfigured++;
      return "deny";
    },
  });
  await c.run("configuration");
  expect(asksConfigured).toBe(1);
});

test("directory name glob characters cannot grant adjacent directories or another tool", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    writeTurn("group[ab]/first"),
    writeTurn("group[ab]/nested/second"),
    writeTurn("groupa/other"),
    fauxAssistantMessage(
      fauxToolCall("edit", {
        path: "group[ab]/first",
        edits: [{ oldText: "written", newText: "changed" }],
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const requests: PermissionAskRequest[] = [];
  const session = await openSession({
    ...dirs,
    ...fake,
    onPermissionAsk: async (request) => {
      requests.push(request);
      return requests.length === 1 ? "allow-session" : "deny";
    },
  });
  await session.run("write");
  expect(requests.map((request) => request.toolName)).toEqual(["write", "write", "edit"]);
  expect(requests[0]!.sessionAllow.rule).toBe(`write(${realpathSync(dirs.cwd)}/group\\[ab\\]/**)`);
  expect(await Bun.file(join(dirs.cwd, "group[ab]/nested/second")).text()).toBe("written");
  expect(await Bun.file(join(dirs.cwd, "groupa/other")).exists()).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "group[ab]/first")).text()).toBe("written");
});

test("other tools receive an exact bare tool session grant", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([]);
  toolJobs = createJobs();
  const tools = createBuiltinTools({
    cwd: dirs.cwd,
    homeDir: dirs.homeDir,
    jobs: toolJobs,
    getSkill: () => undefined,
    setTodo: async () => {},
  })
    .filter((tool) => tool.name === "write")
    .map((tool) => ({ ...tool, name: "mcp__example__store" }));
  const call = fauxToolCall("mcp__example__store", { path: "first", content: "ok" });
  const requests: PermissionAskRequest[] = [];
  const gate = createPermissionGate({
    ...dirs,
    ...fake,
    rules: [],
    getMode: () => "ask",
    getTools: () => tools,
    getMessages: async () => [],
    getProjectInstructions: () => [],
    getReviewModel: () => fake.model,
    onEvent: () => {},
    onPermissionAsk: async (request) => {
      requests.push(request);
      return "allow-session";
    },
  });
  const context = withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT);
  expect((await runNativeCall(call, tools, gate, context)).isError).toBe(false);
  expect(
    (
      await runNativeCall(
        fauxToolCall(call.name, { path: "second", content: "ok" }),
        tools,
        gate,
        context,
      )
    ).isError,
  ).toBe(false);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.sessionAllow).toEqual({ kind: "tool", rule: "mcp__example__store" });
});
