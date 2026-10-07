import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../i18n";
import { appCopy } from "../i18n/locales";
import type { ToolCallView, ToolResultView } from "@neant/shared";
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
/** Full display source shared by rendering and transcript search, without event metadata. */
export function toolCardTitle({
  args,
  callView: declaredCallView,
  resultView,
  isRunning,
}: ToolCardSource): string {
  const callView = isRunning || resultView ? declaredCallView : undefined;
  return callView?.card === "terminal"
    ? callView.command
    : callView?.card === "diff"
      ? (callView.diffs[0]?.path ?? "")
      : callView?.card === "generic" && callView.server && callView.tool
        ? `${callView.server} › ${callView.tool}`
        : callView?.card === "generic" && callView.title
          ? callView.title
          : (JSON.stringify(callView?.card === "generic" ? (callView.rawInput ?? args) : args) ??
            "");
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
  const key = source.callView?.displayKey ?? source.resultView?.displayKey ?? `tool.${source.name}`;
  return Object.hasOwn(appCopy[locale], key)
    ? appCopy[locale][key as keyof typeof appCopy.zh]
    : source.name
      ? source.name[0]!.toUpperCase() + source.name.slice(1)
      : undefined;
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
