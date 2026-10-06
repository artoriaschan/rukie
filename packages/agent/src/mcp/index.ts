import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  McpClient,
  McpAuthRequiredError,
  StdioTransport,
  StreamableHttpTransport,
  toLlmContent,
  type Tool,
} from "@earendil-works/pi-mcp";
import {
  McpOAuthProvider,
  McpOAuthAuthorizationRequiredError,
  MemoryOAuthStateStore,
  adaptOAuthProvider,
} from "@earendil-works/pi-mcp/oauth";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createUserVisibleError, type CustomSessionEvent, type Settings } from "@neant/shared";
import { isTrustedProject } from "../config/index.ts";

export interface McpAuthRequest {
  server: string;
  authorizationUrl: string;
  origin?: { agentId: string; description: string };
  signal: AbortSignal;
}
export type McpAuthReply = { type: "callback-url"; url: string } | { type: "cancelled" };
export type OnMcpAuth = (request: McpAuthRequest) => Promise<McpAuthReply>;

const StdioConfig = Type.Object({
  type: Type.Optional(Type.Literal("stdio")),
  command: Type.String({ minLength: 1 }),
  args: Type.Optional(Type.Array(Type.String())),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  oauth: Type.Optional(Type.Never()),
});
const OAuthConfig = Type.Object({
  clientId: Type.Optional(Type.String()),
  clientSecret: Type.Optional(Type.String()),
  callbackPort: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
  authServerMetadataUrl: Type.Optional(Type.String()),
});
const HttpConfig = Type.Object({
  type: Type.Optional(Type.Enum(["http", "streamable-http"])),
  url: Type.String({ minLength: 1 }),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  oauth: Type.Optional(OAuthConfig),
});
const ServerConfig = Type.Union([StdioConfig, HttpConfig]);

function expandEnvironment(value: string): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^{}]*))?\}/g,
    (_match, name: string, fallback: string | undefined) => {
      const environment = process.env[name];
      if (fallback !== undefined && !environment) return fallback;
      if (environment !== undefined) return environment;
      throw new Error(`Missing MCP environment variable: ${name}`);
    },
  );
}

function expandValues(values: Record<string, string> | undefined) {
  return (
    values &&
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, expandEnvironment(value)]),
    )
  );
}

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

/** Authorization state belongs to the Session; connections still belong to each Run. */
export function createMcpAuthState() {
  return {
    needsAuth: new Set<string>(),
    stores: new Map<string, MemoryOAuthStateStore>(),
  };
}

/** Connections belong to a Run, so later Runs rediscover current server capabilities. */
export function createMcpConnections(authState: ReturnType<typeof createMcpAuthState>) {
  const clients: McpClient[] = [];
  const connected = new Map<string, McpClient>();
  const errors: Extract<CustomSessionEvent, { type: "mcp_server_error" }>[] = [];
  const authRequired: Extract<CustomSessionEvent, { type: "mcp_auth_required" }>[] = [];
  const authTools = new Set<string>();
  const reportedAuth = new Set<string>();
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
    authRequired,
    authTools,
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
      interactive?: boolean;
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
        let requireAuth: (() => void) | undefined;
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
          const parsed = Value.Parse(ServerConfig, value);
          if ("url" in parsed && parsed.oauth?.authServerMetadataUrl !== undefined) {
            let valid = false;
            try {
              valid = new URL(parsed.oauth.authServerMetadataUrl).protocol === "https:";
            } catch {
              // Invalid URLs are configuration errors, before any connection is attempted.
            }
            if (!valid)
              throw new Error(
                "Invalid MCP configuration: /oauth/authServerMetadataUrl must be an HTTPS URL.",
              );
          }
          const entry =
            "url" in parsed
              ? {
                  ...parsed,
                  url: expandEnvironment(parsed.url),
                  headers: expandValues(parsed.headers),
                }
              : { ...parsed, env: expandValues(parsed.env) };
          const key =
            "url" in entry ? JSON.stringify([server, entry.url, entry.headers]) : undefined;
          requireAuth = () => {
            if (key) authState.needsAuth.add(key);
            if (!reportedAuth.has(server)) {
              reportedAuth.add(server);
              authRequired.push({ type: "mcp_auth_required", server });
            }
            if (!options.interactive) return;
            const name = `mcp__${server}__authenticate`;
            authTools.add(name);
            tools.push({
              name,
              label: name,
              description: `The ${server} MCP server is installed but requires authentication. Call this tool to start the OAuth flow; the user completes it in their browser and the server's real tools become available in your next turn.`,
              parameters: Type.Object({}),
              async execute() {
                return {
                  content: [
                    { type: "text", text: "MCP OAuth authentication is not implemented yet." },
                  ],
                  details: {},
                  isError: true,
                };
              },
            });
            toolServers.set(name, server);
            descriptions.push(`${server}: requires authentication. Tools: ${name}`);
          };
          if (key && authState.needsAuth.has(key)) {
            requireAuth();
            continue;
          }
          let provider: McpOAuthProvider | undefined;
          if ("url" in entry && key) {
            let store = authState.stores.get(key);
            if (!store) {
              store = new MemoryOAuthStateStore();
              authState.stores.set(key, store);
            }
            provider = new McpOAuthProvider({
              serverUrl: entry.url,
              redirectUrl: "http://localhost/callback",
              clientMetadata: { client_name: "Neant" },
              store,
              // Discovery may produce a URL, but only an explicit Interaction opens it.
              onRedirect: () => {},
            });
          }
          const transport =
            "url" in entry
              ? new StreamableHttpTransport({
                  url: entry.url,
                  headers: entry.headers,
                  authProvider: provider && adaptOAuthProvider(provider),
                })
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
          if (
            requireAuth &&
            (error instanceof McpAuthRequiredError ||
              error instanceof McpOAuthAuthorizationRequiredError)
          )
            requireAuth();
          else report(server, error);
        }
      }
    },
    close,
  };
}
