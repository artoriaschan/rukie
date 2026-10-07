import type { Locale } from "@neant/i18n";
import { appCopy } from "../../i18n/locales";
import type { ToolCallView, ToolResultView } from "@neant/shared";
export interface ToolCardSource {
  name?: string;
  args?: unknown;
  callView?: ToolCallView;
  resultView?: ToolResultView;
  result?: string;
  error?: string;
  isError?: boolean;
}
/** Full display source shared by rendering and transcript search, without event metadata. */
export function toolCardTitle({ args, callView }: ToolCardSource): string {
  return callView?.card === "terminal"
    ? callView.command
    : callView?.card === "generic" && callView.server && callView.tool
      ? `${callView.server} › ${callView.tool}`
      : callView?.card === "generic" && callView.title
        ? callView.title
        : (JSON.stringify(callView?.card === "generic" ? (callView.rawInput ?? args) : args) ?? "");
}
export function toolCardBody(source: ToolCardSource): string | undefined {
  const { resultView: view, callView, result, error, isError } = source;
  if (isError) return error ?? (view?.card === "terminal" ? view.output : undefined);
  switch (view?.card) {
    case "read":
      return view.content;
    case "web":
      return view.markdown;
    case "generic":
      return view.text;
    case "terminal":
      return view.output;
    case "search": {
      if (view.shape === "paths") return view.paths.join("\n");
      const groups = new Map<string, string[]>();
      for (const match of view.matches) {
        const lines = groups.get(match.path) ?? [];
        if (!groups.has(match.path)) groups.set(match.path, lines);
        lines.push(`${match.line === undefined ? "" : `${match.line}: `}${match.text}`);
      }
      return [...groups].flatMap(([path, lines]) => [path, ...lines]).join("\n");
    }
    default:
      return callView?.card === "diff" ? undefined : result;
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
