import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";
import type { createConversation } from "./conversation";
import {
  toolCardTitle,
  toolCardBody,
  toolCardName,
  type ToolCardSource,
} from "../../components/tool-call/presentation";
import { unifiedDiffLines } from "../../components/tool-call/diff-lines";
import { alignSplitDiff } from "@neant/tui";
import { markdownText } from "../../components/markdown/markdown";
import type { Settings } from "@neant/shared";

export interface TranscriptMatch {
  anchorId: string;
  occurrence: number;
  toolId?: string;
  part?: "header" | "body";
  line: number;
  offset: number;
}
type State = ReturnType<ReturnType<typeof createConversation>["getSnapshot"]>;
/** Search presentation source, including tool rows outside their bounded render window. */
export function transcriptMatches(
  state: State,
  query: string,
  columns: number,
  layout: Settings["diffLayout"],
  locale: Locale,
): TranscriptMatch[] {
  const matches: TranscriptMatch[] = [];
  if (!query) return matches;
  const needle = query.toLowerCase();
  function text(source: string, anchorId: string, extra: Partial<TranscriptMatch> = {}) {
    let occurrence = 0;
    const normalized = source.toLowerCase();
    for (
      let at = normalized.indexOf(needle);
      at !== -1;
      at = normalized.indexOf(needle, at + needle.length)
    ) {
      matches.push({ anchorId, occurrence: occurrence++, line: 0, offset: at, ...extra });
    }
  }
  function tool(source: ToolCardSource, id: string) {
    const title = toolCardTitle(source);
    const name = toolCardName(source, locale);
    text(name ? `${name}(${title})` : title, `tool-${id}-header`, { toolId: id, part: "header" });
    const diff = !source.isError
      ? source.resultView?.card === "diff"
        ? source.resultView
        : !source.resultView && source.callView?.card === "diff"
          ? source.callView
          : undefined
      : undefined;
    const diffLines = diff ? unifiedDiffLines(diff) : undefined;
    const split =
      diffLines && (layout === "split" || (layout !== "unified" && columns >= 110))
        ? alignSplitDiff(diffLines)
        : undefined;
    const body = toolCardBody(source) ?? "";
    const lines =
      split?.map((row) =>
        "text" in row
          ? row.text
          : [
              row.old?.map((run) => run.text).join("") ?? "",
              row.new?.map((run) => run.text).join("") ?? "",
            ].join("\n"),
      ) ??
      diffLines?.map((row) => row.text) ??
      (source.resultView?.card === "web" ? markdownText(body) : body).split(/\r?\n/);
    if (source.resultView?.card === "web") {
      const rendered = markdownText(body);
      const first = matches.length;
      text(rendered, `tool-${id}-body`, { toolId: id, part: "body" });
      for (const match of matches.slice(first))
        match.line = rendered.slice(0, match.offset).split("\n").length - 1;
    } else
      lines.forEach((line, index) =>
        text(line, `tool-${id}-line-${index}`, { toolId: id, part: "body", line: index }),
      );
    const t = createTuiI18n(locale);
    const view = source.resultView;
    const notes =
      view?.card === "terminal"
        ? [
            view.exitCode !== undefined ? t("tool.exit-code", { code: view.exitCode }) : undefined,
            view.signal ? t("tool.signal", { signal: view.signal }) : undefined,
            view.outputUnavailable ? t("tool.output-unavailable") : undefined,
          ]
            .filter(Boolean)
            .join("\n")
        : view?.card === "search" && view.total !== undefined
          ? t("tool.search-total", { count: view.total })
          : "";
    if (notes) text(notes, `tool-${id}-verdict`);
  }
  state.completed.forEach((entry, index) => {
    const anchor = entry.anchorId ?? `row-${index}`;
    switch (entry.type) {
      case "tool":
        tool(entry, entry.id ?? `row-${index}`);
        break;
      case "message":
        text(
          entry.role === "assistant"
            ? entry.text
                .split("\n")
                .filter((line) => !line.startsWith("⏵"))
                .join("\n")
            : entry.text,
          anchor,
        );
        break;
      case "thinking":
      case "question":
      case "notice":
        text(entry.text, anchor);
        break;
      case "plan-review":
        text(markdownText(entry.plan) + (entry.feedback ? `\n${entry.feedback}` : ""), anchor);
        break;
      case "subagent": {
        const agent = state.subagents[entry.agentId];
        if (agent)
          text(
            [
              agent.description,
              agent.model,
              agent.status === "running" ? agent.outputLines.slice(-3).join("\n") : undefined,
              agent.error,
            ]
              .filter(Boolean)
              .join("\n"),
            anchor,
          );
        break;
      }
    }
  });
  if (state.reasoning) text(state.reasoning, `${state.assistantAnchor}-thinking`);
  if (state.assistant) text(state.assistant, state.assistantAnchor);
  state.tools.forEach((call) => tool(call, call.id));
  return matches;
}
