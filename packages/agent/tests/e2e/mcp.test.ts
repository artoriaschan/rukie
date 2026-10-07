import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createSession as openSession, type SessionEvent } from "../../src/index.ts";
import { loadSettings } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { abortingModel } from "../helpers/aborting-model.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Awaited<ReturnType<typeof openSession>>[] = [];
async function createSession(options: Parameters<typeof openSession>[0]) {
  const session = await openSession(options);
  sessions.push(session);
  return session;
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  if (!dirs) return;
  // Also prevent a failing cleanup assertion from leaving fixture processes alive.
  const pids = Bun.file(join(dirs.homeDir, "pids"));
  if (await pids.exists()) {
    for (const pid of (await pids.text()).trim().split("\n")) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        /* Already closed. */
      }
    }
  }
  await dirs?.cleanup();
});

test.each(["instructions", "tools"])("only changed MCP %s reinject a reminder", async (change) => {
  dirs = await tempDirs();
  await userConfig({
    local: await stdioConfig({ instructions: "Stable instructions.", tools: ["echo"] }),
  });
  const fake = fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("changed")]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("first");
  await stdioConfig({
    instructions: change === "instructions" ? "Changed instructions." : "Stable instructions.",
    tools: change === "tools" ? ["added"] : ["echo"],
  });
  await session.reconnectMcp("local");
  const events: SessionEvent[] = [];
  await session.run("changed", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  const updates = mcpReminders(session);
  expect(updates).toHaveLength(2);
  expect(updates.at(-1)!.content).toContain(
    change === "instructions" ? "Changed instructions." : "mcp__local__added",
  );
  await expectClosed();
});

test.each(["model-error", "event-error"])(
  "a failed Run (%s) still closes MCP after Session close",
  async (failure) => {
    dirs = await tempDirs();
    await userConfig({ local: await stdioConfig() });
    const fake = fakeModel([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "model failed" }),
    ]);
    const warnings: string[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      onWarning: (warning) => warnings.push(warning),
    });
    const events: SessionEvent[] = [];
    await expect(
      session.run("fail", {
        onEvent: async (event) => {
          events.push(event);
          if (event.type === "snapshot" && failure === "event-error")
            throw new Error("event failed");
        },
      }),
    ).rejects.toThrow("model failed");
    if (failure === "event-error") expect(warnings.join("\n")).toContain("event failed");
    expect(events.at(-1)).toMatchObject({ type: "result", success: false });
    await expectClosed();
  },
);

test("a trusted project overrides a same-name user server", async () => {
  dirs = await tempDirs();
  await userConfig({ local: { command: join(dirs.cwd, "missing-command") } });
  await Bun.write(
    join(dirs.cwd, ".mcp.json"),
    JSON.stringify({ mcpServers: { local: await stdioConfig() } }),
  );
  const fake = fakeModel([fauxAssistantMessage("done")]);
  const events: SessionEvent[] = [];
  await (
    await createSession({ ...dirs, ...fake, trustProjectMcp: true })
  ).run("continue", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "mcp_server_error")).toEqual([]);
  expect(JSON.stringify(fake.contexts[0]!.messages)).toContain("mcp__local__echo");
  await expectClosed();
});

test.each(["untrusted", "settings", "flag", "project-self-trust"])(
  "project MCP trust: %s",
  async (trust) => {
    dirs = await tempDirs();
    const config = await stdioConfig();
    await userConfig({ user: config });
    await Bun.write(
      join(dirs.cwd, ".mcp.json"),
      JSON.stringify({ mcpServers: { project: config } }),
    );
    if (trust === "settings")
      await Bun.write(
        join(dirs.homeDir, ".rukie/settings.json"),
        JSON.stringify({ trustedProjects: [dirs.cwd] }),
      );
    if (trust === "project-self-trust")
      await Bun.write(
        join(dirs.cwd, ".rukie/settings.json"),
        JSON.stringify({ trustedProjects: [dirs.cwd] }),
      );
    const { settings } = await loadSettings(dirs);
    const fake = fakeModel([fauxAssistantMessage("done")]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      settings,
      trustProjectMcp: trust === "flag",
    });
    await session.run("list tools", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const trusted = trust === "settings" || trust === "flag";
    const names = getCurrentTools(fake.contexts[0]!.messages).map((tool) => tool.name);
    expect(names.includes("mcp__project__echo")).toBe(trusted);
    expect(names).toContain("mcp__user__echo");
    expect((await Bun.file(join(dirs.homeDir, "pids")).text()).trim().split("\n")).toHaveLength(
      trusted ? 2 : 1,
    );
    await expectClosed();
  },
);

test.each(["success", "server-error"])(
  "Streamable HTTP sends headers, executes tools and closes (%s)",
  async (mode) => {
    dirs = await tempDirs();
    const requests: { method: string; authorization: string | null }[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests.push({
          method: request.method,
          authorization: request.headers.get("authorization"),
        });
        if (request.method === "GET") return new Response(null, { status: 405 });
        if (request.method === "DELETE") return new Response(null, { status: 204 });
        const rpc = (await request.json()) as {
          id?: number;
          method: string;
          params: { protocolVersion: string; arguments: { text: string } };
        };
        if (rpc.id === undefined) return new Response(null, { status: 202 });
        if (rpc.method === "tools/call" && mode === "server-error")
          return new Response("server unavailable", { status: 503 });
        const result =
          rpc.method === "initialize"
            ? {
                protocolVersion: rpc.params.protocolVersion,
                serverInfo: { name: "http-test", version: "1" },
                capabilities: { tools: {} },
                instructions: "Remote server instructions.",
              }
            : rpc.method === "tools/list"
              ? {
                  tools: [
                    {
                      name: "echo",
                      inputSchema: { type: "object", properties: { text: { type: "string" } } },
                    },
                  ],
                }
              : { content: [{ type: "text", text: `Remote: ${rpc.params.arguments.text}` }] };
        return Response.json(
          { jsonrpc: "2.0", id: rpc.id, result },
          { headers: { "mcp-session-id": "test-session" } },
        );
      },
    });
    try {
      await userConfig({
        remote: {
          type: "http",
          url: server.url.href,
          headers: { Authorization: "Bearer test-token" },
        },
      });
      const fake = fakeModel([
        fauxAssistantMessage(fauxToolCall("mcp__remote__echo", { text: "hello" }), {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("done"),
      ]);
      const events: SessionEvent[] = [];
      await (
        await createSession({
          ...dirs,
          ...fake,
          allowRules: ["mcp__remote__*"],
          onWarning: () => {},
        })
      ).run("use remote", {
        onEvent: (event) => {
          events.push(event);
        },
      });
      expect(JSON.stringify(fake.contexts[0]!.messages)).toContain("Remote server instructions.");
      expect(
        fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
      ).toMatchObject({
        role: "toolResult",
        isError: mode === "server-error",
      });
      if (mode === "success")
        expect(
          fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult")!.content,
        ).toEqual([{ type: "text", text: "Remote: hello" }]);
      const errors = events.filter((event) => event.type === "mcp_server_error");
      expect(errors).toHaveLength(mode === "server-error" ? 1 : 0);
      if (mode === "server-error")
        expect(errors[0]).toMatchObject({
          server: "remote",
          error: expect.stringContaining("503"),
        });
      expect(events.at(-1)).toMatchObject({ type: "result", success: true });
      await Promise.all(sessions.splice(0).map((session) => session.close()));
      expect(requests.at(-1)?.method).toBe("DELETE");
      expect(requests.every((request) => request.authorization === "Bearer test-token")).toBe(true);
    } finally {
      await server.stop(true);
    }
  },
);

async function stdioConfig(manifest: object = { instructions: "Use echo for test messages." }) {
  await Bun.write(join(dirs.homeDir, "manifest.json"), JSON.stringify(manifest));
  return {
    command: process.execPath,
    args: [fileURLToPath(new URL("../helpers/mcp-server.ts", import.meta.url))],
    env: {
      MCP_MANIFEST: join(dirs.homeDir, "manifest.json"),
      MCP_PIDS: join(dirs.homeDir, "pids"),
      MCP_CALLS: join(dirs.homeDir, "calls"),
    },
  };
}

async function userConfig(servers: object) {
  await Bun.write(join(dirs.homeDir, ".rukie/mcp.json"), JSON.stringify({ mcpServers: servers }));
}

async function expectClosed() {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  const pids = (await Bun.file(join(dirs.homeDir, "pids")).text()).trim().split("\n");
  expect(pids.length).toBeGreaterThan(0);
  for (const pid of pids) expect(() => process.kill(Number(pid), 0)).toThrow();
}

function mcpReminders(session: Awaited<ReturnType<typeof openSession>>) {
  return session.messages.filter(
    (message) => message.role === "system-reminder" && message.source === "mcp",
  );
}

test("resume preserves context and Transcript prefixes and reminders track changed instructions, tools and removal", async () => {
  dirs = await tempDirs();
  const now = () => new Date("2026-10-01T12:00:00Z");
  await userConfig({
    local: await stdioConfig({ instructions: "Original instructions.", tools: ["echo"] }),
  });
  const fake = fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("unchanged")]);
  const session = await createSession({ ...dirs, ...fake, now });
  await session.run("first");
  const events: SessionEvent[] = [];
  await session.run("unchanged", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "reminder_injected")).toEqual([]);
  const before = structuredClone(session.messages);
  await session.close();
  const prefix = structuredClone(fake.contexts[1]!.messages);
  const next = fakeModel([
    fauxAssistantMessage("changed"),
    fauxAssistantMessage("removed"),
    fauxAssistantMessage("still empty"),
  ]);
  const resumed = await createSession({ ...dirs, ...next, now, resumeId: session.id });
  await stdioConfig({ instructions: "Updated instructions.", tools: ["added"] });
  events.length = 0;
  await resumed.run("changed", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(next.contexts[0]!.messages.slice(0, prefix.length)).toEqual(prefix);
  expect(resumed.messages.slice(0, before.length)).toEqual(before);
  const updates = mcpReminders(resumed);
  expect(updates).toHaveLength(2);
  expect(updates.at(-1)!.content).toContain("Updated instructions.");
  expect(updates.at(-1)!.content).toContain("mcp__local__added");
  expect(updates.at(-1)!.content).not.toContain("mcp__local__echo");
  await rm(join(dirs.homeDir, ".rukie/mcp.json"));
  events.length = 0;
  await resumed.run("removed", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(mcpReminders(resumed).at(-1)).toMatchObject({
    source: "mcp",
    content: "MCP servers: none.",
  });
  const reminderCount = mcpReminders(resumed).length;
  events.length = 0;
  await resumed.run("still empty", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "reminder_injected")).toEqual([]);
  expect(mcpReminders(resumed)).toHaveLength(reminderCount);
  await expectClosed();
});

test("bad servers emit errors and warnings while the healthy server and Run remain usable", async () => {
  dirs = await tempDirs();
  await userConfig({
    healthy: await stdioConfig(),
    missing: { command: join(dirs.cwd, "missing-command") },
    invalid: { type: "http", headers: { secret: "secret-value" } },
  });
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("mcp__healthy__echo", { text: "works" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("recovered"),
  ]);
  const events: SessionEvent[] = [];
  const warnings: string[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    allowRules: ["mcp__healthy__*"],
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });
  expect(
    (
      await session.run("continue", {
        onEvent: (event) => {
          events.push(event);
        },
      })
    ).success,
  ).toBe(true);
  expect(events[0]?.type).toBe("snapshot");
  const errors = events.filter((event) => event.type === "mcp_server_error");
  expect(errors.map((event) => event.server).sort()).toEqual(["invalid", "missing"]);
  expect(warnings).toHaveLength(2);
  expect(JSON.stringify(errors)).not.toContain("secret-value");
  expect(
    fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({
    isError: false,
    content: [{ type: "text", text: "MCP: works" }],
  });
  expect(events.at(-1)).toMatchObject({ type: "result", success: true });
  await expectClosed();
});

test.each(["untrusted", "trusted"])(
  "malformed project config is only read when %s",
  async (trust) => {
    dirs = await tempDirs();
    await userConfig({ local: await stdioConfig() });
    await Bun.write(join(dirs.cwd, ".mcp.json"), "invalid JSON");
    const fake = fakeModel([fauxAssistantMessage("done")]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      trustProjectMcp: trust === "trusted",
      onWarning: () => {},
    });
    await session.run("continue", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(events.filter((event) => event.type === "mcp_server_error")).toHaveLength(
      trust === "trusted" ? 1 : 0,
    );
    await expectClosed();
  },
);

test.each(["error", "crash"])(
  "MCP tool %s reaches the model as isError while the Run continues",
  async (tool) => {
    dirs = await tempDirs();
    await userConfig({ local: await stdioConfig({ tools: [tool] }) });
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall(`mcp__local__${tool}`, {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("recovered"),
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      onWarning: () => {},
    });
    expect(
      (
        await session.run("use tool", {
          onEvent: (event) => {
            events.push(event);
          },
        })
      ).text,
    ).toBe("recovered");
    expect(
      fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({ role: "toolResult", isError: true });
    expect(events.filter((event) => event.type === "mcp_server_error")).toHaveLength(
      tool === "crash" ? 1 : 0,
    );
    await expectClosed();
  },
);

async function waitForFile(path: string) {
  const deadline = Date.now() + 2000;
  while (!(await Bun.file(path).exists())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`);
    await Bun.sleep(10);
  }
}

test.each(["initialize", "model", "tool"])(
  "abort during %s closes all MCP processes after Session close",
  async (phase) => {
    dirs = await tempDirs();
    await userConfig({
      local: await stdioConfig({ hangInitialize: phase === "initialize", tools: ["hang"] }),
    });
    const model = abortingModel();
    const fake =
      phase === "model"
        ? model
        : fakeModel([
            fauxAssistantMessage(fauxToolCall("mcp__local__hang", {}), { stopReason: "toolUse" }),
          ]);
    const controller = new AbortController();
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      allowRules: ["mcp__local__*"],
      onWarning: () => {},
    });
    const running = session
      .run("wait", {
        signal: controller.signal,
        onEvent: async (event) => {
          events.push(event);
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    if (phase === "model") await model.started;
    else await waitForFile(join(dirs.homeDir, phase === "tool" ? "calls" : "pids"));
    controller.abort();
    expect(await running).toBeInstanceOf(Error);
    expect(events[0]?.type).toBe("snapshot");
    // Discovery cancellation precedes native request admission; admitted Runs
    // publish their terminal receipt after the native model/tool abort.
    if (phase !== "initialize")
      expect(events.at(-1)).toMatchObject({ type: "result", success: false });
    await expectClosed();
  },
);

test.each([false, true])(
  "stdio tools require permission (allowed: %s) and close after Session close",
  async (allowed) => {
    dirs = await tempDirs();
    await userConfig({ local: await stdioConfig() });
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("mcp__local__echo", { text: "hello" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      allowRules: allowed ? ["mcp__local__*"] : [],
    });
    expect(
      (
        await session.run("use MCP", {
          onEvent: async (event) => {
            events.push(event);
          },
        })
      ).text,
    ).toBe("done");
    expect(getCurrentTools(fake.contexts[0]!.messages).map((tool) => tool.name)).toContain(
      "mcp__local__echo",
    );
    expect(JSON.stringify(fake.contexts[0]!.messages)).toContain("Use echo for test messages.");
    expect(
      fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({
      role: "toolResult",
      toolName: "mcp__local__echo",
      isError: !allowed,
    });
    expect(events.filter((event) => event.type === "permission_denied")).toHaveLength(
      allowed ? 0 : 1,
    );
    expect(await Bun.file(join(dirs.homeDir, "calls")).exists()).toBe(allowed);
    if (allowed)
      expect(
        JSON.stringify(
          fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult")!.content,
        ),
      ).toContain("MCP: hello");
  },
);
