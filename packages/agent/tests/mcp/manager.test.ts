import { expect, test } from "bun:test";
import { join } from "node:path";
import { createMcpAuthState, createMcpConnections, createMcpManager } from "../../src/mcp/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { mcpOAuthServer } from "../helpers/mcp-oauth-server.ts";

test("status probes close their transport and cache immutable facts without reconnecting", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer({ authentication: false });
  const auth = createMcpAuthState();
  const changes: unknown[] = [];
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
  );
  const manager = createMcpManager({
    createConnections: () => createMcpConnections(auth),
    connectOptions: () => ({ ...dirs, settings: {}, onWarning: () => {} }),
    getRunning: () => false,
    onChange: (snapshot) => changes.push(snapshot),
  });
  try {
    const snapshot = await manager.snapshot();
    expect(snapshot.servers[0]).toMatchObject({ name: "srv", status: "connected", toolCount: 1 });
    expect(server.requests.some((request) => request.method === "DELETE")).toBe(true);
    const requests = server.requests.length;
    snapshot.servers[0]!.tools.length = 0;
    expect((await manager.snapshot()).servers[0]!.tools).toHaveLength(1);
    expect(server.requests).toHaveLength(requests);
    expect(changes).toHaveLength(1);
  } finally {
    await manager.close();
    await server.stop();
    await dirs.cleanup();
  }
});

test("a native runtime snapshot wins over an older independent transport probe", async () => {
  const dirs = await tempDirs();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const old = mcpOAuthServer({
    authentication: false,
    beforeInitialize: async () => {
      started.resolve();
      await release.promise;
    },
  });
  const latest = mcpOAuthServer({ authentication: false });
  const auth = createMcpAuthState();
  const changes: unknown[] = [];
  const connect = { ...dirs, settings: {}, onWarning: () => {} };
  const manager = createMcpManager({
    createConnections: () => createMcpConnections(auth),
    connectOptions: () => connect,
    getRunning: () => false,
    onChange: (snapshot) => changes.push(snapshot),
  });
  const runtime = createMcpConnections(auth);
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { old: { url: old.url } } }),
    );
    const pending = manager.snapshot();
    await started.promise;
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { latest: { url: latest.url } } }),
    );
    await runtime.connect(connect);
    manager.adopt(runtime.snapshot());
    release.resolve();
    expect((await pending).servers.map((server) => server.name)).toEqual(["latest"]);
    expect((await manager.snapshot()).servers.map((server) => server.name)).toEqual(["latest"]);
    expect(changes).toHaveLength(1);
  } finally {
    release.resolve();
    await Promise.all([manager.close(), runtime.close()]);
    await Promise.all([old.stop(), latest.stop()]);
    await dirs.cleanup();
  }
});

test("close cancels a held management interaction and preserves its cancelled outcome", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  const requested = Promise.withResolvers<void>();
  const auth = createMcpAuthState();
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
  );
  const manager = createMcpManager({
    createConnections: () => createMcpConnections(auth),
    connectOptions: () => ({
      ...dirs,
      settings: {},
      interactive: true,
      onMcpAuth: async (request) => {
        requested.resolve();
        return await new Promise<{ type: "cancelled" }>((resolve) =>
          request.signal.addEventListener("abort", () => resolve({ type: "cancelled" }), {
            once: true,
          }),
        );
      },
    }),
    getRunning: () => false,
    onChange: () => {},
  });
  try {
    const login = manager.authenticate("srv");
    await requested.promise;
    expect(manager.busy).toBe(true);
    const closed = manager.close();
    expect(await login).toEqual({ type: "cancelled", server: "srv" });
    await closed;
    await expect(manager.snapshot()).rejects.toThrow("closed");
  } finally {
    await manager.close();
    await server.stop();
    await dirs.cleanup();
  }
});

test("manual authentication refreshes a runtime's cached authentication declaration", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  const auth = createMcpAuthState();
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
  );
  const options = {
    ...dirs,
    settings: {},
    interactive: true,
    onMcpAuth: async ({ authorizationUrl }: { authorizationUrl: string }) => {
      const response = await fetch(authorizationUrl, { redirect: "manual" });
      const url = response.headers.get("location");
      if (!url) throw new Error("Missing callback");
      return { type: "callback-url" as const, url };
    },
  };
  const runtime = createMcpConnections(auth);
  const manager = createMcpManager({
    createConnections: () => createMcpConnections(auth),
    connectOptions: () => options,
    getRunning: () => false,
    onChange: () => {},
  });
  try {
    await runtime.connect(options);
    expect(runtime.snapshot().servers[0]?.status).toBe("needs-auth");
    manager.adopt(runtime.snapshot());
    expect(await manager.authenticate("srv")).toEqual({ type: "authenticated", server: "srv" });
    await runtime.connect(options);
    expect(runtime.snapshot().servers[0]).toMatchObject({ status: "connected", toolCount: 1 });
    expect(runtime.authTools.size).toBe(0);
  } finally {
    await Promise.all([manager.close(), runtime.close()]);
    await server.stop();
    await dirs.cleanup();
  }
});

test("unsupported and unknown management errors are typed before any server transport opens", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  const auth = createMcpAuthState();
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
  );
  const manager = createMcpManager({
    createConnections: () => createMcpConnections(auth),
    connectOptions: () => ({ ...dirs, settings: {} }),
    getRunning: () => false,
    onChange: () => {},
  });
  try {
    await expect(manager.authenticate("srv")).rejects.toMatchObject({
      code: "mcp-auth-callback-required",
      params: {},
    });
    await expect(manager.reconnect("missing")).rejects.toMatchObject({
      code: "mcp-unknown-server",
      params: { server: "missing" },
    });
    expect(server.requests).toEqual([]);
  } finally {
    await manager.close();
    await server.stop();
    await dirs.cleanup();
  }
});
