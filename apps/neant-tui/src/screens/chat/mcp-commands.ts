import type { Session } from "@neant/agent";
import type { McpServerView } from "@neant/shared";
import { formatError, type createTuiI18n } from "../../i18n";
import type { createConversation } from "./conversation";

/** Own the cached public MCP snapshot for one mounted Session. */
export function createMcpCommands(
  session: Session,
  output: Pick<ReturnType<typeof createConversation>, "report" | "notify" | "notice" | "isRunning">,
  t: ReturnType<typeof createTuiI18n>,
) {
  let active = true;
  let servers: McpServerView[] | undefined;
  let reading: { promise: Promise<void>; settled: boolean } | undefined;
  let managing = false;
  const listeners = new Set<() => void>();
  const refresh = () => {
    if (reading) return reading;
    const next = { promise: Promise.resolve(), settled: false };
    reading = next;
    next.promise = session
      .mcpServers()
      .then((views) => {
        next.settled = true;
        if (active) {
          servers = views;
          listeners.forEach((listener) => listener());
        }
      })
      .finally(() => {
        reading = undefined;
      });
    return next;
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => servers,
    complete(input: string) {
      const match = /^\/mcp[ \t]+([^ \t]*)(?:[ \t]+([^ \t]*))?$/i.exec(input);
      if (!match) return [];
      const action = match[1]!.toLowerCase();
      if (match[2] === undefined)
        return (["login", "logout", "reconnect"] as const)
          .filter((name) => name.startsWith(action))
          .map((name) => ({
            name,
            description: t(`mcp.complete.${name}`),
            completion: `/mcp ${name}`,
            needsArgument: true,
          }));
      if (!["login", "logout", "reconnect"].includes(action)) return [];
      return (servers ?? [])
        .filter((server) => server.name.toLowerCase().startsWith(match[2]!.toLowerCase()))
        .map((server) => ({
          name: server.name,
          description: t("mcp.complete.server"),
          completion: `/mcp ${action} ${server.name}`,
          needsArgument: false,
        }));
    },
    execute(input: string) {
      const args = input.trim().split(/\s+/).filter(Boolean);
      if (args.length) {
        if (output.isRunning() || managing) {
          output.notice(t("command.busy", { name: "mcp" }));
          return;
        }
        const [action, name] = args;
        if (args.length !== 2 || !["login", "logout", "reconnect"].includes(action!)) {
          output.notify(t("mcp.usage"), "warning");
          return;
        }
        managing = true;
        void (async () => {
          const outcome =
            action === "login"
              ? await session.authenticateMcp(name!)
              : action === "logout"
                ? await session.clearMcpAuth(name!)
                : await session.reconnectMcp(name!);
          await refresh().promise;
          if (!active) return;
          if (outcome?.type === "cancelled") output.notify(t("mcp.auth.cancelled"), "dim");
          else
            output.notify(
              t(
                action === "login"
                  ? "mcp.auth.success"
                  : action === "logout"
                    ? "mcp.logout"
                    : "mcp.reconnect",
                { name: name! },
              ),
              "success",
            );
        })()
          .catch((error: unknown) => {
            if (active)
              output.notify(t("mcp.failure", { err: formatError(error, t) }), "error", 8000);
          })
          .finally(() => {
            managing = false;
          });
        return;
      }
      const initial = servers === undefined;
      const request = refresh();
      let needsRerun = false;
      // Core returns its recorded snapshot immediately; only a pending initial probe needs loading.
      queueMicrotask(() => {
        if (active && initial && !request.settled) {
          needsRerun = true;
          output.report("/mcp", t("mcp.loading"));
        }
      });
      void request.promise
        .then(() => {
          if (!active || needsRerun || !servers) return;
          const lines =
            servers.length === 0
              ? [t("mcp.empty"), t("mcp.config")]
              : [
                  t("mcp.heading", { count: servers.length }),
                  ...servers.map(
                    (server) =>
                      `${server.name} · ${server.status}${t("mcp.tools", { count: server.toolCount })}`,
                  ),
                  ...(servers.some((server) => server.status === "needs-auth")
                    ? [t("mcp.needs-auth")]
                    : []),
                ];
          output.report("/mcp", lines.join("\n"));
        })
        .catch((error: unknown) => {
          if (active)
            output.notify(t("mcp.failure", { err: formatError(error, t) }), "error", 8000);
        });
    },
    stop() {
      active = false;
      listeners.clear();
    },
  };
}
