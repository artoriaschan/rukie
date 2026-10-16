import { expect, test } from "bun:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { fauxAssistantMessage, getCurrentTools } from "@earendil-works/pi-ai";
import { createMcpHost, createSession } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { mcpOAuthServer } from "../helpers/mcp-oauth-server.ts";

test("an injected MCP Host survives Session disposal and serves a later Session", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer({ authentication: false });
  const host = createMcpHost();
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    const first = await createSession({
      ...dirs,
      ...fakeModel([fauxAssistantMessage("first")]),
      mcpHost: host,
    });
    try {
      await first.run("use MCP");
      expect((await first.mcpServers()).servers).toMatchObject([
        { name: "srv", status: "connected", toolCount: 1 },
      ]);
    } finally {
      await first.close();
    }
    const fake = fakeModel([fauxAssistantMessage("later")]);
    const second = await createSession({ ...dirs, ...fake, mcpHost: host });
    try {
      expect((await second.run("use MCP again")).success).toBe(true);
      expect(getCurrentTools(fake.contexts[0]!.messages).map((tool) => tool.name)).toContain(
        "mcp__srv__echo",
      );
    } finally {
      await second.close();
    }
    expect(
      server.requests.filter(
        (request) =>
          typeof request.body === "object" &&
          request.body !== null &&
          "method" in request.body &&
          request.body.method === "initialize",
      ),
    ).toHaveLength(1);
    await host.close();
    await expect(createSession({ ...dirs, ...fakeModel([]), mcpHost: host })).rejects.toThrow(
      "MCP Host has been closed",
    );
  } finally {
    await host.close();
    await server.stop();
    await dirs.cleanup();
  }
});

test("closing an injected MCP Host shuts down active resources and rejects later Runs", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer({ authentication: false });
  const host = createMcpHost();
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    const session = await createSession({
      ...dirs,
      ...fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("unexpected")]),
      mcpHost: host,
    });
    try {
      await session.run("connect");
      await host.close();
      expect(server.requests.at(-1)?.method).toBe("DELETE");
      const requests = server.requests.length;
      await expect(session.run("Host is closed")).rejects.toThrow("MCP view has been closed");
      expect(server.requests).toHaveLength(requests);
    } finally {
      await session.close();
    }
  } finally {
    await host.close();
    await server.stop();
    await dirs.cleanup();
  }
});

test("two Sessions share global and same-project servers while different projects have their own instances", async () => {
  const dirs = await tempDirs();
  const other = await tempDirs();
  const global = mcpOAuthServer({ authentication: false });
  const project = mcpOAuthServer({ authentication: false });
  const host = createMcpHost();
  const sessions: Awaited<ReturnType<typeof createSession>>[] = [];
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { global: { url: global.url } } }),
    );
    for (const cwd of [dirs.cwd, other.cwd])
      await Bun.write(
        join(cwd, ".mcp.json"),
        JSON.stringify({ mcpServers: { project: { url: project.url } } }),
      );
    for (const cwd of [dirs.cwd, dirs.cwd, other.cwd])
      sessions.push(
        await createSession({
          ...dirs,
          cwd,
          ...fakeModel([]),
          trustProjectMcp: true,
          mcpHost: host,
        }),
      );
    const snapshots = await Promise.all(sessions.map((session) => session.mcpServers()));
    expect(snapshots.map((snapshot) => snapshot.servers.map((server) => server.name))).toEqual([
      ["global", "project"],
      ["global", "project"],
      ["global", "project"],
    ]);
    const initialized = (server: ReturnType<typeof mcpOAuthServer>) =>
      server.requests.filter(
        (request) =>
          typeof request.body === "object" &&
          request.body !== null &&
          "method" in request.body &&
          request.body.method === "initialize",
      );
    expect(initialized(global)).toHaveLength(1);
    expect(initialized(project)).toHaveLength(2);
    await sessions[0]!.close();
    expect(global.requests.some((request) => request.method === "DELETE")).toBe(false);
    expect(project.requests.some((request) => request.method === "DELETE")).toBe(false);
    await sessions[1]!.mcpServers();
    expect(initialized(project)).toHaveLength(2);
  } finally {
    await Promise.all(sessions.map((session) => session.close()));
    await host.close();
    await global.stop();
    await project.stop();
    await dirs.cleanup();
    await other.cleanup();
  }
});

test("the last project lease closes at the virtual 30 second deadline and reacquisition cancels retirement", async () => {
  const { jest } = await import("bun:test");
  const dirs = await tempDirs();
  const deleted = Promise.withResolvers<void>();
  const server = mcpOAuthServer({ authentication: false, onDelete: () => deleted.resolve() });
  const host = createMcpHost();
  const acquire = () =>
    host.acquire({
      connectOptions: () => ({ ...dirs, settings: {}, trustProjectMcp: true }),
      getRunning: () => false,
      onChange: () => {},
      onEvent: () => {},
    });
  try {
    await Bun.write(
      join(dirs.cwd, ".mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    const first = acquire();
    await first.snapshot();
    jest.useFakeTimers();
    await first.close();
    jest.advanceTimersByTime(29_999);
    expect(server.requests.some((request) => request.method === "DELETE")).toBe(false);
    const second = acquire();
    await second.snapshot();
    jest.advanceTimersByTime(1);
    expect(server.requests.some((request) => request.method === "DELETE")).toBe(false);
    await second.close();
    jest.advanceTimersByTime(29_999);
    expect(server.requests.some((request) => request.method === "DELETE")).toBe(false);
    jest.advanceTimersByTime(1);
    await deleted.promise;
    expect(server.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
  } finally {
    await host.close();
    jest.useRealTimers();
    await server.stop();
    await dirs.cleanup();
  }
});

test("a replacement signature keeps the old active call alive and management reports server busy", async () => {
  const { fauxToolCall } = await import("@earendil-works/pi-ai");
  const dirs = await tempDirs();
  const called = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const deleted = Promise.withResolvers<void>();
  const old = mcpOAuthServer({
    authentication: false,
    beforeToolResponse: async () => {
      called.resolve();
      await release.promise;
    },
    onDelete: () => deleted.resolve(),
  });
  const latest = mcpOAuthServer({ authentication: false });
  const host = createMcpHost();
  const sessions: Awaited<ReturnType<typeof createSession>>[] = [];
  try {
    const config = (url: string) =>
      Bun.write(
        join(dirs.homeDir, ".rukie/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url } } }),
      );
    await config(old.url);
    const first = await createSession({
      ...dirs,
      ...fakeModel([
        fauxAssistantMessage(fauxToolCall("mcp__srv__echo", { text: "held" }), {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("done"),
      ]),
      mcpHost: host,
      permissionMode: "full-access",
    });
    const second = await createSession({
      ...dirs,
      ...fakeModel([]),
      mcpHost: host,
      onMcpAuth: async () => ({ type: "cancelled" }),
    });
    sessions.push(first, second);
    const running = first.run("call MCP");
    await called.promise;
    for (const operation of [
      () => second.authenticateMcp("srv"),
      () => second.clearMcpAuth("srv"),
      () => second.reconnectMcp("srv"),
    ])
      await expect(operation()).rejects.toMatchObject({ code: "session-mcp-busy" });
    await config(latest.url);
    expect((await second.mcpServers()).servers).toMatchObject([
      { name: "srv", status: "connected", url: latest.url },
    ]);
    expect(old.requests.some((request) => request.method === "DELETE")).toBe(false);
    release.resolve();
    expect((await running).success).toBe(true);
    await deleted.promise;
    expect(old.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
  } finally {
    release.resolve();
    await Promise.all(sessions.map((session) => session.close()));
    await host.close();
    await old.stop();
    await latest.stop();
    await dirs.cleanup();
  }
});

test("two Sessions share one authorization and initiator cancellation reaches both waiters", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  const host = createMcpHost();
  const requested = Promise.withResolvers<AbortSignal>();
  let interactions = 0;
  const sessions: Awaited<ReturnType<typeof createSession>>[] = [];
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    for (let index = 0; index < 2; index++)
      sessions.push(
        await createSession({
          ...dirs,
          ...fakeModel([]),
          mcpHost: host,
          onMcpAuth: async (request) => {
            interactions++;
            requested.resolve(request.signal);
            return new Promise(() => {});
          },
        }),
      );
    await Promise.all(sessions.map((session) => session.mcpServers()));
    const logins = sessions.map((session) => session.authenticateMcp("srv"));
    const signal = await requested.promise;
    await sessions[0]!.close();
    expect(await Promise.all(logins)).toEqual([
      { type: "cancelled", server: "srv" },
      { type: "cancelled", server: "srv" },
    ]);
    expect(signal.aborted).toBe(true);
    expect(interactions).toBe(1);
    expect((await sessions[1]!.mcpServers()).servers[0]?.status).toBe("needs-auth");
  } finally {
    await Promise.all(sessions.map((session) => session.close()));
    await host.close();
    await server.stop();
    await dirs.cleanup();
  }
});

test("global stdio warms in home or configured cwd while project substitutions choose project instances", async () => {
  const { fileURLToPath } = await import("node:url");
  const allocated = await tempDirs();
  const second = await tempDirs();
  const dirs = {
    ...allocated,
    cwd: await realpath(allocated.cwd),
    homeDir: await realpath(allocated.homeDir),
  };
  const other = { ...second, cwd: await realpath(second.cwd) };
  const launches = join(dirs.homeDir, "launches");
  const source = fileURLToPath(new URL("../helpers/mcp-server.ts", import.meta.url));
  await Bun.write(join(dirs.homeDir, "manifest"), JSON.stringify({ tools: ["echo"] }));
  const config = {
    command: process.execPath,
    args: [source],
    env: {
      MCP_MANIFEST: join(dirs.homeDir, "manifest"),
      MCP_PIDS: join(dirs.homeDir, "pids"),
      MCP_CALLS: join(dirs.homeDir, "calls"),
      MCP_LAUNCHES: launches,
    },
  };
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({
      mcpServers: {
        home: config,
        explicit: { ...config, cwd: dirs.cwd },
        scoped: {
          ...config,
          args: [source, "${RUKIE_PROJECT_DIR}"],
          env: { ...config.env, MCP_PROJECT: "${RUKIE_PROJECT_DIR}" },
          cwd: "${RUKIE_PROJECT_DIR}",
        },
      },
    }),
  );
  await Bun.write(join(dirs.cwd, ".mcp.json"), JSON.stringify({ mcpServers: { project: config } }));
  const host = createMcpHost({ configuration: { homeDir: dirs.homeDir, settings: {} } });
  const sessions: Awaited<ReturnType<typeof createSession>>[] = [];
  const read = async () =>
    Value.Parse(
      Type.Array(
        Type.Object({
          cwd: Type.String(),
          args: Type.Array(Type.String()),
          project: Type.Optional(Type.String()),
        }),
      ),
      (await Bun.file(launches).text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    );
  try {
    await host.ready;
    expect((await read()).map((entry) => entry.cwd).sort()).toEqual(
      [dirs.cwd, dirs.homeDir].sort(),
    );
    for (const cwd of [dirs.cwd, dirs.cwd, other.cwd]) {
      const session = await createSession({
        ...dirs,
        cwd,
        ...fakeModel([]),
        trustProjectMcp: true,
        mcpHost: host,
      });
      sessions.push(session);
      await session.mcpServers();
    }
    const recorded = await read();
    expect(recorded).toHaveLength(5);
    expect(recorded.filter((entry) => entry.project !== undefined)).toEqual(
      expect.arrayContaining([
        { cwd: dirs.cwd, args: [dirs.cwd], project: dirs.cwd },
        { cwd: other.cwd, args: [other.cwd], project: other.cwd },
      ]),
    );
    expect(
      recorded.filter((entry) => entry.project === undefined && entry.cwd === dirs.cwd),
    ).toHaveLength(2);
  } finally {
    await Promise.all(sessions.map((session) => session.close()));
    await host.close();
    await dirs.cleanup();
    await other.cleanup();
  }
});

test("Host startup limits global HTTP initialization to eight concurrent servers", async () => {
  const dirs = await tempDirs();
  const eight = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let initialized = 0;
  let active = 0;
  let maximum = 0;
  const server = mcpOAuthServer({
    authentication: false,
    beforeInitialize: async () => {
      initialized++;
      active++;
      maximum = Math.max(maximum, active);
      if (initialized === 8) eight.resolve();
      await release.promise;
      active--;
    },
  });
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({
      mcpServers: Object.fromEntries(
        Array.from({ length: 9 }, (_, index) => [`srv${index}`, { url: server.url }]),
      ),
    }),
  );
  const host = createMcpHost({ configuration: { homeDir: dirs.homeDir, settings: {} } });
  try {
    await eight.promise;
    expect(initialized).toBe(8);
    release.resolve();
    await host.ready;
    expect(initialized).toBe(9);
    expect(maximum).toBe(8);
  } finally {
    release.resolve();
    await host.close();
    await server.stop();
    await dirs.cleanup();
  }
});

test("connection signatures ignore object order and replace an expanded environment value", async () => {
  const dirs = await tempDirs();
  const deleted = Promise.withResolvers<void>();
  const old = mcpOAuthServer({ authentication: false, onDelete: () => deleted.resolve() });
  const latest = mcpOAuthServer({ authentication: false });
  const previous = process.env.RUKIE_MCP_HOST_SIGNATURE_URL;
  const host = createMcpHost();
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  const path = join(dirs.homeDir, ".rukie/mcp.json");
  try {
    process.env.RUKIE_MCP_HOST_SIGNATURE_URL = old.url;
    await Bun.write(
      path,
      JSON.stringify({
        mcpServers: {
          srv: { url: "${RUKIE_MCP_HOST_SIGNATURE_URL}", headers: { first: "1", second: "2" } },
        },
      }),
    );
    session = await createSession({ ...dirs, ...fakeModel([]), mcpHost: host });
    await session.mcpServers();
    await Bun.write(
      path,
      JSON.stringify({
        mcpServers: {
          srv: { headers: { second: "2", first: "1" }, url: "${RUKIE_MCP_HOST_SIGNATURE_URL}" },
        },
      }),
    );
    await session.mcpServers();
    expect(
      old.requests.filter(
        (request) =>
          typeof request.body === "object" &&
          request.body !== null &&
          "method" in request.body &&
          request.body.method === "initialize",
      ),
    ).toHaveLength(1);
    expect(old.requests.some((request) => request.method === "DELETE")).toBe(false);
    process.env.RUKIE_MCP_HOST_SIGNATURE_URL = latest.url;
    expect((await session.mcpServers()).servers[0]?.status).toBe("connected");
    await deleted.promise;
    expect(
      latest.requests.filter(
        (request) =>
          typeof request.body === "object" &&
          request.body !== null &&
          "method" in request.body &&
          request.body.method === "initialize",
      ),
    ).toHaveLength(1);
  } finally {
    if (previous === undefined) delete process.env.RUKIE_MCP_HOST_SIGNATURE_URL;
    else process.env.RUKIE_MCP_HOST_SIGNATURE_URL = previous;
    await session?.close();
    await host.close();
    await old.stop();
    await latest.stop();
    await dirs.cleanup();
  }
});
