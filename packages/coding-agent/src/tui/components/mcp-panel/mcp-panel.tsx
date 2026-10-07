import type { Ref } from "react";
import type { Locale } from "@neant/i18n";
import type { McpServerView, McpSnapshot, McpToolView } from "@neant/shared";
import {
  Box,
  Divider,
  HintLine,
  ListItem,
  ThemedText,
  type ScrollHandle,
  type ScrollSnapshot,
  StatusIcon,
  ScrollBox,
} from "../../../ink/index.ts";
import { createTuiI18n, formatError } from "../../i18n";

export type McpPanelPage =
  | {
      kind: "servers";
      snapshot: McpSnapshot | null;
      configPaths: { user: string; project: string };
      error?: string;
      loading?: boolean;
    }
  | { kind: "server"; server: McpServerView }
  | { kind: "tools"; server: McpServerView }
  | { kind: "tool"; server: McpServerView; tool: McpToolView };

export interface McpPanelProps {
  page: McpPanelPage;
  /** Keys preserve raw names after server:/tool:; decode by removing only that fixed prefix.
   * The screen remembers the selected key separately for each server/tool page. */
  selected: string;
  columns: number;
  /** Total space supplied by the screen after persistent panels and input reservation. */
  maxHeight: number;
  locale: Locale;
  focus?: "body" | "actions";
  busy?: boolean;
  /** The screen pauses callbacks and the picker cursor during Interaction or small-terminal takeover. */
  interactive?: boolean;
  /** Already localized operation outcome or page-change notice. */
  result?: string;
  scrollRef?: Ref<ScrollHandle>;
  /** Mount-time restoration; save the handle's top before leaving a reading page. */
  initialTop?: number;
  onScroll?(snapshot: ScrollSnapshot): void;
  onActivate(key: string): void;
  onListWheel?(delta: number): void;
  onBodyFocus?(): void;
  /** Routed body wheel: scroll the exposed handle here and avoid a second global wheel handler. */
  onBodyWheel?(delta: number): void;
}

type Action = "tools" | "login" | "logout" | "reconnect" | "back" | "retry";

function serverActions(server: McpServerView): Action[] {
  return [
    ...(server.tools.length ? ["tools" as const] : []),
    ...(server.transport === "http" && server.auth === "oauth"
      ? [...(server.status === "needs-auth" ? ["login" as const] : []), "logout" as const]
      : []),
    "reconnect",
    "back",
  ];
}

const compareName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : Number(a.name > b.name);
const serversFor = (snapshot: McpSnapshot | null) =>
  [...(snapshot?.servers ?? [])].sort((a, b) =>
    a.scope === b.scope ? compareName(a, b) : a.scope === "project" ? -1 : 1,
  );

/** The screen uses the same ordered choices for keyboard/wheel selection and activation. */
export function mcpPanelChoices(page: McpPanelPage): string[] {
  if (page.kind === "servers") {
    if (page.loading || (!page.snapshot && !page.error)) return [];
    return [
      ...serversFor(page.snapshot).map((server) => `server:${server.name}`),
      ...(page.error || page.snapshot?.configErrors.length ? ["retry"] : []),
    ];
  }
  if (page.kind === "tools")
    return [...[...page.server.tools].sort(compareName).map((tool) => `tool:${tool.name}`), "back"];
  if (page.kind === "tool") return ["back"];
  return serverActions(page.server);
}

const singleLine = (value: string) => value.replace(/\s+/g, " ").trim();

type Copy = ReturnType<typeof createTuiI18n>;
interface Row {
  key: string;
  label: string;
  description?: string;
  group?: string;
  status?: McpServerView["status"];
  selectable?: boolean;
}

function errorText(error: string, data: McpServerView["errorData"], t: Copy) {
  return data ? formatError({ ...data, message: error }, t) : error;
}

function presentation(
  page: McpPanelPage,
  t: Copy,
): { title: string; rows: Row[]; body: string; actions: Action[] } {
  if (page.kind === "servers") {
    const servers = serversFor(page.snapshot);
    const errors = page.snapshot?.configErrors ?? [];
    const rows: Row[] = servers.map((server) => ({
      key: `server:${server.name}`,
      label: `${server.name} · ${t(`mcp.panel.status.${server.status}`)} · ${t("mcp.panel.tool-count", { count: server.toolCount })}`,
      group: `${t(`mcp.panel.${server.scope}`)} · ${server.configPath}`,
      status: server.status,
    }));
    rows.push(
      ...errors.map((error, index) => ({
        key: `diagnostic:${index}`,
        label: `${errorText(error.error, error.errorData, t)} · ${error.path}`,
        selectable: false,
      })),
    );
    if (page.error) rows.push({ key: "diagnostic:read", label: page.error, selectable: false });
    const loading = page.loading || (!page.snapshot && !page.error);
    const body = loading
      ? t("mcp.panel.loading")
      : rows.length
        ? ""
        : [
            t("mcp.empty"),
            `${t("mcp.panel.user")}: ${page.configPaths.user}`,
            `${t("mcp.panel.project")}: ${page.configPaths.project}`,
            t("mcp.panel.trust"),
          ].join("\n");
    return {
      title: t("mcp.panel.title", { count: servers.length }),
      rows: loading ? [] : rows,
      body,
      actions: !loading && (errors.length || page.error) ? ["retry"] : [],
    };
  }
  if (page.kind === "tools")
    return {
      title: t("mcp.panel.tools-title", {
        name: page.server.name,
        count: page.server.tools.length,
      }),
      rows: [...page.server.tools].sort(compareName).map((tool) => ({
        key: `tool:${tool.name}`,
        label: tool.name,
        description: tool.description.replace(/\s+/g, " ").trim(),
      })),
      body: page.server.tools.length ? "" : t("mcp.panel.no-tools"),
      actions: ["back"],
    };
  if (page.kind === "tool")
    return {
      title: page.tool.name,
      rows: [],
      body: `${page.tool.description || t("mcp.panel.no-description")}\n\n${t("mcp.panel.schema")}\n${JSON.stringify(page.tool.inputSchema, null, 2) ?? "null"}`,
      actions: ["back"],
    };
  const server = page.server;
  return {
    title: server.name,
    rows: [],
    body: [
      `${t("mcp.panel.status")}: ${t(`mcp.panel.status.${server.status}`)}`,
      `${t("mcp.panel.transport")}: ${server.transport}`,
      `${t("mcp.panel.source")}: ${t(`mcp.panel.${server.scope}`)}`,
      `${t("mcp.panel.config-path")}: ${server.configPath}`,
      ...(server.url ? [`URL: ${server.url}`] : []),
      ...(server.command ? [`${t("mcp.panel.command")}: ${server.command}`] : []),
      `${t("mcp.panel.auth")}: ${t(`mcp.panel.auth.${server.auth}`)}`,
      t("mcp.panel.tool-count", { count: server.toolCount }),
      ...(server.error ? [errorText(server.error, server.errorData, t)] : []),
    ].join("\n"),
    actions: serverActions(page.server),
  };
}

function rowCost(rows: readonly Row[], start: number, end: number, headings = true) {
  let cost = 0;
  for (let i = start; i < end; i++) {
    const row = rows[i]!;
    cost +=
      (row.description !== undefined ? 2 : 1) +
      Number(headings && !!row.group && (i === start || row.group !== rows[i - 1]?.group));
  }
  return cost;
}

function focusWindow(rows: readonly Row[], selected: string, budget: number) {
  const focus = Math.max(
    0,
    rows.findIndex((row) => row.key === selected),
  );
  let start = focus;
  let end = Math.min(rows.length, start + 1);
  const headings = budget >= rowCost(rows, start, end);
  while (true) {
    const up = start > 0 && rowCost(rows, start - 1, end, headings) <= budget;
    const down = end < rows.length && rowCost(rows, start, end + 1, headings) <= budget;
    if (!up && !down) return { start, end, headings };
    if (up && (!down || focus - start <= end - focus - 1)) start--;
    else end++;
  }
}

function layout(props: McpPanelProps, view: ReturnType<typeof presentation>) {
  const limit = Math.max(0, Math.min(14, Math.floor(props.maxHeight)));
  const top = limit >= 9 ? 2 : 0;
  const padding = limit >= 9 ? 2 : 1;
  const width = Math.max(1, props.columns - padding * 2);
  const contentSpace = Math.max(0, limit - top - 3);
  // At five rows, feedback shares the divider so body and selected action remain usable.
  const dividerResult =
    (!!props.result || !!props.busy) && !!view.actions.length && contentSpace < 3;
  const resultRows = dividerResult
    ? 0
    : Math.min(Number(!!props.result || !!props.busy), contentSpace);
  const space = contentSpace - resultRows;
  const actionRows = Math.min(view.actions.length, 3, Math.max(0, space - Number(space > 1)));
  const naturalBody = view.rows.length
    ? rowCost(view.rows, 0, view.rows.length)
    : view.body
        .split("\n")
        .reduce((sum, line) => sum + Math.max(1, Math.ceil(Bun.stringWidth(line) / width)), 0);
  const bodyRows = Math.min(naturalBody, Math.max(0, space - actionRows));
  return {
    top,
    padding,
    width,
    bodyRows,
    actionRows,
    resultRows,
    dividerResult,
    height: limit < 3 ? limit : top + 3 + bodyRows + actionRows + resultRows,
  };
}

/** Actual flow height, including divider, title and fixed footer; never exceeds the screen budget. */
export function mcpPanelHeight(props: McpPanelProps): number {
  return layout(props, presentation(props.page, createTuiI18n(props.locale))).height;
}

export function McpPanel(props: McpPanelProps) {
  const { page, selected, onActivate, interactive = true } = props;
  const t = createTuiI18n(props.locale);
  const view = presentation(page, t);
  const { top, padding, width, bodyRows, actionRows, resultRows, dividerResult, height } = layout(
    props,
    view,
  );
  const result = props.busy ? t("mcp.panel.working") : singleLine(props.result ?? "");
  const window = focusWindow(view.rows, selected, bodyRows);
  const actionCopy: Record<Action, string> = {
    tools: t("mcp.panel.action.tools"),
    login: t("mcp.panel.action.login"),
    logout: t("mcp.panel.action.logout"),
    reconnect: t("mcp.panel.action.reconnect"),
    back: t("mcp.panel.action.back"),
    retry: t("mcp.panel.retry"),
  };
  const actions = view.actions.map((key) => ({
    key,
    label:
      key === "retry" ? `${actionCopy[key]} · ${t("mcp.panel.config-errors")}` : actionCopy[key],
  }));
  const actionWindow = focusWindow(actions, selected, actionRows);
  const focusedActions = props.focus !== "body";
  const hint =
    page.kind === "server"
      ? t(focusedActions ? "mcp.panel.actions-hint" : "mcp.panel.body-hint")
      : page.kind === "tool"
        ? t("mcp.panel.reader-hint")
        : page.kind === "tools"
          ? t("mcp.panel.tools-hint")
          : t("mcp.panel.list-hint");
  const listWindow = page.kind === "servers" || page.kind === "tools" ? window : actionWindow;
  const listCount =
    page.kind === "servers" || page.kind === "tools" ? view.rows.length : actions.length;
  const boundary = `${listWindow.start > 0 ? "↑ " : ""}${listWindow.end < listCount ? "↓ " : ""}`;
  if (height === 0) return null;
  if (height < 3)
    return (
      <Box height={height} flexDirection="column" flexShrink={0}>
        <ThemedText color="remember" bold wrap="truncate">
          {singleLine(view.title)}
        </ThemedText>
        {height === 2 && <HintLine>{boundary + hint}</HintLine>}
      </Box>
    );
  const activate = (key: string) =>
    interactive && (!props.busy || !["login", "logout", "reconnect", "retry"].includes(key))
      ? () => onActivate(key)
      : undefined;
  return (
    <Box flexDirection="column" flexShrink={0} height={height} paddingTop={top}>
      <Divider color="permission" title={dividerResult ? result : undefined} />
      <Box flexDirection="column" paddingX={padding}>
        <ThemedText color="remember" bold wrap="truncate">
          {singleLine(view.title)}
        </ThemedText>
        {bodyRows > 0 &&
          (view.rows.length ? (
            <Box
              flexDirection="column"
              height={bodyRows}
              flexShrink={0}
              onWheel={interactive ? (event) => props.onListWheel?.(event.delta) : undefined}
            >
              {view.rows.slice(window.start, window.end).map((row, index) => (
                <Box
                  key={row.key}
                  flexDirection="column"
                  height={Math.min(
                    bodyRows,
                    rowCost(view.rows, window.start + index, window.start + index + 1, false) +
                      Number(
                        window.headings &&
                          !!row.group &&
                          (index === 0 || row.group !== view.rows[window.start + index - 1]?.group),
                      ),
                  )}
                  flexShrink={0}
                >
                  {window.headings &&
                    row.group &&
                    (index === 0 || row.group !== view.rows[window.start + index - 1]?.group) && (
                      <ThemedText color="inactive" wrap="truncate">
                        {singleLine(row.group)}
                      </ThemedText>
                    )}
                  {row.selectable === false ? (
                    <ThemedText color="error" wrap="truncate">
                      {singleLine(row.label)}
                    </ThemedText>
                  ) : (
                    <ListItem
                      picker
                      singleLine
                      width={width}
                      focused={interactive && selected === row.key}
                      description={bodyRows > 1 ? row.description : undefined}
                      showScrollUp={index === 0 && window.start > 0}
                      showScrollDown={
                        window.start + index === window.end - 1 && window.end < view.rows.length
                      }
                      onClick={activate(row.key)}
                    >
                      {singleLine(row.label)}
                      {row.status && (
                        <>
                          {" "}
                          ·{" "}
                          {row.status === "needs-auth" ? (
                            <ThemedText color="warning">⚠</ThemedText>
                          ) : (
                            <StatusIcon status={row.status === "connected" ? "success" : "error"} />
                          )}
                        </>
                      )}
                    </ListItem>
                  )}
                </Box>
              ))}
            </Box>
          ) : (
            <ScrollBox
              key={
                page.kind === "tool"
                  ? JSON.stringify(["tool", page.server.name, page.tool.name])
                  : page.kind === "server"
                    ? `server:${page.server.name}`
                    : page.kind
              }
              height={bodyRows}
              flexGrow={0}
              ref={props.scrollRef}
              initialFollow={false}
              followOnReachBottom={false}
              initialTop={props.initialTop}
              onScroll={props.onScroll}
              onClick={interactive ? props.onBodyFocus : undefined}
              onWheel={
                interactive
                  ? (event) => {
                      // The renderer owns clamping; screen keyboard readers use the same exposed handle.
                      props.onBodyWheel?.(event.delta);
                    }
                  : undefined
              }
            >
              <ThemedText preserveWhitespace>{view.body}</ThemedText>
            </ScrollBox>
          ))}
        {actionRows > 0 && (
          <Box
            flexDirection="column"
            height={actionRows}
            flexShrink={0}
            onWheel={interactive ? (event) => props.onListWheel?.(event.delta) : undefined}
          >
            {actions.slice(actionWindow.start, actionWindow.end).map((row, index) => (
              <ListItem
                key={row.key}
                picker
                singleLine
                width={width}
                focused={interactive && focusedActions && selected === row.key}
                showScrollUp={index === 0 && actionWindow.start > 0}
                showScrollDown={
                  actionWindow.start + index === actionWindow.end - 1 &&
                  actionWindow.end < actions.length
                }
                onClick={activate(row.key)}
              >
                {row.label}
              </ListItem>
            ))}
          </Box>
        )}
        {resultRows > 0 && (
          <ThemedText color={props.busy ? "warning" : "inactive"} wrap="truncate">
            {result}
          </ThemedText>
        )}
        <HintLine>{boundary + hint}</HintLine>
      </Box>
    </Box>
  );
}
