import type { Locale } from "@rukie/i18n";
import { createTuiI18n } from "../i18n";
import { appCopy } from "../i18n/locales";
import type { ToolCallView, ToolResultView } from "@rukie/shared";
export interface ToolCardSource {
  name?: string;
  args?: unknown;
  callView?: ToolCallView;
  resultView?: ToolResultView;
  result?: string;
  error?: string;
  isError?: boolean;
  isRunning?: boolean;
}
function mcpIdentity(source: ToolCardSource) {
  if (source.callView?.card === "generic" && source.callView.server && source.callView.tool)
    return { server: source.callView.server, tool: source.callView.tool };
  const match = source.name?.match(/^mcp__(.+?)__(.+)$/);
  return match ? { server: match[1]!, tool: match[2]! } : undefined;
}

/** Full display source shared by rendering and transcript search, without event metadata. */
export function toolCardTitle(source: ToolCardSource): string {
  const identity = mcpIdentity(source);
  if (identity) return `› ${identity.tool}`;
  const { args, callView: declaredCallView, resultView, isRunning } = source;
  const callView = isRunning || resultView ? declaredCallView : undefined;
  return callView?.card === "terminal"
    ? callView.command
    : callView?.card === "diff"
      ? (callView.diffs[0]?.path ?? "")
      : callView?.card === "generic" && callView.title
        ? callView.title
        : (JSON.stringify(callView?.card === "generic" ? (callView.rawInput ?? args) : args) ?? "");
}
export function toolCardBody(source: ToolCardSource): string | undefined {
  const { resultView: view, result, error, isError } = source;
  if (isError) return error ?? result ?? (view?.card === "terminal" ? view.output : undefined);
  switch (view?.card) {
    case "read":
      return view.content;
    case "web":
      return view.markdown;
    case "generic":
      return view.text || result;
    case "terminal":
      return view.output;
    case "search": {
      if (view.shape === "paths") return view.paths.join("\n") || result;
      const groups = new Map<string, string[]>();
      for (const match of view.matches) {
        const lines = groups.get(match.path) ?? [];
        if (!groups.has(match.path)) groups.set(match.path, lines);
        lines.push(`${match.line === undefined ? "" : `${match.line}: `}${match.text}`);
      }
      return [...groups].flatMap(([path, lines]) => [path, ...lines]).join("\n") || result;
    }
    default:
      return result;
  }
}

export function toolCardName(source: ToolCardSource, locale: Locale): string | undefined {
  const identity = mcpIdentity(source);
  if (identity) return identity.server;
  const key = source.callView?.displayKey ?? source.resultView?.displayKey ?? `tool.${source.name}`;
  return Object.hasOwn(appCopy[locale], key)
    ? appCopy[locale][key as keyof typeof appCopy.zh]
    : source.name
      ? source.name[0]!.toUpperCase() + source.name.slice(1)
      : undefined;
}

/** Search uses the same readable header as a fully revealed tool card. */
export function toolCardHeader(source: ToolCardSource, locale: Locale): string {
  const name = toolCardName(source, locale);
  const title = toolCardTitle(source);
  const view = source.isRunning || source.resultView ? source.callView : undefined;
  const parentheses =
    !mcpIdentity(source) && view?.card !== "diff" && !(view?.card === "generic" && view.title);
  return name ? `${name}${parentheses ? "(" : " "}${title}${parentheses ? ")" : ""}` : title;
}

/** Durable output notices remain outside the body fold and search window. */
export function toolCardNotices(view: ToolResultView | undefined, locale: Locale): string[] {
  const t = createTuiI18n(locale);
  if (view?.card === "diff") {
    return view.diffs.some((diff) => "patch" in diff) ? [t("tool.diff-source-partial")] : [];
  }
  if (view?.card === "search") {
    const retained = view.shape === "paths" ? view.paths.length : view.matches.length;
    return view.total !== undefined && view.total > retained ? [t("tool.output-unavailable")] : [];
  }
  if (view?.card !== "read" && view?.card !== "terminal" && view?.card !== "web") return [];
  return [
    view.outputUnavailable ? t("tool.output-unavailable") : undefined,
    view.card === "terminal" && view.fullOutputPath
      ? t("tool.full-output", { path: view.fullOutputPath })
      : undefined,
    view.card === "read" && view.nextOffset !== undefined
      ? t("tool.read-continue", { offset: view.nextOffset })
      : undefined,
  ].filter((line): line is string => line !== undefined);
}

/** Proposed replacements are only meaningful while execution is pending. */
export function toolCardDiff(source: ToolCardSource) {
  if (source.isError) return undefined;
  return source.resultView?.card === "diff"
    ? source.resultView
    : source.isRunning && source.callView?.card === "diff"
      ? source.callView
      : undefined;
}
