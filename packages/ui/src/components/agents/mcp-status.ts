import type { McpSnapshot } from "@rukie/shared";
import type { useAppText } from "@/lib/i18n";

export function mcpSummary(snapshot: McpSnapshot | undefined, t: ReturnType<typeof useAppText>) {
  if (!snapshot) return t("app.mcp-loading");
  if (!snapshot.servers.length && !snapshot.configErrors.length) return t("app.mcp-unconfigured");
  const counts = {
    connected: snapshot.servers.filter((server) => server.status === "connected").length,
    tools: snapshot.servers.reduce((sum, server) => sum + server.toolCount, 0),
    pending: snapshot.servers.filter((server) => server.status === "pending").length,
    "needs-auth": snapshot.servers.filter((server) => server.status === "needs-auth").length,
    failed: snapshot.servers.filter((server) => server.status === "failed").length,
  };
  return (
    (Object.keys(counts) as (keyof typeof counts)[])
      .flatMap((key) => (counts[key] ? [t(`app.mcp-${key}`, { count: counts[key] })] : []))
      .join(" · ") ||
    t(snapshot.configErrors.length ? "app.mcp-config-error" : "app.mcp-state-project-required")
  );
}

/** Validate the presentation facts consumed from wire responses and events. */
export function isMcpSnapshot(value: unknown): value is McpSnapshot {
  if (!value || typeof value !== "object" || !("servers" in value) || !("configErrors" in value))
    return false;
  return (
    Array.isArray(value.servers) &&
    Array.isArray(value.configErrors) &&
    value.servers.every((server: unknown) => {
      if (!server || typeof server !== "object") return false;
      return (
        "name" in server &&
        typeof server.name === "string" &&
        "scope" in server &&
        (server.scope === "user" || server.scope === "project") &&
        "configPath" in server &&
        typeof server.configPath === "string" &&
        "transport" in server &&
        (server.transport === "stdio" || server.transport === "http") &&
        "status" in server &&
        ["connected", "pending", "needs-auth", "failed", "project-required"].includes(
          String(server.status),
        ) &&
        "toolCount" in server &&
        typeof server.toolCount === "number" &&
        Number.isInteger(server.toolCount) &&
        server.toolCount >= 0 &&
        "tools" in server &&
        Array.isArray(server.tools) &&
        server.tools.every((tool: unknown) =>
          Boolean(
            tool &&
            typeof tool === "object" &&
            "name" in tool &&
            typeof tool.name === "string" &&
            "description" in tool &&
            typeof tool.description === "string" &&
            "inputSchema" in tool,
          ),
        ) &&
        "auth" in server &&
        ["oauth", "headers", "none"].includes(String(server.auth)) &&
        (!("error" in server) || typeof server.error === "string")
      );
    }) &&
    value.configErrors.every((error: unknown) =>
      Boolean(
        error &&
        typeof error === "object" &&
        "scope" in error &&
        (error.scope === "project" || error.scope === "user") &&
        "path" in error &&
        typeof error.path === "string" &&
        "error" in error &&
        typeof error.error === "string",
      ),
    )
  );
}
