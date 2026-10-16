import { join, resolve } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createUserVisibleError, type McpConfigError, type Settings } from "@rukie/shared";
import { isTrustedProject } from "../config/index.ts";
import { userDataDirectory } from "../config/paths.ts";
import type { McpPersistence } from "./index.ts";

export interface McpConfigurationEntry {
  value: unknown;
  rawValue?: unknown;
  scope: "user" | "project";
  configPath: string;
  /** Global singleton or canonical project directory; distinct from presentation scope. */
  connectionScope: string;
  error?: unknown;
}
export interface McpConfiguration {
  servers: Map<string, McpConfigurationEntry>;
  configErrors: McpConfigError[];
}
export interface McpConfigurationOptions {
  cwd?: string;
  homeDir: string;
  dataRoot?: string;
  persistence?: McpPersistence;
  settings: Settings;
  trustProjectMcp?: boolean;
}

function expand(value: string, cwd?: string): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^{}]*))?\}/g,
    (_match, name: string, fallback: string | undefined) => {
      const environment = name === "RUKIE_PROJECT_DIR" ? cwd : process.env[name];
      if (fallback !== undefined && !environment) return fallback;
      if (environment !== undefined) return environment;
      throw createUserVisibleError(`Missing MCP environment variable: ${name}`, {
        code: "mcp-env-missing",
        params: { name },
      });
    },
  );
}

/** Resolve sources and reserved project substitutions before calculating connection identity. */
export async function readMcpConfiguration(
  options: McpConfigurationOptions,
): Promise<McpConfiguration> {
  const servers = new Map<string, McpConfigurationEntry>();
  const configErrors: McpConfigError[] = [];
  const read = async (path: string, scope: "user" | "project") => {
    try {
      if (!(await Bun.file(path).exists())) return {};
      const data: unknown = await Bun.file(path).json();
      if (
        !Value.Check(Type.Object({ mcpServers: Type.Record(Type.String(), Type.Unknown()) }), data)
      )
        throw createUserVisibleError("Expected an object containing mcpServers.", {
          code: "mcp-config-file-invalid",
          params: { source: path },
        });
      return data.mcpServers;
    } catch (error) {
      configErrors.push({
        scope,
        path,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && "code" in error && error.code === "mcp-config-file-invalid"
          ? { errorData: { code: "mcp-config-file-invalid", params: { source: path } } }
          : {}),
      });
      return {};
    }
  };
  const userPath = join(userDataDirectory(options), "mcp.json");
  const user = options.persistence
    ? await options.persistence.configuration()
    : options.dataRoot !== undefined
      ? {}
      : await read(userPath, "user");
  for (const [name, value] of Object.entries(user))
    servers.set(name, { value, scope: "user", configPath: userPath, connectionScope: "global" });
  if (options.cwd && (options.trustProjectMcp || isTrustedProject(options.cwd, options.settings))) {
    const path = join(options.cwd, ".mcp.json");
    for (const [name, value] of Object.entries(await read(path, "project")))
      servers.set(name, {
        value,
        scope: "project",
        configPath: path,
        connectionScope: options.cwd,
      });
  }
  for (const entry of servers.values()) {
    const raw = entry.value;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const config: Record<string, unknown> = { ...raw };
    entry.rawValue = raw;
    const projectDependent = [config.args, config.env, config.cwd].some((value) =>
      /\$\{RUKIE_PROJECT_DIR(?::-[^{}]*)?\}/.test(JSON.stringify(value) ?? ""),
    );
    if (entry.scope === "project" || projectDependent)
      entry.connectionScope = options.cwd ?? "project-required";
    if (entry.connectionScope === "project-required") continue;
    try {
      if (typeof config.url === "string") config.url = expand(config.url, options.cwd);
      for (const name of ["headers", "env"]) {
        const values = config[name];
        if (Value.Check(Type.Record(Type.String(), Type.String()), values))
          config[name] = Object.fromEntries(
            Object.entries(values).map(([key, value]) => [key, expand(value, options.cwd)]),
          );
      }
      if (Value.Check(Type.Array(Type.String()), config.args))
        config.args = config.args.map((arg) => expand(arg, options.cwd));
      if (typeof config.command === "string") {
        const base = entry.connectionScope === "global" ? options.homeDir : options.cwd!;
        if (config.cwd === undefined) config.cwd = base;
        else if (typeof config.cwd === "string" && config.cwd.length)
          config.cwd = resolve(base, expand(config.cwd, options.cwd));
      }
      entry.value = config;
    } catch (error) {
      entry.error = error;
    }
  }
  return { servers, configErrors };
}

/** Object key order is irrelevant to a configuration generation. */
export function configurationSignature(value: unknown): string {
  return JSON.stringify(value, (_key, member: unknown) => {
    if (member !== null && typeof member === "object" && !Array.isArray(member))
      return Object.fromEntries(Object.entries(member).sort(([a], [b]) => a.localeCompare(b)));
    return member;
  });
}
