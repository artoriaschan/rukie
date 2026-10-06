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
  OAuthCallbackServer,
  authorizeMcp,
  adaptOAuthProvider,
  type OAuthFlowOptions,
} from "@earendil-works/pi-mcp/oauth";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  createUserVisibleError,
  type CustomSessionEvent,
  type Settings,
  type McpServerView,
  type UserVisibleErrorData,
} from "@neant/shared";
import { isTrustedProject } from "../config/index.ts";
import { requestInteraction, type OnInteractionStart } from "../interaction/index.ts";
import { preserveErrorDetails } from "../tools/index.ts";
import { credentialKey, credentialStore } from "./credentials.ts";
import { configureOAuthMetadata, createOAuthProvider } from "./oauth.ts";

export interface McpAuthRequest {
  server: string;
  authorizationUrl: string;
  origin?: { agentId: string; description: string };
  signal: AbortSignal;
}
export type McpAuthReply = { type: "callback-url"; url: string } | { type: "cancelled" };
export type OnMcpAuth = (request: McpAuthRequest) => Promise<McpAuthReply>;
export type McpAuthOutcome =
  | { type: "authenticated"; server: string }
  | { type: "cancelled"; server: string };

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
      throw createUserVisibleError(`Missing MCP environment variable: ${name}`, {
        code: "mcp-env-missing",
        params: { name },
      });
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

function requiresAuthentication(error: unknown) {
  return (
    error instanceof McpAuthRequiredError || error instanceof McpOAuthAuthorizationRequiredError
  );
}

/** Authorization state belongs to the Session; connections still belong to each Run. */
export function createMcpAuthState() {
  return {
    needsAuth: new Set<string>(),
    rejectedTokens: new Map<string, string | undefined>(),
    authorizationScopes: new Map<string, string>(),
    inFlight: new Map<string, Promise<McpAuthOutcome>>(),
    credentialWarning: false,
  };
}

/** Connections belong to a Run, so later Runs rediscover current server capabilities. */
export function createMcpConnections(authState: ReturnType<typeof createMcpAuthState>) {
  const clients: McpClient[] = [];
  const connected = new Map<string, McpClient>();
  const views = new Map<string, McpServerView>();
  const clearServerAuth = new Map<string, () => Promise<void>>();
  const authenticateServer = new Map<string, (signal?: AbortSignal) => Promise<McpAuthOutcome>>();
  const errors: Extract<CustomSessionEvent, { type: "mcp_server_error" }>[] = [];
  const authRequired: Extract<CustomSessionEvent, { type: "mcp_auth_required" }>[] = [];
  const authTools = new Set<string>();
  const reportedAuth = new Set<string>();
  const tools: AgentTool[] = [];
  const toolServers = new Map<string, string>();
  const descriptions = new Map<string, string>();
  const failed = new Set<string>();
  let closePromise: Promise<void> | undefined;
  let closing = false;
  let removeAbortListener: (() => void) | undefined;
  const report = (server: string, error: unknown) => {
    if (failed.has(server)) return;
    failed.add(server);
    // Neant creates coded Errors through createUserVisibleError, matching preserveErrorDetails.
    const errorData =
      error instanceof Error && "code" in error && "params" in error
        ? ({
            code: (error as Error & UserVisibleErrorData).code,
            params: (error as Error & UserVisibleErrorData).params,
          } as UserVisibleErrorData)
        : undefined;
    const view = views.get(server);
    if (view)
      views.set(server, {
        ...view,
        status: "failed",
        toolCount: 0,
        error: error instanceof Error ? error.message : String(error),
        ...(errorData && { errorData }),
      });
    errors.push({
      type: "mcp_server_error",
      server,
      error: error instanceof Error ? error.message : String(error),
      ...(errorData && { errorData }),
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
        throw createUserVisibleError("Expected an object containing mcpServers.", {
          code: "mcp-config-file-invalid",
          params: { source: path },
        });
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
    servers: () => structuredClone([...views.values()]),
    clearAuth(server: string) {
      const clear = clearServerAuth.get(server);
      if (!clear)
        throw createUserVisibleError(`MCP authentication requires an HTTP server: ${server}`, {
          code: "mcp-auth-http-required",
          params: { server },
        });
      return clear();
    },
    authenticate(server: string, signal?: AbortSignal) {
      const authenticate = authenticateServer.get(server);
      if (!authenticate)
        throw createUserVisibleError(`MCP server cannot authenticate: ${server}`, {
          code: "mcp-auth-http-required",
          params: { server },
        });
      return authenticate(signal);
    },
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
      return descriptions.size > 0;
    },
    reminder: () =>
      descriptions.size
        ? `MCP servers:\n${[...descriptions.values()].join("\n\n")}`
        : "MCP servers: none.",
    async connect(options: {
      cwd: string;
      homeDir: string;
      settings: Settings;
      trustProjectMcp?: boolean;
      signal?: AbortSignal;
      interactive?: boolean;
      onMcpAuth?: OnMcpAuth;
      onInteractionStart?: OnInteractionStart;
      onWarning?: (message: string) => void;
      onlyServer?: string;
      loadOnly?: boolean;
      reconnect?: boolean;
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
        if (options.onlyServer !== undefined && server !== options.onlyServer) continue;
        options.signal?.throwIfAborted();
        views.set(server, {
          name: server,
          transport: Value.Check(Type.Object({ url: Type.String() }), value) ? "http" : "stdio",
          status: "failed",
          toolCount: 0,
          auth: "none",
        });
        const client = new McpClient({
          name: "neant",
          title: server,
          version: "0.1.0",
        });
        let ready = false;
        let requireAuth: (() => void) | undefined;
        clients.push(client);
        client.onError((error) => {
          if (!closing) {
            if (requiresAuthentication(error) && requireAuth) requireAuth();
            else report(server, error);
          }
        });
        client.onClose(() => {
          connected.delete(server);
          if (ready && !closing)
            report(
              server,
              createUserVisibleError("MCP connection closed unexpectedly.", {
                code: "mcp-connection-lost",
                params: {},
              }),
            );
        });
        try {
          const [invalid] = Value.Errors(ServerConfig, value);
          if (invalid)
            throw createUserVisibleError(
              `Invalid MCP configuration: ${invalid.instancePath || "/"} ${invalid.message}`,
              {
                code: "mcp-config-invalid",
                params: { path: invalid.instancePath || "/", cause: invalid.message },
              },
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
              throw createUserVisibleError(
                "Invalid MCP configuration: /oauth/authServerMetadataUrl must be an HTTPS URL.",
                { code: "mcp-config-metadata-https", params: {} },
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
          views.set(server, {
            name: server,
            transport: "url" in entry ? "http" : "stdio",
            status: "failed",
            toolCount: 0,
            auth:
              "url" in entry
                ? entry.oauth
                  ? "oauth"
                  : Object.keys(entry.headers ?? {}).length
                    ? "headers"
                    : "none"
                : "none",
          });
          const setNeedsAuthView = () =>
            views.set(server, {
              name: server,
              transport: "url" in entry ? "http" : "stdio",
              status: "needs-auth",
              toolCount: 0,
              auth: "oauth",
            });
          const key = "url" in entry ? credentialKey(server, entry) : undefined;
          if (options.reconnect && key) {
            authState.needsAuth.delete(key);
            authState.rejectedTokens.delete(key);
            authState.authorizationScopes.delete(key);
          }
          const store =
            key && "url" in entry
              ? credentialStore({
                  homeDir: options.homeDir,
                  key,
                  serverName: server,
                  serverUrl: entry.url,
                  signal: options.signal,
                  warning: () => {
                    if (authState.credentialWarning) return;
                    authState.credentialWarning = true;
                    (options.onWarning ?? console.warn)(
                      "MCP credentials file is invalid; ignoring its contents.",
                    );
                  },
                })
              : undefined;
          let rejectedToken = (await store?.load())?.tokens?.access_token;
          const recordAuthorizationChallenge = async (url: URL) => {
            rejectedToken = (await store?.load())?.tokens?.access_token;
            const scope = url.searchParams.get("scope");
            if (key && scope) authState.authorizationScopes.set(key, scope);
          };
          const replaceTools = (adapted: AgentTool[]) => {
            for (let i = tools.length - 1; i >= 0; i--) {
              if (toolServers.get(tools[i]!.name) !== server) continue;
              authTools.delete(tools[i]!.name);
              toolServers.delete(tools[i]!.name);
              tools.splice(i, 1);
            }
            tools.push(...adapted);
            for (const tool of adapted) toolServers.set(tool.name, server);
          };
          const registerTools = async (activeClient: McpClient) => {
            const discovered = activeClient.serverCapabilities?.tools
              ? await activeClient.listTools({ signal: options.signal })
              : [];
            options.signal?.throwIfAborted();
            if (closing)
              throw createUserVisibleError("MCP connections are closed.", {
                code: "mcp-connection-closed",
                params: {},
              });
            ready = true;
            connected.set(server, activeClient);
            if (key) authState.needsAuth.delete(key);
            views.set(server, {
              name: server,
              transport: "url" in entry ? "http" : "stdio",
              status: "connected",
              toolCount: discovered.length,
              auth: (await store?.load())?.tokens ? "oauth" : (views.get(server)?.auth ?? "none"),
            });
            const adapted = discovered.map((tool) =>
              adaptTool(server, activeClient, tool, (error) => {
                if (!closing) {
                  if (requiresAuthentication(error)) requireAuth?.();
                  else report(server, error);
                }
              }),
            );
            replaceTools(adapted);
            descriptions.set(
              server,
              `${server}:\n${activeClient.instructions ?? ""}\nTools: ${adapted.map((tool) => tool.name).join(", ") || "none"}`,
            );
          };
          const authenticate = (toolSignal?: AbortSignal): Promise<McpAuthOutcome> => {
            const onMcpAuth = options.onMcpAuth;
            if (!key || !("url" in entry) || !store || !onMcpAuth)
              return Promise.reject(
                createUserVisibleError("MCP authentication requires an interactive HTTP server.", {
                  code: "mcp-auth-unavailable",
                  params: { server },
                }),
              );
            const shared = authState.inFlight.get(key);
            if (shared) return shared;
            const signal =
              toolSignal && options.signal
                ? AbortSignal.any([toolSignal, options.signal])
                : (toolSignal ?? options.signal);
            const guard = () => {
              signal?.throwIfAborted();
              if (closing)
                throw createUserVisibleError("MCP connections are closed.", {
                  code: "mcp-connection-closed",
                  params: {},
                });
            };
            const flow = async (): Promise<McpAuthOutcome> => {
              let callback: OAuthCallbackServer | undefined;
              const frontend = new AbortController();
              const declined: McpAuthOutcome = { type: "cancelled", server };
              const fetchWithSignal: NonNullable<OAuthFlowOptions["fetch"]> = (target, init) =>
                fetch(target, {
                  ...init,
                  signal:
                    signal && init?.signal
                      ? AbortSignal.any([signal, init.signal])
                      : (signal ?? init?.signal),
                });
              try {
                guard();
                callback = await OAuthCallbackServer.listen({
                  host: "127.0.0.1",
                  redirectHost: "localhost",
                  path: "/callback",
                  port: entry.oauth?.callbackPort,
                  timeoutMs: 300_000,
                });
                guard();
                let authorizationUrl: string | undefined;
                const provider = createOAuthProvider({
                  serverUrl: entry.url,
                  redirectUrl: callback.redirectUrl,
                  clientMetadata: { client_name: "Neant" },
                  clientId: entry.oauth?.clientId,
                  clientSecret: entry.oauth?.clientSecret,
                  store,
                  onRedirect: async (url) => {
                    await recordAuthorizationChallenge(url);
                    authorizationUrl = url.href;
                  },
                });
                configureOAuthMetadata(
                  provider,
                  entry.oauth?.authServerMetadataUrl,
                  fetchWithSignal,
                );
                const registered = await provider.clientInformation();
                if (
                  !entry.oauth?.clientId &&
                  registered &&
                  "redirect_uris" in registered &&
                  !registered.redirect_uris.includes(callback.redirectUrl)
                )
                  await provider.invalidateCredentials("client");
                await authorizeMcp(provider, {
                  serverUrl: entry.url,
                  fetch: fetchWithSignal,
                  skipRefresh: true,
                  scope: authState.authorizationScopes.get(key),
                });
                guard();
                if (!authorizationUrl)
                  throw createUserVisibleError(
                    "OAuth server did not provide an authorization URL.",
                    { code: "mcp-auth-url-missing", params: {} },
                  );
                const state = await provider.state();
                const callbackReply = callback
                  .waitForCallback(state)
                  .then((reply) => ({ type: "code" as const, code: reply.code }));
                // Install the callback wait before the frontend can open a browser synchronously.
                const interactionSignal = signal
                  ? AbortSignal.any([signal, frontend.signal])
                  : frontend.signal;
                const reply = await Promise.race([
                  callbackReply,
                  requestInteraction(
                    { server, authorizationUrl, signal: interactionSignal },
                    onMcpAuth,
                    { type: "cancelled" } satisfies McpAuthReply,
                    {
                      notification: {
                        message: `MCP server ${server} needs authorization`,
                        title: "MCP authorization",
                        notification_type: "mcp_auth",
                      },
                      notify: (notification) =>
                        options.onInteractionStart?.(notification, signal ?? interactionSignal),
                    },
                  ),
                ]);
                frontend.abort();
                if (signal?.aborted || reply.type === "cancelled") return declined;
                let code: string;
                if (reply.type === "code") code = reply.code;
                else {
                  let url: URL;
                  try {
                    url = new URL(reply.url);
                  } catch {
                    throw createUserVisibleError("Invalid OAuth callback URL.", {
                      code: "mcp-auth-callback-invalid",
                      params: {},
                    });
                  }
                  if (url.searchParams.get("state") !== state)
                    throw createUserVisibleError("OAuth callback state does not match.", {
                      code: "mcp-auth-state-mismatch",
                      params: {},
                    });
                  const error = url.searchParams.get("error");
                  if (error) throw new Error(url.searchParams.get("error_description") ?? error);
                  const pasted = url.searchParams.get("code");
                  if (!pasted)
                    throw createUserVisibleError(
                      "OAuth callback did not include an authorization code.",
                      { code: "mcp-auth-code-missing", params: {} },
                    );
                  code = pasted;
                }
                guard();
                await authorizeMcp(provider, {
                  serverUrl: entry.url,
                  authorizationCode: code,
                  fetch: fetchWithSignal,
                });
                guard();
                await callback.close();
                callback = undefined;
                guard();
                const authenticated = new McpClient({
                  name: "neant",
                  title: server,
                  version: "0.1.0",
                });
                clients.push(authenticated);
                await authenticated.connect(
                  new StreamableHttpTransport({
                    url: entry.url,
                    headers: entry.headers,
                    authProvider: adaptOAuthProvider(provider),
                  }),
                );
                guard();
                await registerTools(authenticated);
                authState.needsAuth.delete(key);
                authState.authorizationScopes.delete(key);
                return { type: "authenticated", server };
              } catch (error) {
                if (
                  signal?.aborted ||
                  (error instanceof Error && error.message === "OAuth callback timed out")
                )
                  return declined;
                throw error;
              } finally {
                frontend.abort();
                await callback?.close();
              }
            };
            const pending = flow()
              .then((outcome) => {
                if (outcome.type === "cancelled") setNeedsAuthView();
                return outcome;
              })
              .finally(() => {
                if (authState.inFlight.get(key) === pending) authState.inFlight.delete(key);
              });
            authState.inFlight.set(key, pending);
            return pending;
          };
          if ("url" in entry) authenticateServer.set(server, authenticate);
          if (key && store)
            clearServerAuth.set(server, async () => {
              const usedOAuth =
                (await store.load())?.tokens !== undefined ||
                authState.needsAuth.has(key) ||
                ("url" in entry && entry.oauth !== undefined);
              await store.clear();
              authState.needsAuth.delete(key);
              authState.rejectedTokens.delete(key);
              authState.authorizationScopes.delete(key);
              replaceTools([]);
              if (usedOAuth) setNeedsAuthView();
            });
          requireAuth = () => {
            ready = false;
            connected.delete(server);
            if (key) {
              authState.needsAuth.add(key);
              authState.rejectedTokens.set(key, rejectedToken);
            }
            setNeedsAuthView();
            if (!reportedAuth.has(server)) {
              reportedAuth.add(server);
              authRequired.push({ type: "mcp_auth_required", server });
            }
            if (!options.interactive) {
              replaceTools([]);
              descriptions.set(server, `${server}: requires authentication.`);
              return;
            }
            const name = `mcp__${server}__authenticate`;
            replaceTools([
              preserveErrorDetails({
                name,
                label: name,
                description: `The ${server} MCP server is installed but requires authentication. Call this tool to start the OAuth flow; the user completes it in their browser and the server's real tools become available in your next turn.`,
                parameters: Type.Object({}),
                async execute(_id, _args, signal) {
                  const outcome = await authenticate(signal);
                  return {
                    content: [
                      {
                        type: "text",
                        text:
                          outcome.type === "authenticated"
                            ? `Authenticated ${server}; its tools are now available.`
                            : `User did not complete authentication for ${server}.`,
                      },
                    ],
                    details: outcome,
                    isError: false,
                  };
                },
              }),
            ]);
            authTools.add(name);
            toolServers.set(name, server);
            descriptions.set(server, `${server}: requires authentication. Tools: ${name}`);
          };
          if (options.loadOnly) continue;
          if (
            key &&
            authState.needsAuth.has(key) &&
            authState.rejectedTokens.get(key) === rejectedToken
          ) {
            requireAuth();
            continue;
          }
          let provider: McpOAuthProvider | undefined;
          if ("url" in entry && key) {
            provider = createOAuthProvider({
              serverUrl: entry.url,
              redirectUrl: "http://localhost/callback",
              clientMetadata: { client_name: "Neant" },
              clientId: entry.oauth?.clientId,
              clientSecret: entry.oauth?.clientSecret,
              store,
              // Discovery may produce a URL, but only an explicit Interaction opens it.
              onRedirect: recordAuthorizationChallenge,
            });
            configureOAuthMetadata(provider, entry.oauth?.authServerMetadataUrl, (target, init) =>
              fetch(target, { ...init, signal: options.signal }),
            );
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
          await registerTools(client);
        } catch (error) {
          await client.close();
          options.signal?.throwIfAborted();
          if (requireAuth && requiresAuthentication(error)) requireAuth();
          else report(server, error);
        }
      }
    },
    close,
  };
}
