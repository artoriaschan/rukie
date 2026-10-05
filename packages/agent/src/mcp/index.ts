import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  McpClient,
  StdioTransport,
  StreamableHttpTransport,
  toLlmContent,
  type Tool,
} from "@earendil-works/pi-mcp";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createUserVisibleError, type CustomSessionEvent, type Settings } from "@neant/shared";
import { isTrustedProject } from "../config/index.ts";

const StdioConfig = Type.Object({
  type: Type.Optional(Type.Literal("stdio")),
  command: Type.String({ minLength: 1 }),
  args: Type.Optional(Type.Array(Type.String())),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
});
const HttpConfig = Type.Object({
  type: Type.Optional(Type.Enum(["http", "streamable-http"])),
  url: Type.String({ minLength: 1 }),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
});
const ServerConfig = Type.Union([StdioConfig, HttpConfig]);

function adaptTool(
  server: string,
  client: McpClient,
  tool: Tool,
  reportError: (error: unknown) => void,
): AgentTool {
  const name = `mcp__${server}__${tool.name}`;
  const parameters = Type.Unsafe<Record<string, unknown>>(tool.inputSchema);
  const adapted: AgentTool<typeof parameters> = {
    name,
    label: tool.title ?? name,
    description: tool.description ?? tool.name,
    parameters,
    async execute(_id, args, signal) {
      try {
        const result = await client.callTool(tool.name, args, { signal });
        return { content: toLlmContent(result), details: result, isError: result.isError };
      } catch (error) {
        if (!signal?.aborted) reportError(error);
        throw error;
      }
    },
  };
  return adapted;
}

/** Connections belong to a Run, so later Runs rediscover current server capabilities. */
export function createMcpConnections() {
  const clients: McpClient[] = [];
  const connected = new Map<string, McpClient>();
  const errors: Extract<CustomSessionEvent, { type: "mcp_server_error" }>[] = [];
  const tools: AgentTool[] = [];
  const toolServers = new Map<string, string>();
  const descriptions: string[] = [];
  const failed = new Set<string>();
  let closePromise: Promise<void> | undefined;
  let closing = false;
  let removeAbortListener: (() => void) | undefined;
  const report = (server: string, error: unknown) => {
    if (failed.has(server)) return;
    failed.add(server);
    errors.push({
      type: "mcp_server_error",
      server,
      error: error instanceof Error ? error.message : String(error),
    });
  };
  const close = () => {
    closing = true;
    connected.clear();
    // Save the first close promise: pi's subsequent close calls can settle before shutdown.
    closePromise ??= Promise.all(
      clients.map(async (client) => {
        try {
          await client.close();
        } catch (error) {
          report(client.options.title ?? "unknown", error);
        }
      }),
    ).then(() => {
      removeAbortListener?.();
    });
    return closePromise;
  };
  async function readConfig(path: string): Promise<Record<string, unknown>> {
    try {
      const file = Bun.file(path);
      if (!(await file.exists())) return {};
      const data = await file.json();
      if (
        !Value.Check(Type.Object({ mcpServers: Type.Record(Type.String(), Type.Unknown()) }), data)
      ) {
        throw new Error("Expected an object containing mcpServers.");
      }
      return data.mcpServers;
    } catch (error) {
      report(path, error);
      return {};
    }
  }
  return {
    tools,
    toolServers,
    errors,
    async callHookTool(
      server: string,
      tool: string,
      input: Record<string, unknown>,
      signal: AbortSignal,
    ) {
      const client = connected.get(server);
      if (!client)
        throw createUserVisibleError(`Hook MCP server is not connected: ${server}`, {
          code: "hook-mcp-unconnected",
          params: { server },
        });
      // Hook execution owns its timeout; the SDK default would cap every hook at 30s.
      return client.callTool(tool, input, { signal, timeoutMs: 0 });
    },
    get hasServers() {
      return descriptions.length > 0;
    },
    reminder: () =>
      descriptions.length ? `MCP servers:\n${descriptions.join("\n\n")}` : "MCP servers: none.",
    async connect(options: {
      cwd: string;
      homeDir: string;
      settings: Settings;
      trustProjectMcp?: boolean;
      signal?: AbortSignal;
    }) {
      const servers = await readConfig(join(options.homeDir, ".neant/mcp.json"));
      if (options.trustProjectMcp || isTrustedProject(options.cwd, options.settings)) {
        Object.assign(servers, await readConfig(join(options.cwd, ".mcp.json")));
      }
      options.signal?.throwIfAborted();
      const abort = () => {
        void close();
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      removeAbortListener = () => options.signal?.removeEventListener("abort", abort);
      for (const [server, value] of Object.entries(servers).sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        options.signal?.throwIfAborted();
        const client = new McpClient({
          name: "neant",
          title: server,
          version: "0.1.0",
        });
        let ready = false;
        clients.push(client);
        client.onError((error) => {
          if (!closing) report(server, error);
        });
        client.onClose(() => {
          connected.delete(server);
          if (ready && !closing) report(server, new Error("MCP connection closed unexpectedly."));
        });
        try {
          const [invalid] = Value.Errors(ServerConfig, value);
          if (invalid)
            throw new Error(
              `Invalid MCP configuration: ${invalid.instancePath || "/"} ${invalid.message}`,
            );
          const entry = Value.Parse(ServerConfig, value);
          const transport =
            "url" in entry
              ? new StreamableHttpTransport({ url: entry.url, headers: entry.headers })
              : new StdioTransport({
                  command: entry.command,
                  args: entry.args,
                  env: entry.env,
                  cwd: options.cwd,
                });
          await client.connect(transport);
          const discovered = client.serverCapabilities?.tools
            ? await client.listTools({ signal: options.signal })
            : [];
          ready = true;
          connected.set(server, client);
          const adapted = discovered.map((tool) =>
            adaptTool(server, client, tool, (error) => {
              if (!closing) report(server, error);
            }),
          );
          tools.push(...adapted);
          for (const tool of adapted) toolServers.set(tool.name, server);
          descriptions.push(
            `${server}:\n${client.instructions ?? ""}\nTools: ${adapted.map((tool) => tool.name).join(", ") || "none"}`,
          );
        } catch (error) {
          await client.close();
          options.signal?.throwIfAborted();
          report(server, error);
        }
      }
    },
    close,
  };
}
