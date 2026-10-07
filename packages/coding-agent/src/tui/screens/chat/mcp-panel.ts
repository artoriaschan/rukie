import type { McpSnapshot } from "@rukie/shared";
import { mcpPanelChoices, type McpPanelPage } from "../../components/mcp-panel";
import { formatError, type createTuiI18n } from "../../../view/i18n";
import type { createMcpCommands } from "./mcp-commands";

interface PanelState {
  page: McpPanelPage;
  selected: string;
  focus: "body" | "actions";
  top: number;
  busy: boolean;
  result?: string;
}
const identity = (page: McpPanelPage) =>
  JSON.stringify(
    page.kind === "servers"
      ? [page.kind]
      : page.kind === "tool"
        ? [page.kind, page.server.name, page.tool.name]
        : [page.kind, page.server.name],
  );

/** Screen-owned navigation and operation lifetime, independent of rendering or Transcript. */
export function createMcpPanel(
  commands: ReturnType<typeof createMcpCommands>,
  configPaths: { user: string; project: string },
  t: ReturnType<typeof createTuiI18n>,
) {
  let active = true;
  let generation = 0;
  let state: PanelState | undefined;
  const results = new Map<string, string>();
  const saved = new Map<string, Pick<PanelState, "selected" | "focus" | "top">>();
  const listeners = new Set<() => void>();
  const publish = (next: PanelState | undefined) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const remember = () => {
    if (state)
      saved.set(identity(state.page), {
        selected: state.selected,
        focus: state.focus,
        top: saved.get(identity(state.page))?.top ?? state.top,
      });
  };
  const go = (page: McpPanelPage, result?: string) => {
    remember();
    const previous = saved.get(identity(page));
    const choices = mcpPanelChoices(page);
    publish({
      page,
      selected: previous
        ? choices.includes(previous.selected)
          ? previous.selected
          : ""
        : (choices[0] ?? ""),
      focus: previous?.focus ?? (page.kind === "tool" ? "body" : "actions"),
      top: previous?.top ?? 0,
      busy: state?.busy ?? false,
      result: result ?? results.get(identity(page)),
    });
  };
  const serversPage = (
    snapshot: McpSnapshot | null,
  ): Extract<McpPanelPage, { kind: "servers" }> => ({
    kind: "servers",
    snapshot,
    configPaths,
  });
  const reconcile = (snapshot: McpSnapshot) => {
    if (!active || !state) return;
    const page = state.page;
    let next: McpPanelPage = serversPage(snapshot);
    let changed = false;
    if (page.kind !== "servers") {
      const server = snapshot.servers.find((item) => item.name === page.server.name);
      if (!server) changed = true;
      else if (page.kind === "server") next = { kind: "server", server };
      else if (!server.tools.length) {
        next = { kind: "server", server };
        changed = true;
      } else if (page.kind === "tools") next = { kind: "tools", server };
      else {
        const tool = server.tools.find((item) => item.name === page.tool.name);
        if (tool) next = { kind: "tool", server, tool };
        else {
          next = { kind: "tools", server };
          changed = true;
        }
      }
    }
    if (changed) go(next, t("mcp.panel.changed"));
    else {
      const choices = mcpPanelChoices(next);
      const initial = page.kind === "servers" && (page.loading || page.snapshot === null);
      publish({
        ...state,
        page: next,
        selected: choices.includes(state.selected)
          ? state.selected
          : initial
            ? (choices[0] ?? "")
            : "",
      });
    }
  };
  const unsubscribe = commands.subscribe(() => {
    const snapshot = commands.getSnapshot();
    if (snapshot) reconcile(snapshot);
  });
  const back = () => {
    if (!state) return;
    const page = state.page;
    if (page.kind === "servers") {
      generation++;
      remember();
      publish(undefined);
    } else if (page.kind === "server") go(serversPage(commands.getSnapshot() ?? null));
    else if (page.kind === "tools") go({ kind: "server", server: page.server });
    else go({ kind: "tools", server: page.server });
  };
  const activate = (key: string) => {
    if (!state || !mcpPanelChoices(state.page).includes(key)) return;
    const page = state.page;
    if (key === "back") {
      back();
      return;
    }
    if (page.kind === "servers" && key.startsWith("server:")) {
      const server = page.snapshot?.servers.find((item) => item.name === key.slice(7));
      if (server) go({ kind: "server", server });
    } else if (page.kind === "server" && key === "tools")
      go({ kind: "tools", server: page.server });
    else if (page.kind === "tools" && key.startsWith("tool:")) {
      const tool = page.server.tools.find((item) => item.name === key.slice(5));
      if (tool) go({ kind: "tool", server: page.server, tool });
    } else if (["login", "logout", "reconnect", "retry"].includes(key) && !state.busy) {
      const currentGeneration = generation;
      const operationPage = identity(page);
      publish({ ...state, busy: true, result: undefined });
      // Choice validation above limits this union to the four management actions.
      void commands
        .manage(
          key as "login" | "logout" | "reconnect" | "retry",
          page.kind === "server" ? page.server.name : undefined,
        )
        .then((result) => {
          if (!active || currentGeneration !== generation || !state) return;
          results.set(operationPage, result.text);
          publish({
            ...state,
            busy: false,
            result: identity(state.page) === operationPage ? result.text : state.result,
          });
        });
    }
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    open() {
      generation++;
      saved.clear();
      results.clear();
      go({ ...serversPage(commands.getSnapshot() ?? null), loading: !commands.getSnapshot() });
      const currentGeneration = generation;
      void commands.read().catch((error: unknown) => {
        if (active && state && currentGeneration === generation)
          publish({
            ...state,
            page: {
              kind: "servers",
              snapshot: commands.getSnapshot() ?? null,
              configPaths,
              error: formatError(error, t),
            },
            selected: "retry",
          });
      });
    },
    close() {
      generation++;
      remember();
      publish(undefined);
    },
    back,
    activate,
    move(delta: number) {
      if (!state) return;
      const choices = mcpPanelChoices(state.page);
      if (!choices.length) return;
      const index = choices.indexOf(state.selected);
      const next =
        index < 0
          ? delta < 0
            ? choices.length - 1
            : 0
          : (index + delta + choices.length) % choices.length;
      publish({ ...state, selected: choices[next]!, focus: "actions" });
    },
    focus(body?: boolean) {
      if (state)
        publish({
          ...state,
          focus:
            body === undefined
              ? state.focus === "body"
                ? "actions"
                : "body"
              : body
                ? "body"
                : "actions",
        });
    },
    top() {
      return state ? (saved.get(identity(state.page))?.top ?? state.top) : 0;
    },
    scroll(top: number) {
      if (state)
        saved.set(identity(state.page), { selected: state.selected, focus: state.focus, top });
    },
    stop() {
      active = false;
      generation++;
      unsubscribe();
      listeners.clear();
      state = undefined;
    },
  };
}
