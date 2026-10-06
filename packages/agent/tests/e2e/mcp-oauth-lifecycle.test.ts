import { expect, test } from "bun:test";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import {
  createSession,
  type McpAuthRequest,
  type McpAuthReply,
  type SessionEvent,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { mcpOAuthServer } from "../helpers/mcp-oauth-server.ts";

async function paste({ authorizationUrl }: McpAuthRequest): Promise<McpAuthReply> {
  const response = await fetch(authorizationUrl, { redirect: "manual" });
  const url = response.headers.get("location");
  if (!url) throw new Error("Authorization fixture did not provide a callback.");
  return { type: "callback-url", url };
}

async function configure(dirs: Awaited<ReturnType<typeof tempDirs>>, servers: object) {
  await Bun.write(join(dirs.homeDir, ".neant/mcp.json"), JSON.stringify({ mcpServers: servers }));
}

async function login(dirs: Awaited<ReturnType<typeof tempDirs>>) {
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("signed in"),
    ]),
    onMcpAuth: paste,
  });
  try {
    await session.run("sign in");
  } finally {
    await session.dispose();
  }
}

test.each([false, true])(
  "expired access token refreshes automatically (refresh revoked: %s)",
  async (revoked) => {
    const dirs = await tempDirs();
    const server = mcpOAuthServer();
    try {
      await configure(dirs, { srv: { url: server.url } });
      await login(dirs);
      server.invalidateAccessToken();
      if (revoked) server.rejectRefresh();
      const fake = fakeModel([
        ...(revoked
          ? []
          : [fauxAssistantMessage(fauxToolCall("mcp__srv__echo", {}), { stopReason: "toolUse" })]),
        fauxAssistantMessage("done"),
      ]);
      const events: SessionEvent[] = [];
      const session = await createSession({
        ...dirs,
        ...fake,
        permissionMode: "full-access",
        onMcpAuth: paste,
        onWarning: () => {},
      });
      try {
        expect(
          (
            await session.run("continue", {
              onEvent: (event) => {
                events.push(event);
              },
            })
          ).text,
        ).toBe("done");
        expect(
          getCurrentTools(fake.contexts[0]!.messages)
            .filter((tool) => tool.name.startsWith("mcp__"))
            .map((tool) => tool.name),
        ).toEqual([revoked ? "mcp__srv__authenticate" : "mcp__srv__echo"]);
        expect(
          server.requests.filter(
            (request) =>
              request.path === "/token" && JSON.stringify(request.body).includes("refresh_token"),
          ),
        ).toHaveLength(1);
        expect(events.filter((event) => event.type === "mcp_server_error")).toEqual([]);
        expect(events.filter((event) => event.type === "mcp_auth_required")).toHaveLength(
          Number(revoked),
        );
        if (!revoked)
          expect(
            fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
          ).toMatchObject({
            isError: false,
            content: [{ type: "text", text: "OAuth MCP: called" }],
          });
      } finally {
        await session.dispose();
      }
    } finally {
      await server.stop();
      await dirs.cleanup();
    }
  },
);

test.each([false, true])(
  "revoked authorization during a tool removes real tools before the next Turn (interactive: %s)",
  async (interactive) => {
    const dirs = await tempDirs();
    const server = mcpOAuthServer();
    try {
      await configure(dirs, { srv: { url: server.url } });
      await login(dirs);
      const fake = fakeModel([
        () => {
          server.invalidateAccessToken();
          server.rejectRefresh();
          return fauxAssistantMessage(fauxToolCall("mcp__srv__echo", {}), {
            stopReason: "toolUse",
          });
        },
        fauxAssistantMessage("continued"),
      ]);
      const events: SessionEvent[] = [];
      const session = await createSession({
        ...dirs,
        ...fake,
        permissionMode: "full-access",
        ...(interactive && { onMcpAuth: paste }),
        onWarning: () => {},
      });
      try {
        expect(
          (
            await session.run("use the server", {
              onEvent: (event) => {
                events.push(event);
              },
            })
          ).text,
        ).toBe("continued");
        expect(
          fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
        ).toMatchObject({ isError: true });
        expect(
          getCurrentTools(fake.contexts[1]!.messages)
            .filter((tool) => tool.name.startsWith("mcp__"))
            .map((tool) => tool.name),
        ).toEqual(interactive ? ["mcp__srv__authenticate"] : []);
        expect(events.filter((event) => event.type === "mcp_auth_required")).toHaveLength(1);
      } finally {
        await session.dispose();
      }
    } finally {
      await server.stop();
      await dirs.cleanup();
    }
  },
);

test("an access token expiring during the Run refreshes transparently before the tool response", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await configure(dirs, { srv: { url: server.url } });
    await login(dirs);
    const fake = fakeModel([
      () => {
        server.invalidateAccessToken();
        return fauxAssistantMessage(fauxToolCall("mcp__srv__echo", {}), { stopReason: "toolUse" });
      },
      fauxAssistantMessage("done"),
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      onMcpAuth: paste,
    });
    try {
      await session.run("use long-lived session", {
        onEvent: (event) => {
          events.push(event);
        },
      });
      expect(
        fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
      ).toMatchObject({ isError: false, content: [{ type: "text", text: "OAuth MCP: called" }] });
      expect(
        getCurrentTools(fake.contexts[1]!.messages)
          .filter((tool) => tool.name.startsWith("mcp__"))
          .map((tool) => tool.name),
      ).toEqual(["mcp__srv__echo"]);
      expect(
        server.requests.filter(
          (request) =>
            request.path === "/token" &&
            JSON.stringify(request.body).includes('"grant_type":"refresh_token"'),
        ),
      ).toHaveLength(1);
      expect(
        events.filter(
          (event) => event.type === "mcp_auth_required" || event.type === "mcp_server_error",
        ),
      ).toEqual([]);
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("pre-registered clients send client_secret_post even when the server also supports basic", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer({
    registration: false,
    clientId: "registered",
    clientSecret: "private",
    tokenEndpointAuthMethods: ["client_secret_basic", "client_secret_post"],
  });
  try {
    await configure(dirs, {
      srv: { url: server.url, oauth: { clientId: "registered", clientSecret: "private" } },
    });
    await login(dirs);
    const tokens = server.requests.filter((request) => request.path === "/token");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      authorization: null,
      body: { grant_type: "authorization_code", client_id: "registered", client_secret: "private" },
    });
    expect(server.requests.filter((request) => request.path === "/register")).toEqual([]);
    const fake = fakeModel([fauxAssistantMessage("done")]);
    const session = await createSession({ ...dirs, ...fake });
    try {
      await session.run("check authorization");
      expect(
        getCurrentTools(fake.contexts[0]!.messages).some((tool) => tool.name === "mcp__srv__echo"),
      ).toBe(true);
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("configured HTTPS authorization metadata bypasses well-known discovery", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  const metadataUrl = "https://oauth.fixture.test/metadata";
  const originalFetch = globalThis.fetch;
  let metadataRequests = 0;
  // Only the metadata endpoint is substituted at the network boundary; the OAuth flow and MCP are real HTTP.
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== metadataUrl) return originalFetch(input, init);
      metadataRequests++;
      const origin = new URL(server.url).origin;
      return Response.json({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    },
    originalFetch,
  );
  try {
    await configure(dirs, {
      srv: { url: server.url, oauth: { authServerMetadataUrl: metadataUrl } },
    });
    await login(dirs);
    expect(metadataRequests).toBeGreaterThan(0);
    expect(server.requests.filter((request) => request.path.startsWith("/.well-known/"))).toEqual(
      [],
    );
    expect(server.requests.filter((request) => request.path === "/token")).toHaveLength(1);
    const fake = fakeModel([fauxAssistantMessage("done")]);
    const session = await createSession({ ...dirs, ...fake });
    try {
      await session.run("use credential");
      expect(
        getCurrentTools(fake.contexts[0]!.messages).some((tool) => tool.name === "mcp__srv__echo"),
      ).toBe(true);
    } finally {
      await session.dispose();
    }
  } finally {
    globalThis.fetch = originalFetch;
    await server.stop();
    await dirs.cleanup();
  }
});

test("scope step-up reauthorizes for the server's requested scopes and restores usable tools", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await configure(dirs, { srv: { url: server.url } });
    await login(dirs);
    const authorizationScopes: (string | null)[] = [];
    const fake = fakeModel([
      () => {
        server.requireMoreScopes();
        return fauxAssistantMessage(fauxToolCall("mcp__srv__echo", {}), { stopReason: "toolUse" });
      },
      fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("mcp__srv__echo", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      onMcpAuth: async (request) => {
        authorizationScopes.push(new URL(request.authorizationUrl).searchParams.get("scope"));
        return paste(request);
      },
    });
    try {
      await session.run("use more capabilities");
      expect(
        getCurrentTools(fake.contexts[1]!.messages)
          .filter((tool) => tool.name.startsWith("mcp__"))
          .map((tool) => tool.name),
      ).toEqual(["mcp__srv__authenticate"]);
      expect(authorizationScopes).toEqual(["tools tools:write"]);
      expect(
        fake.contexts[3]!.messages.findLast((message) => message.role === "toolResult"),
      ).toMatchObject({ isError: false, content: [{ type: "text", text: "OAuth MCP: called" }] });
      expect(
        server.requests.filter(
          (request) =>
            request.path === "/token" &&
            JSON.stringify(request.body).includes('"grant_type":"refresh_token"'),
        ),
      ).toEqual([]);
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("scope-required memory skips an unchanged grant after cancelled login on the next Run", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await configure(dirs, { srv: { url: server.url } });
    await login(dirs);
    const fake = fakeModel([
      () => {
        server.requireMoreScopes();
        return fauxAssistantMessage(fauxToolCall("mcp__srv__echo", {}), { stopReason: "toolUse" });
      },
      fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("requires login"),
      fauxAssistantMessage("still requires login"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      onMcpAuth: async () => ({ type: "cancelled" }),
    });
    try {
      await session.run("try expanded capabilities");
      expect(
        fake.contexts[2]!.messages.findLast((message) => message.role === "toolResult"),
      ).toMatchObject({ isError: false, details: { type: "cancelled", server: "srv" } });
      const before = server.requests.filter((request) => request.path === "/mcp").length;
      await session.run("check again");
      expect(
        getCurrentTools(fake.contexts[3]!.messages)
          .filter((tool) => tool.name.startsWith("mcp__"))
          .map((tool) => tool.name),
      ).toEqual(["mcp__srv__authenticate"]);
      expect(server.requests.filter((request) => request.path === "/mcp")).toHaveLength(before);
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test.each(["url", "headers"])(
  "stored credentials are isolated when the same server name changes %s",
  async (field) => {
    const dirs = await tempDirs();
    const first = mcpOAuthServer();
    const second = mcpOAuthServer();
    try {
      await configure(dirs, {
        srv: { url: first.url, headers: { "X-Account": "${NEANT_MCP_OAUTH_TEST_ACCOUNT:-first}" } },
      });
      await login(dirs);
      await configure(dirs, {
        srv: {
          url: field === "url" ? second.url : first.url,
          headers: { "X-Account": field === "headers" ? "second" : "first" },
        },
      });
      const fake = fakeModel([fauxAssistantMessage("authentication required")]);
      const session = await createSession({ ...dirs, ...fake, onMcpAuth: paste });
      try {
        await session.run("connect changed server");
        expect(
          getCurrentTools(fake.contexts[0]!.messages)
            .filter((tool) => tool.name.startsWith("mcp__"))
            .map((tool) => tool.name),
        ).toEqual(["mcp__srv__authenticate"]);
        const endpoint = field === "url" ? second : first;
        expect(
          endpoint.requests
            .filter((request) => request.path === "/mcp" && request.method === "POST")
            .at(-1)?.authorization,
        ).toBeNull();
      } finally {
        await session.dispose();
      }
    } finally {
      await first.stop();
      await second.stop();
      await dirs.cleanup();
    }
  },
);

test("credential identity uses expanded header values across Sessions", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await configure(dirs, {
      srv: { url: server.url, headers: { "X-Account": "${NEANT_MCP_OAUTH_TEST_ACCOUNT:-first}" } },
    });
    await login(dirs);
    await configure(dirs, { srv: { url: server.url, headers: { "X-Account": "first" } } });
    const fake = fakeModel([fauxAssistantMessage("reused")]);
    const session = await createSession({ ...dirs, ...fake });
    try {
      await session.run("reuse expanded credential");
      expect(
        getCurrentTools(fake.contexts[0]!.messages).some((tool) => tool.name === "mcp__srv__echo"),
      ).toBe(true);
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("a configured callback port controls the OAuth redirect and closes after completion", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  const reservation = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("reserved"),
  });
  const port = reservation.port;
  await reservation.stop(true);
  let redirect: string | undefined;
  try {
    await configure(dirs, { srv: { url: server.url, oauth: { callbackPort: port } } });
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      onMcpAuth: async (request) => {
        redirect = new URL(request.authorizationUrl).searchParams.get("redirect_uri") ?? undefined;
        return paste(request);
      },
    });
    try {
      await session.run("sign in with registered redirect");
      expect(redirect).toBe(`http://localhost:${port}/callback`);
      expect(
        fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
      ).toMatchObject({ isError: false, details: { type: "authenticated", server: "srv" } });
      await expect(fetch(redirect!)).rejects.toThrow();
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("untrusted project OAuth servers do not send any discovery or authorization requests", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await Bun.write(
      join(dirs.cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: { srv: { url: server.url, oauth: { clientId: "registered" } } },
      }),
    );
    const fake = fakeModel([fauxAssistantMessage("done")]);
    const session = await createSession({ ...dirs, ...fake, onMcpAuth: paste });
    try {
      await session.run("check project servers");
      expect(
        getCurrentTools(fake.contexts[0]!.messages).filter((tool) => tool.name.startsWith("mcp__")),
      ).toEqual([]);
      expect(server.requests).toEqual([]);
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("scope step-up immediately after the first OAuth login in the same Run restores real tools", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  const scopes: (string | null)[] = [];
  try {
    await configure(dirs, { srv: { url: server.url } });
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
      () => {
        server.requireMoreScopes();
        return fauxAssistantMessage(fauxToolCall("mcp__srv__echo", {}), { stopReason: "toolUse" });
      },
      fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("mcp__srv__echo", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      onMcpAuth: async (request) => {
        scopes.push(new URL(request.authorizationUrl).searchParams.get("scope"));
        return paste(request);
      },
    });
    try {
      await session.run("login and use expanded capabilities");
      expect(scopes).toEqual(["tools", "tools tools:write"]);
      expect(
        fake.contexts[2]!.messages.findLast((message) => message.role === "toolResult"),
      ).toMatchObject({ isError: true });
      expect(
        fake.contexts[4]!.messages.findLast((message) => message.role === "toolResult"),
      ).toMatchObject({ isError: false, content: [{ type: "text", text: "OAuth MCP: called" }] });
      expect((await session.mcpServers())[0]?.status).toBe("connected");
    } finally {
      await session.dispose();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});
