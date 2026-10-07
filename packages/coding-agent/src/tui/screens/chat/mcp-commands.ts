import type { Session } from "@neant/agent";
import type { McpSnapshot } from "@neant/shared";
import { formatError, type createTuiI18n } from "../../../view/i18n";
import type { createConversation } from "../../../view/conversation/conversation";

/** Own the cached public MCP snapshot for one mounted Session. */
export function createMcpCommands(
  session: Session,
  output: Pick<ReturnType<typeof createConversation>, "notify" | "notice" | "isRunning">,
  t: ReturnType<typeof createTuiI18n>,
) {
  let active = true;
  let snapshot: McpSnapshot | undefined;
  let reading: Promise<McpSnapshot> | undefined;
  let managing = false;
  const listeners = new Set<() => void>();
  const read = (refresh = false): Promise<McpSnapshot> => {
    if (reading) return reading;
    reading = session
      .mcpServers(refresh ? { refresh: true } : undefined)
      .then((next) => {
        if (active) {
          snapshot = next;
          listeners.forEach((listener) => listener());
        }
        return next;
      })
      .finally(() => {
        reading = undefined;
      });
    return reading;
  };
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "mcp_servers_changed" && active && snapshot) void read().catch(() => {});
  });
  const manage = async (action: "login" | "logout" | "reconnect" | "retry", name?: string) => {
    if (output.isRunning() || managing)
      return { text: t("command.busy", { name: "mcp" }), kind: "warning" as const };
    managing = true;
    try {
      if (action === "retry") {
        await read(true);
        return { text: t("mcp.panel.refreshed"), kind: "success" as const };
      }
      const outcome =
        action === "login"
          ? await session.authenticateMcp(name!)
          : action === "logout"
            ? await session.clearMcpAuth(name!)
            : await session.reconnectMcp(name!);
      await read();
      return outcome?.type === "cancelled"
        ? { text: t("mcp.auth.cancelled"), kind: "dim" as const }
        : {
            text: t(
              action === "login"
                ? "mcp.auth.success"
                : action === "logout"
                  ? "mcp.logout"
                  : "mcp.reconnect",
              { name: name! },
            ),
            kind: "success" as const,
          };
    } catch (error: unknown) {
      await read().catch(() => {});
      return { text: t("mcp.failure", { err: formatError(error, t) }), kind: "error" as const };
    } finally {
      managing = false;
    }
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    read,
    manage,
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
      return (snapshot?.servers ?? [])
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
      if (output.isRunning() || managing) {
        output.notice(t("command.busy", { name: "mcp" }));
        return;
      }
      const [action, name] = args;
      if (args.length !== 2 || !["login", "logout", "reconnect"].includes(action!)) {
        output.notify(t("mcp.usage"), "warning");
        return;
      }
      // Parsing above admits only the three public management commands.
      void manage(action as "login" | "logout" | "reconnect", name).then((result) => {
        if (active)
          output.notify(result.text, result.kind, result.kind === "error" ? 8000 : undefined);
      });
    },
    stop() {
      active = false;
      unsubscribe();
      listeners.clear();
    },
  };
}
