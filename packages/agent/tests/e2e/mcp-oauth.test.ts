import { expect, test } from "bun:test";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { mcpOAuthServer } from "../helpers/mcp-oauth-server.ts";

test("OAuth servers require authentication without opening an interaction and are remembered across Runs", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await Bun.write(
      join(dirs.homeDir, ".neant/mcp.json"),
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
    expect(events.filter((event) => event.type === "mcp_auth_required")).toHaveLength(2);
    expect(events.filter((event) => event.type === "mcp_server_error")).toEqual([]);
    expect(server.requests.filter((request) => request.path === "/mcp")).toHaveLength(1);
    expect(server.requests.filter((request) => request.path === "/authorize")).toEqual([]);
    expect(interactions).toBe(0);
    await session.dispose();
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("authentication stub is allowed without an approval and still passes through hooks", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await Bun.write(
      join(dirs.homeDir, ".neant/mcp.json"),
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
    expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
      role: "toolResult",
      isError: true,
      content: [{ type: "text", text: "MCP OAuth authentication is not implemented yet." }],
    });
    expect(approvals).toBe(0);
    expect((await Bun.file(join(dirs.cwd, "auth-hook")).json()).tool_name).toBe(
      "mcp__srv__authenticate",
    );
    await session.dispose();
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
      join(dirs.homeDir, ".neant/mcp.json"),
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
    expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({ role: "toolResult", isError: true });
    await session.dispose();
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
        join(dirs.homeDir, ".neant/mcp.json"),
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
    await session.dispose();
  } finally {
    await Promise.all([original.stop(), replacement.stop(), project.stop()]);
    await dirs.cleanup();
  }
});
