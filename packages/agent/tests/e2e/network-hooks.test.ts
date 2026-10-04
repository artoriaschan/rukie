import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, type SessionEvent } from "../../src/index.ts";
import type { HookHandler } from "@neant/shared";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await dirs?.cleanup();
});

async function runHook(handler: HookHandler) {
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("bash", { command: "touch marker" }, { id: "call" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { hooks: { PreToolUse: [{ matcher: "bash", hooks: [handler] }] } },
  });
  await session.run("try", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  await session.dispose();
  return { session, events, fake, executed: await Bun.file(join(dirs.cwd, "marker")).exists() };
}

const denial = {
  hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "protected" },
};

test("HTTP hooks POST the original protocol and apply JSON decisions", async () => {
  dirs = await tempDirs();
  let received: unknown;
  let method: string | undefined;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      method = request.method;
      received = await request.json();
      return Response.json(denial);
    },
  });
  servers.push(server);
  const result = await runHook({ type: "http", url: server.url.href });
  expect(result.executed).toBe(false);
  expect(method).toBe("POST");
  expect(received).toMatchObject({
    session_id: result.session.id,
    hook_event_name: "PreToolUse",
    tool_name: "bash",
    tool_input: { command: "touch marker" },
    tool_use_id: "call",
  });
  expect(result.events.filter((event) => event.type === "permission_denied")).toMatchObject([
    { by: "hook", reason: "Denied by hook: protected" },
  ]);
});

test.each([
  ["non-success", () => Response.json(denial, { status: 503 }), "hook-http-status"],
  ["plain text", () => new Response("not json"), "hook-invalid-json"],
  ["malformed JSON", () => new Response("{oops}"), "hook-invalid-json"],
  ["JSON primitive", () => Response.json("plain-context"), "hook-invalid-json"],
] as const)("HTTP %s warns and fails open", async (_name, response, code) => {
  dirs = await tempDirs();
  const server = Bun.serve({ port: 0, fetch: response });
  servers.push(server);
  const result = await runHook({ type: "http", url: server.url.href });
  expect(result.executed).toBe(true);
  expect(result.events.filter((event) => event.type === "hook_warning")).toMatchObject([
    { error: { code } },
  ]);
});

test("HTTP headers expand only permitted environment variables", async () => {
  dirs = await tempDirs();
  const old = process.env.NEANT_HOOK_TEST_TOKEN;
  process.env.NEANT_HOOK_TEST_TOKEN = "allowed-token";
  try {
    let headers: Headers | undefined;
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        headers = request.headers;
        return Response.json({});
      },
    });
    servers.push(server);
    await runHook({
      type: "http",
      url: server.url.href,
      headers: {
        authorization: "Bearer $NEANT_HOOK_TEST_TOKEN",
        "x-blocked": "$HOME",
        "x-missing": "$NEANT_HOOK_MISSING",
      },
      allowedEnvVars: ["NEANT_HOOK_TEST_TOKEN", "NEANT_HOOK_MISSING"],
    });
    expect(headers!.get("authorization")).toBe("Bearer allowed-token");
    expect(headers!.get("x-blocked")).toBe("$HOME");
    expect(headers!.get("x-missing")).toBe("");
  } finally {
    if (old === undefined) delete process.env.NEANT_HOOK_TEST_TOKEN;
    else process.env.NEANT_HOOK_TEST_TOKEN = old;
  }
});

test("HTTP deadline discards a late deny and allows the tool", async () => {
  dirs = await tempDirs();
  const release = Promise.withResolvers<Response>();
  const server = Bun.serve({ port: 0, fetch: () => release.promise });
  servers.push(server);
  try {
    const result = await runHook({ type: "http", url: server.url.href, timeout: 0.03 });
    expect(result.executed).toBe(true);
    expect(result.events.filter((event) => event.type === "hook_warning")).toMatchObject([
      { error: { code: "hook-timeout" } },
    ]);
  } finally {
    release.resolve(Response.json(denial));
  }
});

async function connectMcp(tools = ["json", "echo", "hang", "error"]) {
  await Bun.write(join(dirs.homeDir, "manifest.json"), JSON.stringify({ tools }));
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
            MCP_ARGUMENTS: join(dirs.homeDir, "arguments"),
          },
        },
      },
    }),
  );
}

test("connected MCP hook tools parse result text as hook stdout", async () => {
  dirs = await tempDirs();
  await connectMcp();
  const result = await runHook({
    type: "mcp_tool",
    server: "local",
    tool: "json",
    input: { text: JSON.stringify(denial) },
  });
  expect(result.executed).toBe(false);
  expect(await Bun.file(join(dirs.homeDir, "calls")).text()).toBe("json\n");
  expect(result.events.filter((event) => event.type === "permission_denied")).toMatchObject([
    { by: "hook", reason: "Denied by hook: protected" },
  ]);
});

test("MCP hook inputs substitute nested tool values without losing JSON types", async () => {
  dirs = await tempDirs();
  await connectMcp();
  const command = "touch marker";
  const result = await runHook({
    type: "mcp_tool",
    server: "local",
    tool: "json",
    input: {
      text: JSON.stringify({
        hookSpecificOutput: {
          permissionDecision: "deny",
          permissionDecisionReason: "blocked ${tool_input.command}",
        },
      }),
      copy: "${tool_input}",
      nested: [{ command: "${tool_input.command}" }],
      missing: "${tool_input.missing}",
    },
  });
  expect(result.executed).toBe(false);
  expect(result.events.filter((event) => event.type === "permission_denied")).toMatchObject([
    { reason: `Denied by hook: blocked ${command}` },
  ]);
  const argumentsReceived = JSON.parse(
    (await Bun.file(join(dirs.homeDir, "arguments")).text()).trim(),
  );
  expect(argumentsReceived).toMatchObject({ copy: { command }, nested: [{ command }] });
  expect(Object.hasOwn(argumentsReceived, "missing")).toBe(false);
});

test.each([
  ["unconnected", "absent", "json", "hook-mcp-unconnected", undefined],
  ["tool failure", "local", "error", "hook-mcp-failed", undefined],
  ["invalid JSON", "local", "json", "hook-invalid-json", undefined],
  ["deadline", "local", "hang", "hook-timeout", 0.03],
] as const)("MCP %s warns and fails open", async (_name, server, tool, code, timeout) => {
  dirs = await tempDirs();
  await connectMcp();
  const result = await runHook({
    type: "mcp_tool",
    server,
    tool,
    input: { text: "{oops}" },
    timeout,
  });
  expect(result.executed).toBe(true);
  expect(result.events.filter((event) => event.type === "hook_warning")).toMatchObject([
    { error: { code } },
  ]);
});

test.each(["cancel", "dispose"] as const)(
  "HTTP %s interrupts a pending hook and discards control output",
  async (action) => {
    dirs = await tempDirs();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<Response>();
    const server = Bun.serve({
      port: 0,
      fetch() {
        started.resolve();
        return release.promise;
      },
    });
    servers.push(server);
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("bash", { command: "touch marker" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      settings: { hooks: { PreToolUse: [{ hooks: [{ type: "http", url: server.url.href }] }] } },
    });
    const controller = new AbortController();
    const events: SessionEvent[] = [];
    const running = session
      .run("try", {
        signal: controller.signal,
        onEvent: (event) => {
          events.push(event);
        },
      })
      .then(
        () => undefined,
        (error) => error as Error,
      );
    await started.promise;
    if (action === "cancel") controller.abort();
    else await session.dispose();
    try {
      const result = await running;
      expect(result?.name).toBe("AbortError");
      expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
      expect(events.filter((event) => event.type === "permission_denied")).toHaveLength(0);
    } finally {
      release.resolve(Response.json(denial));
      await session.dispose();
    }
  },
);

test.each(["http", "mcp_tool"] as const)(
  "%s identical hooks execute once across matching groups",
  async (type) => {
    dirs = await tempDirs();
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        calls++;
        return Response.json({});
      },
    });
    servers.push(server);
    await connectMcp();
    const handler: HookHandler =
      type === "http"
        ? { type, url: server.url.href }
        : { type, server: "local", tool: "json", input: { text: "{}" } };
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("bash", { command: "touch marker" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      settings: {
        hooks: {
          PreToolUse: [
            { hooks: [handler] },
            { matcher: "*", hooks: [handler] },
            { matcher: "bash", hooks: [handler] },
          ],
        },
      },
    });
    await session.run("try");
    await session.dispose();
    expect(type === "http" ? calls : await Bun.file(join(dirs.homeDir, "calls")).text()).toBe(
      type === "http" ? 1 : "json\n",
    );
  },
);

test("HTTP connection errors warn and fail open", async () => {
  dirs = await tempDirs();
  const server = Bun.serve({ port: 0, fetch: () => Response.json({}) });
  const url = server.url.href;
  server.stop(true);
  const result = await runHook({ type: "http", url });
  expect(result.executed).toBe(true);
  expect(result.events.filter((event) => event.type === "hook_warning")).toMatchObject([
    { error: { code: "hook-execution-failed" } },
  ]);
});

test.each(["cancel", "dispose"] as const)(
  "MCP %s interrupts an unanswered hook call",
  async (action) => {
    dirs = await tempDirs();
    await connectMcp();
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("bash", { command: "touch marker" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      settings: {
        hooks: { PreToolUse: [{ hooks: [{ type: "mcp_tool", server: "local", tool: "hang" }] }] },
      },
    });
    const controller = new AbortController();
    const running = session.run("try", { signal: controller.signal }).then(
      () => undefined,
      (error) => error as Error,
    );
    const deadline = Date.now() + 2000;
    while (!(await Bun.file(join(dirs.homeDir, "calls")).exists())) {
      if (Date.now() > deadline) throw new Error("MCP hook did not start");
      await Bun.sleep(5);
    }
    if (action === "cancel") controller.abort();
    else await session.dispose();
    expect((await running)?.name).toBe("AbortError");
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
    await session.dispose();
  },
);

test("HTTP non-success streams release their connection before session disposal", async () => {
  dirs = await tempDirs();
  const cancelled = Promise.withResolvers<void>();
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      request.signal.addEventListener("abort", () => cancelled.resolve(), { once: true });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("failure"));
          },
          cancel() {
            cancelled.resolve();
          },
        }),
        { status: 503 },
      );
    },
  });
  servers.push(server);
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("bash", { command: "touch marker" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: { PreToolUse: [{ hooks: [{ type: "http", url: server.url.href, timeout: 0.03 }] }] },
    },
  });
  try {
    await session.run("try", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(true);
    expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
      { error: { code: "hook-http-status" } },
    ]);
    expect(
      await Promise.race([cancelled.promise.then(() => true), Bun.sleep(100).then(() => false)]),
    ).toBe(true);
    expect(server.pendingRequests).toBe(0);
  } finally {
    await session.dispose();
  }
});
