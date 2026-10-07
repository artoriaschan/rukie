import type { McpOAuthStateStore } from "@earendil-works/pi-mcp/oauth";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { OAuthMetadata } from "./oauth.ts";

const Strings = Type.Array(Type.String());
const State = Type.Object({
  serverUrl: Type.String(),
  tokens: Type.Optional(
    Type.Object({
      access_token: Type.String(),
      token_type: Type.String(),
      expires_in: Type.Optional(Type.Number()),
      scope: Type.Optional(Type.String()),
      refresh_token: Type.Optional(Type.String()),
      id_token: Type.Optional(Type.String()),
    }),
  ),
  tokensExpireAt: Type.Optional(Type.Number()),
  clientInformation: Type.Optional(
    Type.Object({
      client_id: Type.String(),
      client_secret: Type.Optional(Type.String()),
      client_id_issued_at: Type.Optional(Type.Number()),
      client_secret_expires_at: Type.Optional(Type.Number()),
      redirect_uris: Type.Optional(Strings),
      token_endpoint_auth_method: Type.Optional(Type.String()),
    }),
  ),
  codeVerifier: Type.Optional(Type.String()),
  oauthState: Type.Optional(Type.String()),
  discovery: Type.Optional(
    Type.Object({
      authorizationServerUrl: Type.String(),
      authorizationServerMetadata: Type.Optional(OAuthMetadata),
      resourceMetadataUrl: Type.Optional(Type.String()),
      resourceMetadata: Type.Optional(
        Type.Object({
          resource: Type.String(),
          authorization_servers: Type.Optional(Strings),
          scopes_supported: Type.Optional(Strings),
        }),
      ),
    }),
  ),
});
const Credentials = Type.Object({
  version: Type.Literal(1),
  mcp: Type.Record(
    Type.String(),
    Type.Object({ serverName: Type.String(), serverUrl: Type.String(), state: State }),
  ),
});

// Providers have separate queues; the file has one queue shared by all Sessions in this process.
const writes = new Map<string, Promise<void>>();
export function credentialKey(
  name: string,
  entry: { type?: string; url: string; headers?: Record<string, string> },
) {
  const hash = createHash("sha256")
    .update(JSON.stringify({ type: "http", url: entry.url, headers: entry.headers ?? {} }))
    .digest("hex")
    .slice(0, 16);
  return `${name}|${hash}`;
}

export function credentialStore(options: {
  homeDir: string;
  key: string;
  serverName: string;
  serverUrl: string;
  warning: () => void;
  signal?: AbortSignal;
}): McpOAuthStateStore & { clear(): Promise<void> } {
  const directory = join(options.homeDir, ".rukie");
  const path = join(directory, "credentials.json");
  const read = async () => {
    try {
      const data: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!Value.Check(Credentials, data)) throw new Error("Invalid credentials");
      return data;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
        options.warning();
      const empty: Static<typeof Credentials> = { version: 1, mcp: {} };
      return empty;
    }
  };
  const update = async (change: (data: Static<typeof Credentials>) => boolean) => {
    const operation = (writes.get(path) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        options.signal?.throwIfAborted();
        const data = await read();
        if (!change(data)) return;
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: "wx" });
          options.signal?.throwIfAborted();
          await rename(temporary, path);
        } finally {
          await rm(temporary, { force: true });
        }
      });
    writes.set(path, operation);
    try {
      await operation;
    } finally {
      if (writes.get(path) === operation) writes.delete(path);
    }
  };
  return {
    async load() {
      await writes.get(path);
      return (await read()).mcp[options.key]?.state;
    },
    save(state) {
      return update((data) => {
        data.mcp[options.key] = {
          serverName: options.serverName,
          serverUrl: options.serverUrl,
          state,
        };
        return true;
      });
    },
    clear() {
      return update((data) => {
        if (!(options.key in data.mcp)) return false;
        delete data.mcp[options.key];
        return true;
      });
    },
  };
}
