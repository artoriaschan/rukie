import { expect, test } from "bun:test";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  createSession,
  type SessionEvent,
  type McpAuthRequest,
  type McpAuthReply,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { mcpOAuthServer } from "../helpers/mcp-oauth-server.ts";

async function browser({ authorizationUrl, signal }: McpAuthRequest): Promise<McpAuthReply> {
  await fetch(authorizationUrl);
  if (!signal.aborted)
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  return { type: "cancelled" };
}

async function paste({ authorizationUrl }: McpAuthRequest): Promise<McpAuthReply> {
  const response = await fetch(authorizationUrl, { redirect: "manual" });
  const url = response.headers.get("location");
  if (!url) throw new Error("Authorization fixture did not provide a callback.");
  return { type: "callback-url", url };
}

async function configure(dirs: Awaited<ReturnType<typeof tempDirs>>, servers: object) {
  await Bun.write(join(dirs.homeDir, ".rukie/mcp.json"), JSON.stringify({ mcpServers: servers }));
}

test.each(["paste", "wrong-state", "cancel", "oauth-error"])(
  "authorization handles %s through the frontend without disturbing the Run",
  async (path) => {
    const dirs = await tempDirs();
    const server = mcpOAuthServer(
      path === "oauth-error" ? { authorizationError: "access_denied" } : {},
    );
    try {
      await configure(dirs, { srv: { url: server.url } });
      const fake = fakeModel([
        fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
        fauxAssistantMessage("continued"),
      ]);
      const session = await createSession({
        ...dirs,
        ...fake,
        onMcpAuth: async (request) => {
          if (path === "cancel") return { type: "cancelled" };
          const reply = await paste(request);
          if (path === "wrong-state" && reply.type === "callback-url") {
            const url = new URL(reply.url);
            url.searchParams.set("state", "wrong");
            return { type: "callback-url", url: url.href };
          }
          return reply;
        },
      });
      try {
        expect((await session.run("login")).text).toBe("continued");
        const result = fake.contexts[1]!.messages.findLast(
          (message) => message.role === "toolResult",
        );
        const error = path === "wrong-state" || path === "oauth-error";
        expect(result).toMatchObject({ isError: error });
        expect(JSON.stringify(result?.content)).toContain(
          path === "paste"
            ? "Authenticated srv"
            : path === "cancel"
              ? "User did not complete authentication"
              : path === "wrong-state"
                ? "state does not match"
                : "access_denied",
        );
        if (path === "paste") {
          const registrations = server.requests.filter((request) => request.path === "/register");
          expect(registrations.length).toBeGreaterThan(0);
          for (const request of registrations)
            expect(request.body).toMatchObject({ client_name: "Rukie" });
          const initialize = server.requests.filter(
            (request) =>
              request.path === "/mcp" &&
              Value.Check(Type.Object({ method: Type.Literal("initialize") }), request.body),
          );
          expect(initialize.length).toBeGreaterThan(0);
          for (const request of initialize)
            expect(request.body).toMatchObject({ params: { clientInfo: { name: "rukie" } } });
          await session.clearMcpAuth("srv");
          const registeredBeforeReconnect = server.requests.filter(
            (request) => request.path === "/register",
          ).length;
          await session.reconnectMcp("srv");
          const reconnectRegistrations = server.requests
            .filter((request) => request.path === "/register")
            .slice(registeredBeforeReconnect);
          expect(reconnectRegistrations.length).toBeGreaterThan(0);
          for (const request of reconnectRegistrations)
            expect(request.body).toMatchObject({ client_name: "Rukie" });
          expect(
            (await session.mcpServers()).servers.find((view) => view.name === "srv")?.status,
          ).toBe("needs-auth");
        }
        if (!error)
          expect(result?.details).toEqual({
            type: path === "paste" ? "authenticated" : "cancelled",
            server: "srv",
          });
      } finally {
        await session.close();
      }
    } finally {
      await server.stop();
      await dirs.cleanup();
    }
  },
);

test("a new Session reuses the credential without requesting authentication", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await configure(dirs, { srv: { url: server.url } });
    const first = await createSession({
      ...dirs,
      ...fakeModel([
        fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
        fauxAssistantMessage("authorized"),
      ]),
      onMcpAuth: paste,
    });
    await first.run("login");
    expect((await stat(join(dirs.homeDir, ".rukie/credentials.json"))).isFile()).toBe(true);
    await expect(stat(join(dirs.homeDir, ".neant/credentials.json"))).rejects.toThrow();
    await first.close();
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("mcp__srv__echo", { text: "reused" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("reused"),
    ]);
    let asks = 0;
    const next = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      onMcpAuth: async () => {
        asks++;
        return { type: "cancelled" };
      },
    });
    try {
      expect((await next.run("use MCP")).text).toBe("reused");
      expect(
        fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
      ).toMatchObject({ isError: false, content: [{ type: "text", text: "OAuth MCP: called" }] });
      expect(asks).toBe(0);
    } finally {
      await next.close();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("two concurrent authentication calls share one interaction and outcome", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await configure(dirs, { srv: { url: server.url } });
    const fake = fakeModel([
      fauxAssistantMessage(
        [fauxToolCall("mcp__srv__authenticate", {}), fauxToolCall("mcp__srv__authenticate", {})],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    let asks = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      onMcpAuth: async (request) => {
        asks++;
        return paste(request);
      },
    });
    try {
      await session.run("login twice");
      const results = fake.contexts[1]!.messages.filter((message) => message.role === "toolResult");
      expect(results).toHaveLength(2);
      expect(results.map((result) => result.details)).toEqual([
        { type: "authenticated", server: "srv" },
        { type: "authenticated", server: "srv" },
      ]);
      expect(asks).toBe(1);
    } finally {
      await session.close();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("Run abort closes the pending frontend and callback and records a native aborted tool result", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  const controller = new AbortController();
  const requested = Promise.withResolvers<McpAuthRequest>();
  try {
    await configure(dirs, { srv: { url: server.url } });
    const session = await createSession({
      ...dirs,
      ...fakeModel([
        fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
      ]),
      onMcpAuth: async (request) => {
        requested.resolve(request);
        return new Promise(() => {});
      },
    });
    try {
      const running = session
        .run("login", { signal: controller.signal })
        .catch((error: unknown) => error);
      const request = await requested.promise;
      const callback = new URL(new URL(request.authorizationUrl).searchParams.get("redirect_uri")!);
      controller.abort();
      expect(await running).toBeInstanceOf(Error);
      expect(request.signal.aborted).toBe(true);
      expect(session.messages.findLast((message) => message.role === "toolResult")).toMatchObject({
        isError: true,
      });
      await expect(fetch(callback)).rejects.toThrow();
      expect(await Bun.file(join(dirs.homeDir, ".rukie/credentials.json")).text()).not.toContain(
        "access_token",
      );
    } finally {
      await session.close();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("abort during code exchange prevents token persistence and late tool promotion", async () => {
  const dirs = await tempDirs();
  const exchanging = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const server = mcpOAuthServer({
    beforeTokenResponse: async () => {
      exchanging.resolve();
      await release.promise;
    },
  });
  const controller = new AbortController();
  try {
    await configure(dirs, { srv: { url: server.url } });
    const session = await createSession({
      ...dirs,
      ...fakeModel([
        fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
      ]),
      onMcpAuth: paste,
    });
    try {
      const running = session
        .run("login", { signal: controller.signal })
        .catch((error: unknown) => error);
      await exchanging.promise;
      await session.abort();
      release.resolve();
      expect(await running).toBeInstanceOf(Error);
      expect(session.messages.findLast((message) => message.role === "toolResult")).toMatchObject({
        isError: true,
      });
      expect(await Bun.file(join(dirs.homeDir, ".rukie/credentials.json")).text()).not.toContain(
        "access_token",
      );
      expect(JSON.stringify(session.messages)).not.toContain('"name":"mcp__srv__echo"');
    } finally {
      release.resolve();
      await session.close();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("concurrent servers preserve both credentials in the shared atomic file", async () => {
  const dirs = await tempDirs();
  const first = mcpOAuthServer();
  const second = mcpOAuthServer();
  try {
    await configure(dirs, { first: { url: first.url }, second: { url: second.url } });
    const fake = fakeModel([
      fauxAssistantMessage(
        [
          fauxToolCall("mcp__first__authenticate", {}),
          fauxToolCall("mcp__second__authenticate", {}),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({ ...dirs, ...fake, onMcpAuth: paste });
    try {
      await session.run("login both");
      const data: unknown = await Bun.file(join(dirs.homeDir, ".rukie/credentials.json")).json();
      const schema = Type.Object({
        mcp: Type.Record(
          Type.String(),
          Type.Object({
            serverName: Type.String(),
            state: Type.Object({ tokens: Type.Object({ access_token: Type.String() }) }),
          }),
        ),
      });
      if (!Value.Check(schema, data))
        throw new Error("Credential fixture did not contain valid tokens.");
      expect(
        Object.values(data.mcp)
          .map((credential) => credential.serverName)
          .sort(),
      ).toEqual(["first", "second"]);
      expect(
        fake.contexts[1]!.messages.filter((message) => message.role === "toolResult").map(
          (result) => result.isError,
        ),
      ).toEqual([false, false]);
    } finally {
      await session.close();
    }
  } finally {
    await first.stop();
    await second.stop();
    await dirs.cleanup();
  }
});

test.each(["bad-json", "bad-state"])(
  "invalid credential %s warns once and is preserved until a successful write",
  async (corruption) => {
    const dirs = await tempDirs();
    const server = mcpOAuthServer({ authentication: false });
    try {
      await configure(dirs, { srv: { url: server.url } });
      const raw =
        corruption === "bad-json"
          ? "{broken json"
          : JSON.stringify({
              version: 1,
              mcp: {
                broken: {
                  serverName: "srv",
                  serverUrl: server.url,
                  state: {
                    serverUrl: server.url,
                    tokens: { access_token: 42, token_type: "Bearer" },
                  },
                },
              },
            });
      const path = join(dirs.homeDir, ".rukie/credentials.json");
      await Bun.write(path, raw);
      const warnings: string[] = [];
      const session = await createSession({
        ...dirs,
        ...fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("second")]),
        onWarning: (warning) => {
          warnings.push(warning);
        },
      });
      try {
        await session.run("first");
        await session.run("second");
        expect(warnings).toEqual(["MCP credentials file is invalid; ignoring its contents."]);
        expect(await Bun.file(path).text()).toBe(raw);
      } finally {
        await session.close();
      }
    } finally {
      await server.stop();
      await dirs.cleanup();
    }
  },
);

test("authentication emits an MCP Notification hook with the authorization message", async () => {
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
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
      async () => {
        await notified.promise;
        return fauxAssistantMessage("done");
      },
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      onMcpAuth: paste,
      settings: {
        hooks: {
          Notification: [{ matcher: "mcp_auth", hooks: [{ type: "http", url: hook.url.href }] }],
        },
      },
    });
    try {
      await session.run("login");
      expect(await notified.promise).toMatchObject({
        hook_event_name: "Notification",
        notification_type: "mcp_auth",
        message: "MCP server srv needs authorization",
        session_id: session.id,
      });
    } finally {
      await session.close();
    }
  } finally {
    await hook.stop(true);
    await server.stop();
    await dirs.cleanup();
  }
});

test("model authorization replaces authentication with executable tools in the next Turn and persists a private credential", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  let interactions = 0;
  let callbackClosed = false;
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("mcp__srv__echo", { text: "authorized" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      onMcpAuth: async (request) => {
        interactions++;
        const reply = await browser(request);
        callbackClosed = true;
        return reply;
      },
    });
    try {
      expect((await session.run("authorize and use MCP")).text).toBe("done");
      const authResult = fake.contexts[1]!.messages.findLast(
        (message) => message.role === "toolResult",
      );
      expect(authResult).toMatchObject({
        isError: false,
        content: [{ type: "text", text: "Authenticated srv; its tools are now available." }],
      });
      expect(getCurrentTools(fake.contexts[1]!.messages).map((tool) => tool.name)).toContain(
        "mcp__srv__echo",
      );
      expect(getCurrentTools(fake.contexts[1]!.messages).map((tool) => tool.name)).not.toContain(
        "mcp__srv__authenticate",
      );
      expect(
        fake.contexts[2]!.messages.findLast((message) => message.role === "toolResult"),
      ).toMatchObject({ isError: false, content: [{ type: "text", text: "OAuth MCP: called" }] });
      expect(interactions).toBe(1);
      expect(callbackClosed).toBe(true);
      const credentialPath = join(dirs.homeDir, ".rukie/credentials.json");
      const credential: unknown = await Bun.file(credentialPath).json();
      expect(JSON.stringify(credential)).toContain('"access_token":"access-');
      expect(credential).toMatchObject({ version: 1, mcp: expect.any(Object) });
      expect((await stat(credentialPath)).mode & 0o777).toBe(0o600);
      await session.close();
      const resumedFake = fakeModel([fauxAssistantMessage("resumed")]);
      const resumed = await createSession({
        ...dirs,
        ...resumedFake,
        resumeId: session.id,
        onMcpAuth: browser,
      });
      try {
        await resumed.run("continue");
        const tools = new Set<string>();
        for (const message of resumedFake.contexts[0]!.messages) {
          if (message.role !== "system") continue;
          for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
          for (const tool of message.toolsAdded ?? [])
            if (tool.name.startsWith("mcp__")) tools.add(tool.name);
        }
        expect([...tools]).toEqual(["mcp__srv__echo"]);
      } finally {
        await resumed.close();
      }
    } finally {
      await session.close();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("OAuth servers require authentication without opening an interaction and are remembered across Runs", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { type: "http", url: server.url } } }),
    );
    const fake = fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
    const events: SessionEvent[] = [];
    let interactions = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      onWarning: () => {},
      onMcpAuth: async () => {
        interactions++;
        return { type: "cancelled" };
      },
    });
    for (const prompt of ["first", "second"])
      await session.run(prompt, {
        onEvent: (event) => {
          events.push(event);
        },
      });
    expect(
      fake.contexts.map((context) =>
        context.messages.flatMap((message) =>
          message.role === "system"
            ? (message.toolsAdded ?? [])
                .filter((tool) => tool.name.startsWith("mcp__"))
                .map((tool) => tool.name)
            : [],
        ),
      ),
    ).toEqual([["mcp__srv__authenticate"], ["mcp__srv__authenticate"]]);
    expect(events.filter((event) => event.type === "mcp_auth_required")).toHaveLength(1);
    expect(events.filter((event) => event.type === "mcp_server_error")).toEqual([]);
    expect(server.requests.filter((request) => request.path === "/mcp")).toHaveLength(1);
    expect(server.requests.filter((request) => request.path === "/authorize")).toEqual([]);
    expect(interactions).toBe(0);
    await session.close();
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("authentication is allowed without an approval and still passes through hooks", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("continued"),
    ]);
    let approvals = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        hooks: {
          PreToolUse: [
            {
              matcher: "mcp__srv__authenticate",
              hooks: [{ type: "command", command: "cat > auth-hook" }],
            },
          ],
        },
      },
      onMcpAuth: async () => ({ type: "cancelled" }),
      onPermissionAsk: async () => {
        approvals++;
        return "deny";
      },
    });
    await session.run("login");
    expect(
      fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({
      role: "toolResult",
      isError: false,
      content: [{ type: "text", text: "User did not complete authentication for srv." }],
      details: { type: "cancelled", server: "srv" },
    });
    expect(approvals).toBe(0);
    expect((await Bun.file(join(dirs.cwd, "auth-hook")).json()).tool_name).toBe(
      "mcp__srv__authenticate",
    );
    await session.close();
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test.each(["rule", "hook"])("authentication tools preserve explicit %s denials", async (denial) => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("continued"),
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      onMcpAuth: async () => ({ type: "cancelled" }),
      settings:
        denial === "rule"
          ? { permissions: { deny: ["mcp__srv__authenticate"] } }
          : {
              hooks: {
                PreToolUse: [
                  {
                    matcher: "mcp__srv__authenticate",
                    hooks: [
                      {
                        type: "command",
                        command: `echo '{"hookSpecificOutput":{"permissionDecision":"deny"}}'`,
                      },
                    ],
                  },
                ],
              },
            },
    });
    await session.run("login", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
      { toolName: "mcp__srv__authenticate", by: denial },
    ]);
    expect(
      fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({ role: "toolResult", isError: true });
    await session.close();
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("needs-auth memory belongs to the exact server endpoint and follows project trust", async () => {
  const dirs = await tempDirs();
  const original = mcpOAuthServer();
  const replacement = mcpOAuthServer();
  const project = mcpOAuthServer();
  try {
    await Bun.write(
      join(dirs.cwd, ".mcp.json"),
      JSON.stringify({ mcpServers: { project: { url: project.url } } }),
    );
    const config = (url: string) =>
      Bun.write(
        join(dirs.homeDir, ".rukie/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url } } }),
      );
    await config(original.url);
    const fake = fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
    const session = await createSession({
      ...dirs,
      ...fake,
      onMcpAuth: async () => ({ type: "cancelled" }),
    });
    await session.run("first");
    await config(replacement.url);
    await session.run("second");
    expect(original.requests.filter((request) => request.path === "/mcp")).toHaveLength(1);
    expect(replacement.requests.filter((request) => request.path === "/mcp")).toHaveLength(1);
    expect(project.requests).toEqual([]);
    await session.close();
  } finally {
    await Promise.all([original.stop(), replacement.stop(), project.stop()]);
    await dirs.cleanup();
  }
});
