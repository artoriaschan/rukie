import { createHash } from "node:crypto";
import { Type } from "typebox";
import { Value } from "typebox/value";

const Rpc = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Number()])),
  method: Type.String(),
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

/** Real OAuth/HTTP boundary shared by Agent Core, Headless CLI and TUI tests. */
export function mcpOAuthServer(
  options: {
    registration?: boolean;
    clientId?: string;
    clientSecret?: string;
    authorizationError?: string;
    authentication?: boolean;
    beforeTokenResponse?: () => Promise<void>;
  } = {},
) {
  const requests: {
    path: string;
    method: string;
    authorization: string | null;
    body: unknown;
  }[] = [];
  const clients = new Map<string, { redirects: string[]; secret?: string }>();
  if (options.clientId)
    clients.set(options.clientId, { redirects: [], secret: options.clientSecret });
  const codes = new Map<string, { client: string; redirect: string; challenge: string }>();
  const accessTokens = new Set<string>();
  const refreshTokens = new Set<string>();
  let sequence = 0;
  let rejectRefresh = false;
  const oauthError = (error: string) => Response.json({ error }, { status: 400 });
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const origin = url.origin;
      let body: unknown;
      if (request.method === "POST") {
        body = request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")
          ? Object.fromEntries(new URLSearchParams(await request.text()))
          : await request.json().catch(() => undefined);
      }
      requests.push({
        path: url.pathname,
        method: request.method,
        authorization: request.headers.get("authorization"),
        body,
      });
      switch (url.pathname) {
        case "/.well-known/oauth-protected-resource":
        case "/.well-known/oauth-protected-resource/mcp":
          return Response.json({
            resource: `${origin}/mcp`,
            authorization_servers: [origin],
            scopes_supported: ["tools"],
          });
        case "/.well-known/oauth-authorization-server":
          return Response.json({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            ...(options.registration === false
              ? {}
              : { registration_endpoint: `${origin}/register` }),
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
          });
        case "/register": {
          if (options.registration === false) return new Response(null, { status: 404 });
          const metadata = Type.Object({ redirect_uris: Type.Array(Type.String()) });
          if (!Value.Check(metadata, body)) return oauthError("invalid_client_metadata");
          const id = `client-${++sequence}`;
          clients.set(id, { redirects: body.redirect_uris });
          return Response.json({ ...body, client_id: id }, { status: 201 });
        }
        case "/authorize": {
          const query = url.searchParams;
          const client = query.get("client_id") ?? "";
          const redirect = query.get("redirect_uri") ?? "";
          const registered = clients.get(client);
          const challenge = query.get("code_challenge");
          if (
            !registered ||
            (registered.redirects.length && !registered.redirects.includes(redirect))
          )
            return oauthError("invalid_client");
          if (
            query.get("response_type") !== "code" ||
            query.get("code_challenge_method") !== "S256" ||
            !challenge ||
            !/^[\w-]{43}$/.test(challenge)
          )
            return oauthError("invalid_request");
          const callback = new URL(redirect);
          callback.searchParams.set("state", query.get("state") ?? "");
          if (options.authorizationError)
            callback.searchParams.set("error", options.authorizationError);
          else {
            const code = `code-${++sequence}`;
            codes.set(code, { client, redirect, challenge });
            callback.searchParams.set("code", code);
          }
          return Response.redirect(callback.href, 302);
        }
        case "/token": {
          if (!Value.Check(Type.Record(Type.String(), Type.String()), body))
            return oauthError("invalid_request");
          const client = clients.get(body.client_id ?? "");
          if (!client || (client.secret && body.client_secret !== client.secret))
            return oauthError("invalid_client");
          if (body.grant_type === "authorization_code") {
            const code = codes.get(body.code ?? "");
            const challenge = createHash("sha256")
              .update(body.code_verifier ?? "")
              .digest("base64url");
            if (
              !code ||
              code.client !== body.client_id ||
              code.redirect !== body.redirect_uri ||
              code.challenge !== challenge
            )
              return oauthError("invalid_grant");
            codes.delete(body.code!);
          } else if (body.grant_type === "refresh_token") {
            if (rejectRefresh || !refreshTokens.delete(body.refresh_token ?? ""))
              return oauthError("invalid_grant");
          } else return oauthError("unsupported_grant_type");
          await options.beforeTokenResponse?.();
          const access = `access-${++sequence}`;
          const refresh = `refresh-${sequence}`;
          accessTokens.add(access);
          refreshTokens.add(refresh);
          return Response.json({
            access_token: access,
            refresh_token: refresh,
            token_type: "Bearer",
            expires_in: 3600,
          });
        }
        case "/mcp": {
          const authorization = request.headers.get("authorization") ?? "";
          if (
            options.authentication !== false &&
            !accessTokens.has(authorization.replace(/^Bearer /, ""))
          )
            return new Response("Authentication required", {
              status: 401,
              headers: {
                "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
              },
            });
          if (request.method === "GET") return new Response(null, { status: 405 });
          if (request.method === "DELETE") return new Response(null, { status: 204 });
          if (!Value.Check(Rpc, body)) return new Response(null, { status: 400 });
          if (body.id === undefined) return new Response(null, { status: 202 });
          const result =
            body.method === "initialize"
              ? {
                  protocolVersion: body.params?.protocolVersion,
                  serverInfo: { name: "oauth-test", version: "1" },
                  capabilities: { tools: {} },
                }
              : body.method === "tools/list"
                ? {
                    tools: [
                      {
                        name: "echo",
                        description: "Echo an authorized message",
                        inputSchema: { type: "object", properties: { text: { type: "string" } } },
                      },
                    ],
                  }
                : { content: [{ type: "text", text: "OAuth MCP: called" }] };
          return Response.json(
            { jsonrpc: "2.0", id: body.id, result },
            { headers: { "mcp-session-id": "oauth-test" } },
          );
        }
        default:
          return new Response(null, { status: 404 });
      }
    },
  });
  return {
    url: new URL("/mcp", server.url).href,
    requests,
    invalidateAccessToken() {
      accessTokens.clear();
    },
    rejectRefresh() {
      rejectRefresh = true;
    },
    stop: () => server.stop(true),
  };
}
