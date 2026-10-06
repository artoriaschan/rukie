import { expect, test } from "bun:test";
import { join } from "node:path";
import { fauxAssistantMessage, getCurrentTools } from "@earendil-works/pi-ai";
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
      expect((await session.mcpServers()).servers).toMatchObject([
        {
          name: "broken",
          transport: "stdio",
          status: "failed",
          toolCount: 0,
          auth: "none",
          scope: "user",
          configPath: join(dirs.homeDir, ".neant/mcp.json"),
          command: join(dirs.cwd, "missing"),
          tools: [],
          error: expect.any(String),
        },
        {
          name: "healthy",
          transport: "http",
          status: "connected",
          toolCount: 1,
          auth: "none",
          scope: "user",
          configPath: join(dirs.homeDir, ".neant/mcp.json"),
          url: healthy.url,
          tools: [
            {
              name: "echo",
              description: "Echo an authorized message",
              inputSchema: { type: "object", properties: { text: { type: "string" } } },
            },
          ],
        },
        {
          name: "oauth",
          transport: "http",
          status: "needs-auth",
          toolCount: 0,
          auth: "oauth",
          scope: "user",
          configPath: join(dirs.homeDir, ".neant/mcp.json"),
          url: oauth.url,
          tools: [],
        },
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
      expect((await session.mcpServers()).servers).toMatchObject([
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
      expect(
        (await session.mcpServers()).servers.find((view) => view.name === "srv"),
      ).toMatchObject({
        name: "srv",
        transport: "http",
        status: "needs-auth",
        toolCount: 0,
        auth: "oauth",
        scope: "user",
        configPath: join(dirs.homeDir, ".neant/mcp.json"),
        url: server.url,
        tools: [],
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
      expect((await session.mcpServers()).servers.find((view) => view.name === "srv")?.status).toBe(
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
      expect((await session.mcpServers()).servers.find((view) => view.name === "srv")?.status).toBe(
        "failed",
      );
      const requests = other.requests.length;
      await configure(dirs, {
        srv: { url: server.url, headers: { Authorization: "Bearer configured" } },
        other: { url: other.url },
      });
      await session.reconnectMcp("srv");
      expect(
        (await session.mcpServers()).servers.find((view) => view.name === "srv"),
      ).toMatchObject({
        name: "srv",
        transport: "http",
        status: "connected",
        toolCount: 1,
        auth: "headers",
        scope: "user",
        configPath: join(dirs.homeDir, ".neant/mcp.json"),
        url: server.url,
        tools: [{ name: "echo" }],
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
      const expected = [
        { name: "latest", transport: "http", status: "needs-auth", toolCount: 0, auth: "oauth" },
      ];
      expect((await session.mcpServers()).servers).toMatchObject(expected);
      release.resolve();
      expect((await probe).servers).toMatchObject(expected);
      expect((await session.mcpServers()).servers).toMatchObject(expected);
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
      expect((await session.mcpServers()).servers).toMatchObject([
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
      expect((await session.mcpServers()).servers[0]).toMatchObject({
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

test("MCP snapshot exposes effective configuration and original tools without sharing mutable data", async () => {
  const dirs = await tempDirs();
  const user = mcpOAuthServer({ authentication: false });
  const project = mcpOAuthServer({ authentication: false });
  try {
    await configure(dirs, { srv: { url: user.url } });
    await Bun.write(
      join(dirs.cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          srv: { url: project.url, headers: { Authorization: "Bearer private-header" } },
        },
      }),
    );
    const session = await createSession({ ...dirs, ...fakeModel([]), trustProjectMcp: true });
    try {
      const snapshot = await session.mcpServers();
      expect(snapshot).toEqual({
        configErrors: [],
        servers: [
          {
            name: "srv",
            transport: "http",
            status: "connected",
            toolCount: 1,
            auth: "headers",
            scope: "project",
            configPath: join(dirs.cwd, ".mcp.json"),
            url: project.url,
            tools: [
              {
                name: "echo",
                description: "Echo an authorized message",
                inputSchema: { type: "object", properties: { text: { type: "string" } } },
              },
            ],
          },
        ],
      });
      expect(user.requests).toEqual([]);
      const count = project.requests.length;
      snapshot.servers[0]!.tools[0]!.inputSchema = { changed: true };
      snapshot.servers[0]!.tools[0]!.name = "changed";
      expect((await session.mcpServers()).servers[0]!.tools[0]).toEqual({
        name: "echo",
        description: "Echo an authorized message",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
      });
      expect(project.requests).toHaveLength(count);
      expect(JSON.stringify(await session.mcpServers())).not.toContain("private-header");
    } finally {
      await session.dispose();
    }
  } finally {
    await user.stop();
    await project.stop();
    await dirs.cleanup();
  }
});

test.each([false, true])("MCP provenance respects project trust (%s)", async (trusted) => {
  const dirs = await tempDirs();
  const user = mcpOAuthServer({ authentication: false });
  const project = mcpOAuthServer({ authentication: false });
  try {
    await configure(dirs, {
      srv: { url: user.url },
      local: { command: "missing-command", args: ["private-arg"], env: { TOKEN: "private-env" } },
    });
    await Bun.write(
      join(dirs.cwd, ".mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: project.url }, project: { url: project.url } } }),
    );
    const session = await createSession({ ...dirs, ...fakeModel([]), trustProjectMcp: trusted });
    try {
      const snapshot = await session.mcpServers();
      expect(snapshot.servers.find((server) => server.name === "srv")).toMatchObject({
        scope: trusted ? "project" : "user",
        configPath: trusted ? join(dirs.cwd, ".mcp.json") : join(dirs.homeDir, ".neant/mcp.json"),
        url: trusted ? project.url : user.url,
      });
      expect(snapshot.servers.some((server) => server.name === "project")).toBe(trusted);
      expect(snapshot.servers.find((server) => server.name === "local")).toMatchObject({
        command: "missing-command",
        scope: "user",
        tools: [],
        toolCount: 0,
        status: "failed",
      });
      expect(JSON.stringify(snapshot)).not.toContain("private-arg");
      expect(JSON.stringify(snapshot)).not.toContain("private-env");
      expect(trusted ? user.requests : project.requests).toEqual([]);
    } finally {
      await session.dispose();
    }
  } finally {
    await user.stop();
    await project.stop();
    await dirs.cleanup();
  }
});

test.each([
  [
    "https://user:password@example.com/mcp?token=private-query#private-fragment",
    "https://example.com/mcp",
  ],
  ["${NEANT_PANEL_ENDPOINT}", "${NEANT_PANEL_ENDPOINT}"],
  [
    "${NEANT_PANEL_ENDPOINT:-https://user:password@example.com/mcp?token=private-query#private-fragment}",
    "${NEANT_PANEL_ENDPOINT:-https://example.com/mcp}",
  ],
  [
    "https://${NEANT_PANEL_HOST}/mcp?token=${NEANT_PANEL_TOKEN}#private-fragment",
    "https://${NEANT_PANEL_HOST}/mcp",
  ],
])("MCP display URL redacts secrets in raw configuration %s", async (url, displayed) => {
  const dirs = await tempDirs();
  try {
    await configure(dirs, {
      srv: {
        url,
        oauth: { clientSecret: "private-client", authServerMetadataUrl: "http://invalid" },
      },
    });
    const session = await createSession({ ...dirs, ...fakeModel([]), onWarning: () => {} });
    try {
      const snapshot = await session.mcpServers();
      expect(snapshot.servers[0]).toMatchObject({
        url: displayed,
        status: "failed",
        tools: [],
        toolCount: 0,
        scope: "user",
        configPath: join(dirs.homeDir, ".neant/mcp.json"),
      });
      expect(JSON.stringify(snapshot)).not.toMatch(
        /password|private-query|private-fragment|private-client/,
      );
    } finally {
      await session.dispose();
    }
  } finally {
    await dirs.cleanup();
  }
});

test.each(["{", '{"other":{}}'])(
  "file-level MCP errors remain diagnosable while a valid source serves tools (%s)",
  async (invalid) => {
    const dirs = await tempDirs();
    const server = mcpOAuthServer({ authentication: false });
    try {
      const path = join(dirs.homeDir, ".neant/mcp.json");
      await Bun.write(path, invalid);
      await Bun.write(
        join(dirs.cwd, ".mcp.json"),
        JSON.stringify({ mcpServers: { project: { url: server.url } } }),
      );
      const fake = fakeModel([fauxAssistantMessage("done")]);
      const warnings: string[] = [];
      const session = await createSession({
        ...dirs,
        ...fake,
        trustProjectMcp: true,
        onWarning: (message) => warnings.push(message),
      });
      try {
        const snapshot = await session.mcpServers();
        expect(snapshot.servers.map((view) => view.name)).toEqual(["project"]);
        expect(snapshot.configErrors).toMatchObject([
          { scope: "user", path, error: expect.any(String) },
        ]);
        if (invalid !== "{")
          expect(snapshot.configErrors[0]?.errorData).toEqual({
            code: "mcp-config-file-invalid",
            params: { source: path },
          });
        snapshot.configErrors[0]!.error = "modified";
        expect((await session.mcpServers()).configErrors[0]?.error).not.toBe("modified");
        const result = await session.run("continue with valid MCP", {
          onEvent: (event) => {
            if (event.type === "session_start") expect(event.tools).toContain("mcp__project__echo");
          },
        });
        expect(result.success).toBe(true);
        expect(warnings).toContainEqual(expect.stringContaining(`MCP server ${path}:`));
        expect((await session.mcpServers()).configErrors).toHaveLength(1);
      } finally {
        await session.dispose();
      }
    } finally {
      await server.stop();
      await dirs.cleanup();
    }
  },
);

test("missing MCP files are a normal empty snapshot and untrusted malformed project files stay invisible", async () => {
  const dirs = await tempDirs();
  try {
    await Bun.write(join(dirs.cwd, ".mcp.json"), "{");
    const session = await createSession({ ...dirs, ...fakeModel([]) });
    try {
      expect(await session.mcpServers()).toEqual({ servers: [], configErrors: [] });
    } finally {
      await session.dispose();
    }
  } finally {
    await dirs.cleanup();
  }
});

test("MCP tool details preserve nested JSON Schema and an absent description independently of model declarations", async () => {
  const dirs = await tempDirs();
  const inputSchema = {
    type: "object",
    properties: { records: { type: "array", items: { $ref: "#/$defs/record" } } },
    $defs: { record: { oneOf: [{ type: "string", enum: ["literal"] }, { type: "null" }] } },
    additionalProperties: false,
  };
  const server = mcpOAuthServer({
    authentication: false,
    tools: [{ name: "raw-tool", inputSchema }],
  });
  try {
    await configure(dirs, { srv: { url: server.url } });
    const fake = abortingModel();
    let declarations: ReturnType<typeof getCurrentTools> = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      streamFn: (model, context, options) => {
        declarations = getCurrentTools(context.messages);
        return fake.streamFn(model, context, options);
      },
    });
    const controller = new AbortController();
    const running = session.run("wait", { signal: controller.signal });
    try {
      await fake.started;
      const snapshot = await session.mcpServers();
      expect(snapshot.servers[0]?.tools).toEqual([
        { name: "raw-tool", description: "", inputSchema },
      ]);
      const declaration = structuredClone(
        declarations.find((tool) => tool.name === "mcp__srv__raw-tool"),
      );
      expect(declaration?.parameters).toEqual(inputSchema);
      const returnedSchema = snapshot.servers[0]!.tools[0]!.inputSchema;
      if (typeof returnedSchema !== "object" || returnedSchema === null)
        throw new Error("Expected the server's object JSON Schema.");
      Object.assign(returnedSchema, { type: "poisoned" });
      expect(declarations.find((tool) => tool.name === "mcp__srv__raw-tool")).toEqual(declaration);
      expect((await session.mcpServers()).servers[0]?.tools).toEqual([
        { name: "raw-tool", description: "", inputSchema },
      ]);
      expect(
        server.requests.filter(
          (request) =>
            request.body &&
            typeof request.body === "object" &&
            "method" in request.body &&
            request.body.method === "tools/list",
        ),
      ).toHaveLength(1);
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
