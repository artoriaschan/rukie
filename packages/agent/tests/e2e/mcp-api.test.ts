import { expect, test } from "bun:test";
import { join } from "node:path";
import type { McpServerView } from "@neant/shared";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { type McpAuthRequest, createSession } from "../../src/index.ts";
import { abortingModel } from "../helpers/aborting-model.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { mcpOAuthServer } from "../helpers/mcp-oauth-server.ts";

async function configure(dirs: Awaited<ReturnType<typeof tempDirs>>, servers: object) {
  await Bun.write(join(dirs.homeDir, ".neant/mcp.json"), JSON.stringify({ mcpServers: servers }));
}

test("first MCP status query independently probes servers and leaves Transcript untouched", async () => {
  const dirs = await tempDirs();
  const healthy = mcpOAuthServer({ authentication: false });
  const oauth = mcpOAuthServer();
  try {
    await configure(dirs, {
      healthy: { url: healthy.url },
      oauth: { url: oauth.url },
      broken: { command: join(dirs.cwd, "missing") },
    });
    const fake = fakeModel([fauxAssistantMessage("done")]);
    const session = await createSession({
      ...dirs,
      ...fake,
      onMcpAuth: async () => ({ type: "cancelled" }),
      onWarning: () => {},
    });
    try {
      const before = structuredClone(session.messages);
      expect(await session.mcpServers()).toEqual([
        {
          name: "broken",
          transport: "stdio",
          status: "failed",
          toolCount: 0,
          auth: "none",
          error: expect.any(String),
        },
        { name: "healthy", transport: "http", status: "connected", toolCount: 1, auth: "none" },
        { name: "oauth", transport: "http", status: "needs-auth", toolCount: 0, auth: "oauth" },
      ]);
      expect(session.messages).toEqual(before);
      expect(fake.contexts).toEqual([]);
      expect(healthy.requests.at(-1)?.method).toBe("DELETE");
      const requestCount = healthy.requests.length;
      await session.mcpServers();
      expect(healthy.requests).toHaveLength(requestCount);
    } finally {
      await session.dispose();
    }
  } finally {
    await healthy.stop();
    await oauth.stop();
    await dirs.cleanup();
  }
});

test("Session login returns its outcome, updates status and makes tools available to the next Run", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await configure(dirs, { srv: { url: server.url } });
    const fake = fakeModel([fauxAssistantMessage("done")]);
    const session = await createSession({
      ...dirs,
      ...fake,
      onMcpAuth: async ({ authorizationUrl }) => {
        const response = await fetch(authorizationUrl, { redirect: "manual" });
        const url = response.headers.get("location");
        if (!url) throw new Error("Missing callback");
        return { type: "callback-url", url };
      },
    });
    try {
      expect(await session.authenticateMcp("srv")).toEqual({
        type: "authenticated",
        server: "srv",
      });
      expect(await session.mcpServers()).toEqual([
        { name: "srv", transport: "http", status: "connected", toolCount: 1, auth: "oauth" },
      ]);
      expect(fake.contexts).toEqual([]);
      await session.run("use MCP");
      expect(JSON.stringify(fake.contexts[0]!.messages)).toContain("mcp__srv__echo");
      expect(JSON.stringify(fake.contexts[0]!.messages)).not.toContain("mcp__srv__authenticate");
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("logout deletes only the selected credential and status returns to needs-auth", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await configure(dirs, { srv: { url: server.url }, other: { url: server.url } });
    const session = await createSession({
      ...dirs,
      ...fakeModel([fauxAssistantMessage("done")]),
      onMcpAuth: async ({ authorizationUrl }) => {
        const response = await fetch(authorizationUrl, { redirect: "manual" });
        const url = response.headers.get("location");
        if (!url) throw new Error("Missing callback");
        return { type: "callback-url", url };
      },
    });
    try {
      await session.authenticateMcp("srv");
      await session.authenticateMcp("other");
      await session.mcpServers();
      await session.clearMcpAuth("srv");
      const raw = await Bun.file(join(dirs.homeDir, ".neant/credentials.json")).text();
      expect(raw).not.toContain('"serverName":"srv"');
      expect(raw).toContain('"serverName":"other"');
      expect((await session.mcpServers()).find((view) => view.name === "srv")).toEqual({
        name: "srv",
        transport: "http",
        status: "needs-auth",
        toolCount: 0,
        auth: "oauth",
      });
      const unauthenticatedRequests = server.requests.filter(
        (request) => request.path === "/mcp" && request.authorization === null,
      ).length;
      await session.run("check");
      expect(
        server.requests.filter(
          (request) => request.path === "/mcp" && request.authorization === null,
        ).length,
      ).toBeGreaterThan(unauthenticatedRequests);
      expect((await session.mcpServers()).find((view) => view.name === "srv")?.status).toBe(
        "needs-auth",
      );
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("reconnect refreshes the selected failed server without probing other cached servers", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer({ authentication: false });
  const other = mcpOAuthServer({ authentication: false });
  try {
    await configure(dirs, {
      srv: { command: join(dirs.cwd, "missing") },
      other: { url: other.url },
    });
    const session = await createSession({ ...dirs, ...fakeModel([]), onWarning: () => {} });
    try {
      expect((await session.mcpServers()).find((view) => view.name === "srv")?.status).toBe(
        "failed",
      );
      const requests = other.requests.length;
      await configure(dirs, {
        srv: { url: server.url, headers: { Authorization: "Bearer configured" } },
        other: { url: other.url },
      });
      await session.reconnectMcp("srv");
      expect((await session.mcpServers()).find((view) => view.name === "srv")).toEqual({
        name: "srv",
        transport: "http",
        status: "connected",
        toolCount: 1,
        auth: "headers",
      });
      expect(other.requests).toHaveLength(requests);
      expect(server.requests.at(-1)?.method).toBe("DELETE");
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await other.stop();
    await dirs.cleanup();
  }
});

test("a delayed status probe adopts a newer Run snapshot", async () => {
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
  const latest = mcpOAuthServer();
  try {
    await configure(dirs, { old: { url: old.url } });
    const session = await createSession({
      ...dirs,
      ...fakeModel([fauxAssistantMessage("done")]),
      onWarning: () => {},
    });
    try {
      const probe = session.mcpServers();
      await started.promise;
      await configure(dirs, { latest: { url: latest.url } });
      await session.run("check new configuration");
      const expected: McpServerView[] = [
        { name: "latest", transport: "http", status: "needs-auth", toolCount: 0, auth: "oauth" },
      ];
      expect(await session.mcpServers()).toEqual(expected);
      release.resolve();
      expect(await probe).toEqual(expected);
      expect(await session.mcpServers()).toEqual(expected);
    } finally {
      release.resolve();
      await session.dispose();
    }
  } finally {
    await old.stop();
    await latest.stop();
    await dirs.cleanup();
  }
});

test("MCP management rejects during a Run while recorded status remains readable", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer({ authentication: false });
  try {
    await configure(dirs, { srv: { url: server.url } });
    const fake = abortingModel();
    const session = await createSession({ ...dirs, ...fake });
    const controller = new AbortController();
    const running = session.run("wait", { signal: controller.signal });
    try {
      await fake.started;
      const requests = server.requests.length;
      for (const operation of [
        () => session.authenticateMcp("srv"),
        () => session.clearMcpAuth("srv"),
        () => session.reconnectMcp("srv"),
      ])
        await expect(operation()).rejects.toMatchObject({ code: "session-run-active" });
      expect(await session.mcpServers()).toEqual([
        { name: "srv", transport: "http", status: "connected", toolCount: 1, auth: "none" },
      ]);
      expect(server.requests).toHaveLength(requests);
    } finally {
      controller.abort();
      await running.catch(() => {});
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("unsupported authentication and unknown server operations fail without probing transports", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await configure(dirs, { srv: { url: server.url }, local: { command: "missing" } });
    const unsupported = await createSession({ ...dirs, ...fakeModel([]) });
    try {
      await expect(unsupported.authenticateMcp("srv")).rejects.toMatchObject({
        code: "mcp-auth-callback-required",
        params: {},
      });
      expect(server.requests).toEqual([]);
    } finally {
      await unsupported.dispose();
    }
    const interactive = await createSession({
      ...dirs,
      ...fakeModel([]),
      onMcpAuth: async () => ({ type: "cancelled" }),
    });
    try {
      await expect(interactive.authenticateMcp("local")).rejects.toMatchObject({
        code: "mcp-auth-http-required",
        params: { server: "local" },
      });
      await expect(interactive.authenticateMcp("missing")).rejects.toMatchObject({
        code: "mcp-unknown-server",
        params: { server: "missing" },
      });
      await expect(interactive.clearMcpAuth("missing")).rejects.toThrow("Unknown MCP server");
      await expect(interactive.reconnectMcp("missing")).rejects.toThrow("Unknown MCP server");
      expect(server.requests).toEqual([]);
    } finally {
      await interactive.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("pending Session login excludes Run and other management, and dispose cancels its Interaction", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  const requested = Promise.withResolvers<McpAuthRequest>();
  try {
    await configure(dirs, { srv: { url: server.url } });
    const fake = fakeModel([]);
    const session = await createSession({
      ...dirs,
      ...fake,
      onMcpAuth: (request) => {
        requested.resolve(request);
        return new Promise(() => {});
      },
    });
    try {
      const login = session.authenticateMcp("srv");
      const request = await requested.promise;
      await expect(session.run("must wait")).rejects.toMatchObject({ code: "session-mcp-busy" });
      await expect(session.clearMcpAuth("srv")).rejects.toMatchObject({ code: "session-mcp-busy" });
      await expect(session.reconnectMcp("srv")).rejects.toMatchObject({ code: "session-mcp-busy" });
      await session.dispose();
      expect(await login).toEqual({ type: "cancelled", server: "srv" });
      expect(request.signal?.aborted).toBe(true);
      expect(fake.contexts).toEqual([]);
      await expect(session.mcpServers()).rejects.toThrow("disposed");
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("cancelled manual login keeps the cached needs-auth status", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await configure(dirs, { srv: { url: server.url } });
    const session = await createSession({
      ...dirs,
      ...fakeModel([]),
      onMcpAuth: async () => ({ type: "cancelled" }),
    });
    try {
      const before = await session.mcpServers();
      expect(await session.authenticateMcp("srv")).toEqual({ type: "cancelled", server: "srv" });
      expect(await session.mcpServers()).toEqual(before);
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("manual login delivers Notification even when the frontend immediately dismisses", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  const notified = Promise.withResolvers<unknown>();
  const hook = Bun.serve({
    port: 0,
    async fetch(request) {
      notified.resolve(await request.json());
      return Response.json({});
    },
  });
  try {
    await configure(dirs, { srv: { url: server.url } });
    const session = await createSession({
      ...dirs,
      ...fakeModel([]),
      onMcpAuth: async () => ({ type: "cancelled" }),
      settings: {
        hooks: {
          Notification: [{ matcher: "mcp_auth", hooks: [{ type: "http", url: hook.url.href }] }],
        },
      },
    });
    try {
      const before = structuredClone(session.messages);
      await session.authenticateMcp("srv");
      expect(await notified.promise).toMatchObject({
        hook_event_name: "Notification",
        notification_type: "mcp_auth",
        message: "MCP server srv needs authorization",
        session_id: session.id,
      });
      expect(session.messages).toEqual(before);
    } finally {
      await session.dispose();
    }
  } finally {
    await hook.stop(true);
    await server.stop();
    await dirs.cleanup();
  }
});

test("disposing during an independent probe closes it before a delayed initialize replies", async () => {
  const dirs = await tempDirs();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const server = mcpOAuthServer({
    authentication: false,
    beforeInitialize: async () => {
      started.resolve();
      await release.promise;
    },
  });
  try {
    await configure(dirs, { srv: { url: server.url } });
    const session = await createSession({ ...dirs, ...fakeModel([]) });
    try {
      const probe = session.mcpServers();
      const failure = probe.then(
        () => false,
        () => true,
      );
      await started.promise;
      await session.dispose();
      expect(await failure).toBe(true);
    } finally {
      release.resolve();
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("clearing absent OAuth credentials preserves a connected server using configured headers", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer({ authentication: false });
  try {
    await configure(dirs, {
      srv: { url: server.url, headers: { Authorization: "Bearer configured" } },
    });
    const session = await createSession({ ...dirs, ...fakeModel([]) });
    try {
      const before = await session.mcpServers();
      const requests = server.requests.length;
      await session.clearMcpAuth("srv");
      expect(await session.mcpServers()).toEqual(before);
      expect(server.requests).toHaveLength(requests);
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("known MCP configuration errors retain typed metadata through a probe and management operation", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await configure(dirs, {
      srv: {
        url: server.url,
        oauth: { authServerMetadataUrl: "http://authorization.example/metadata" },
      },
    });
    const session = await createSession({
      ...dirs,
      ...fakeModel([]),
      onMcpAuth: async () => ({ type: "cancelled" }),
      onWarning: () => {},
    });
    try {
      expect((await session.mcpServers())[0]).toMatchObject({
        status: "failed",
        errorData: { code: "mcp-config-metadata-https", params: {} },
      });
      await expect(session.authenticateMcp("srv")).rejects.toMatchObject({
        code: "mcp-config-metadata-https",
        params: {},
      });
      expect(server.requests).toEqual([]);
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});
