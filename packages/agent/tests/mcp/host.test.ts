import { expect, test } from "bun:test";
import { join } from "node:path";
import { createMcpHost } from "../../src/mcp/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { mcpOAuthServer } from "../helpers/mcp-oauth-server.ts";

test("Host status snapshots retain their transport and expose immutable facts without reconnecting", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer({ authentication: false });
  const host = createMcpHost();
  const changes: unknown[] = [];
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
  );
  const view = host.acquire({
    onEvent: () => {},
    connectOptions: () => ({ ...dirs, settings: {}, onWarning: () => {} }),
    getRunning: () => false,
    onChange: (snapshot) => changes.push(snapshot),
  });
  try {
    const snapshot = await view.snapshot();
    expect(snapshot.servers[0]).toMatchObject({ name: "srv", status: "connected", toolCount: 1 });
    expect(server.requests.some((request) => request.method === "DELETE")).toBe(false);
    const requests = server.requests.length;
    snapshot.servers[0]!.tools.length = 0;
    expect((await view.snapshot()).servers[0]!.tools).toHaveLength(1);
    expect(server.requests).toHaveLength(requests);
    expect(changes).toHaveLength(1);
  } finally {
    await view.close();
    await host.close();
    await server.stop();
    await dirs.cleanup();
  }
});

test("a newer project view configuration wins over an earlier pending status query", async () => {
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
  const host = createMcpHost();
  const changes: unknown[] = [];
  const connect = { ...dirs, settings: {}, onWarning: () => {} };
  const view = host.acquire({
    onEvent: () => {},
    connectOptions: () => connect,
    getRunning: () => false,
    onChange: (snapshot) => changes.push(snapshot),
  });
  const otherView = host.acquire({
    connectOptions: () => connect,
    getRunning: () => false,
    onEvent: () => {},
    onChange: () => {},
  });
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { old: { url: old.url } } }),
    );
    const pending = view.snapshot();
    await started.promise;
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { latest: { url: latest.url } } }),
    );
    await otherView.prepareRun();
    release.resolve();
    expect((await pending).servers.map((server) => server.name)).toEqual(["latest"]);
    expect((await view.snapshot()).servers.map((server) => server.name)).toEqual(["latest"]);
    expect(changes).toHaveLength(1);
  } finally {
    release.resolve();
    await Promise.all([view.close(), otherView.close()]);
    await host.close();
    await Promise.all([old.stop(), latest.stop()]);
    await dirs.cleanup();
  }
});

test("close cancels a held management interaction and preserves its cancelled outcome", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  const requested = Promise.withResolvers<void>();
  const host = createMcpHost();
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
  );
  const view = host.acquire({
    onEvent: () => {},
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
    const login = view.authenticate("srv");
    await requested.promise;
    expect(view.busy).toBe(true);
    const closed = view.close();
    expect(await login).toEqual({ type: "cancelled", server: "srv" });
    await closed;
    await expect(view.snapshot()).rejects.toThrow("closed");
  } finally {
    await view.close();
    await host.close();
    await server.stop();
    await dirs.cleanup();
  }
});

test("manual authentication updates another view authentication declaration", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  const host = createMcpHost();
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
  const otherView = host.acquire({
    connectOptions: () => options,
    getRunning: () => false,
    onEvent: () => {},
    onChange: () => {},
  });
  const view = host.acquire({
    onEvent: () => {},
    connectOptions: () => options,
    getRunning: () => false,
    onChange: () => {},
  });
  try {
    await otherView.prepareRun();
    expect((await otherView.snapshot()).servers[0]?.status).toBe("needs-auth");
    expect(await view.authenticate("srv")).toEqual({ type: "authenticated", server: "srv" });
    await otherView.prepareRun();
    expect((await otherView.snapshot()).servers[0]).toMatchObject({
      status: "connected",
      toolCount: 1,
    });
    expect(otherView.authTools.size).toBe(0);
  } finally {
    await Promise.all([view.close(), otherView.close()]);
    await host.close();
    await server.stop();
    await dirs.cleanup();
  }
});

test("unsupported and unknown management errors are typed before any server transport opens", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  const host = createMcpHost();
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
  );
  const view = host.acquire({
    onEvent: () => {},
    connectOptions: () => ({ ...dirs, settings: {} }),
    getRunning: () => false,
    onChange: () => {},
  });
  try {
    await expect(view.authenticate("srv")).rejects.toMatchObject({
      code: "mcp-auth-callback-required",
      params: {},
    });
    await expect(view.reconnect("missing")).rejects.toMatchObject({
      code: "mcp-unknown-server",
      params: { server: "missing" },
    });
    expect(server.requests).toEqual([]);
  } finally {
    await view.close();
    await host.close();
    await server.stop();
    await dirs.cleanup();
  }
});
