import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const restoreEnvironment = new Map<string, string | undefined>();
afterEach(async () => {
  for (const [name, value] of restoreEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  restoreEnvironment.clear();
  await dirs?.cleanup();
});

function setEnvironment(name: string, value: string | undefined) {
  if (!restoreEnvironment.has(name)) restoreEnvironment.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function httpServer() {
  const requests: { path: string; authorization: string | null; fallback: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push({
        path: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
        fallback: request.headers.get("x-fallback"),
      });
      if (request.method === "GET") return new Response(null, { status: 405 });
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      const rpc = Value.Parse(
        Type.Object({
          id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
          method: Type.String(),
          params: Type.Optional(Type.Object({ protocolVersion: Type.Optional(Type.String()) })),
        }),
        await request.json(),
      );
      if (rpc.id === undefined) return new Response(null, { status: 202 });
      const result =
        rpc.method === "initialize"
          ? {
              protocolVersion: rpc.params?.protocolVersion,
              serverInfo: { name: "config-test", version: "1" },
              capabilities: { tools: {} },
            }
          : { tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] };
      return Response.json(
        { jsonrpc: "2.0", id: rpc.id, result },
        { headers: { "mcp-session-id": "config-test" } },
      );
    },
  });
  return { server, requests };
}

async function writeConfig(servers: object, project = false) {
  await Bun.write(
    project ? join(dirs.cwd, ".mcp.json") : join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({ mcpServers: servers }),
  );
}

async function runConfigured(trusted = false) {
  const fake = fakeModel([fauxAssistantMessage("done")]);
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    trustProjectMcp: trusted,
    onWarning: () => {},
  });
  try {
    const result = await session.run("list MCP tools", {
      onEvent: (event) => void events.push(event),
    });
    const start = events.find((event) => event.type === "session_start");
    return { events, tools: start?.tools, result };
  } finally {
    await session.dispose();
  }
}

test("HTTP URL and header values expand process variables and defaults before connection", async () => {
  dirs = await tempDirs();
  const { server, requests } = httpServer();
  setEnvironment("RUKIE_MCP_CONFIG_URL", server.url.href);
  setEnvironment("RUKIE_MCP_CONFIG_TOKEN", "test-secret");
  setEnvironment("RUKIE_MCP_CONFIG_UNSET", undefined);
  try {
    await writeConfig({
      remote: {
        type: "http",
        url: "${RUKIE_MCP_CONFIG_URL}${RUKIE_MCP_CONFIG_UNSET:-mcp}",
        headers: {
          Authorization: "Bearer ${RUKIE_MCP_CONFIG_TOKEN}",
          "X-Fallback": "${RUKIE_MCP_CONFIG_UNSET:-fallback}",
        },
      },
    });
    const { events, tools } = await runConfigured();
    expect(events.filter((event) => event.type === "mcp_server_error")).toEqual([]);
    expect(tools).toContain("mcp__remote__echo");
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.path === "/mcp")).toBe(true);
    expect(requests.every((request) => request.authorization === "Bearer test-secret")).toBe(true);
    expect(requests.every((request) => request.fallback === "fallback")).toBe(true);
  } finally {
    await server.stop(true);
  }
});

test("stdio env values expand variables and defaults before starting the server", async () => {
  dirs = await tempDirs();
  setEnvironment("RUKIE_MCP_CONFIG_HOME", dirs.homeDir);
  setEnvironment("RUKIE_MCP_CONFIG_UNSET", undefined);
  await Bun.write(join(dirs.homeDir, "manifest.json"), JSON.stringify({ tools: ["echo"] }));
  await writeConfig({
    local: {
      command: process.execPath,
      args: [fileURLToPath(new URL("../helpers/mcp-server.ts", import.meta.url))],
      env: {
        MCP_MANIFEST: "${RUKIE_MCP_CONFIG_HOME}/${RUKIE_MCP_CONFIG_UNSET:-manifest.json}",
        MCP_PIDS: "${RUKIE_MCP_CONFIG_HOME}/pids",
        MCP_CALLS: "${RUKIE_MCP_CONFIG_HOME}/calls",
      },
    },
  });
  const { events, tools } = await runConfigured();
  expect(events.filter((event) => event.type === "mcp_server_error")).toEqual([]);
  expect(tools).toContain("mcp__local__echo");
});

test.each(["url", "headers", "env"])(
  "a missing variable in %s names the variable and leaves other servers usable",
  async (field) => {
    dirs = await tempDirs();
    setEnvironment("RUKIE_MCP_CONFIG_UNSET", undefined);
    const { server } = httpServer();
    try {
      await writeConfig({
        healthy: { type: "http", url: server.url.href },
        missing:
          field === "env"
            ? { command: "never-started", env: { SECRET: "${RUKIE_MCP_CONFIG_UNSET}" } }
            : {
                type: "http",
                url: field === "url" ? "${RUKIE_MCP_CONFIG_UNSET}" : server.url.href,
                headers: field === "headers" ? { Secret: "${RUKIE_MCP_CONFIG_UNSET}" } : {},
              },
      });
      const { events, tools, result } = await runConfigured();
      expect(events.filter((event) => event.type === "mcp_server_error")).toMatchObject([
        { server: "missing", error: expect.stringContaining("RUKIE_MCP_CONFIG_UNSET") },
      ]);
      expect(tools).toContain("mcp__healthy__echo");
      expect(result.success).toBe(true);
    } finally {
      await server.stop(true);
    }
  },
);

test.each([
  { callbackPort: 0 },
  { callbackPort: 65536 },
  { callbackPort: 3000.5 },
  { callbackPort: "3000" },
  { authServerMetadataUrl: "http://auth.example/metadata" },
  { authServerMetadataUrl: "https://" },
  { clientId: 123 },
  { clientSecret: false },
])("invalid HTTP OAuth configuration reports a server configuration error (%j)", async (oauth) => {
  dirs = await tempDirs();
  const { server, requests } = httpServer();
  try {
    await writeConfig({ remote: { type: "http", url: server.url.href, oauth } });
    const { events, tools } = await runConfigured();
    expect(events.filter((event) => event.type === "mcp_server_error")).toMatchObject([
      { server: "remote", error: expect.stringContaining("Invalid MCP configuration") },
    ]);
    expect(tools).not.toContain("mcp__remote__echo");
    expect(requests).toEqual([]);
  } finally {
    await server.stop(true);
  }
});

test("stdio configuration rejects OAuth before starting the server", async () => {
  dirs = await tempDirs();
  await writeConfig({
    local: { command: process.execPath, args: ["--version"], oauth: {} },
  });
  const { events } = await runConfigured();
  expect(events.filter((event) => event.type === "mcp_server_error")).toMatchObject([
    { server: "local", error: expect.stringContaining("Invalid MCP configuration") },
  ]);
});

test.each([
  {},
  { callbackPort: 1 },
  { callbackPort: 65535 },
  {
    clientId: "registered-client",
    clientSecret: "registered-secret",
    callbackPort: 3000,
    authServerMetadataUrl: "https://auth.example/metadata",
  },
])("HTTP configuration accepts optional OAuth settings (%j)", async (oauth) => {
  dirs = await tempDirs();
  const { server } = httpServer();
  try {
    await writeConfig({ remote: { type: "http", url: server.url.href, oauth } });
    const { events, tools } = await runConfigured();
    expect(events.filter((event) => event.type === "mcp_server_error")).toEqual([]);
    expect(tools).toContain("mcp__remote__echo");
  } finally {
    await server.stop(true);
  }
});

test.each([false, true])(
  "project MCP variable expansion and OAuth settings require trust (%s)",
  async (trusted) => {
    dirs = await tempDirs();
    const { server, requests } = httpServer();
    setEnvironment("RUKIE_MCP_CONFIG_URL", server.url.href);
    setEnvironment("RUKIE_MCP_CONFIG_TOKEN", "project-secret");
    try {
      await writeConfig(
        {
          project: {
            type: "http",
            url: "${RUKIE_MCP_CONFIG_URL}",
            headers: { Authorization: "Bearer ${RUKIE_MCP_CONFIG_TOKEN}" },
            oauth: { clientId: "project-client" },
          },
          missing: { type: "http", url: "${RUKIE_MCP_CONFIG_UNSET}" },
        },
        true,
      );
      setEnvironment("RUKIE_MCP_CONFIG_UNSET", undefined);
      const { events, tools } = await runConfigured(trusted);
      expect(tools?.includes("mcp__project__echo")).toBe(trusted);
      expect(events.filter((event) => event.type === "mcp_server_error")).toHaveLength(
        trusted ? 1 : 0,
      );
      if (trusted)
        expect(requests.every((request) => request.authorization === "Bearer project-secret")).toBe(
          true,
        );
      else expect(requests).toEqual([]);
    } finally {
      await server.stop(true);
    }
  },
);
