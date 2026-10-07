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
import { markdownText, markdownProjection } from "../../components/markdown/markdown";
import { contextText } from "../../components/context-report/context-visualization";
import { jobCardRows } from "../../components/job-card/job-card";
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
      const projection = markdownProjection(body);
      const rendered = projection.text;
      const first = matches.length;
      text(rendered, `tool-${id}-body`, { toolId: id, part: "body" });
      const found = matches.slice(first);
      for (const match of found) {
        match.line = projection.sourceLines[match.offset] ?? 0;
        const start = Math.max(
          0,
          Math.min(Math.max(0, body.split(/\r?\n/).length - 400), match.line - 5),
        );
        match.occurrence = found.filter(
          (candidate) =>
            candidate.offset < match.offset &&
            (projection.sourceLines[candidate.offset] ?? 0) >= start,
        ).length;
      }
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
        : view?.card === "search" &&
            view.total !== undefined &&
            view.total > (view.shape === "paths" ? view.paths.length : view.matches.length)
          ? t("tool.search-total", { count: view.total })
          : "";
    if (notes) text(notes, `tool-${id}-verdict`);
  }
  state.completed.forEach((entry, index) => {
    const anchor = entry.anchorId ?? `row-${index}`;
    switch (entry.type) {
      case "tool":
        tool(entry, entry.id ?? `row-${index}`);
        if (entry.jobId && state.jobs[entry.jobId]) {
          const job = state.jobs[entry.jobId]!;
          text(jobCardRows(job, job.output, columns, locale).join("\n"), `job-${job.id}`);
        }
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
      case "context-report":
        text(contextText(entry.report, entry.expanded, entry.modelName, locale), anchor);
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
