import { unifiedDiffLines } from "./diff-lines";
import type { ToolCallView, ToolResultView } from "@neant/shared";
import { fmtDuration } from "@neant/i18n";
import { appCopy } from "../../i18n/locales";
import { useState } from "react";
import type { PromptImage } from "@neant/agent";
import { ImageGallery } from "../image-gallery";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";
import { Markdown } from "../markdown";
import {
  toolKindColor,
  SyntaxHighlightedText,
  highlightSyntax,
  useAnimationFrame,
  useTerminalFocus,
  ThemedBox,
  ThemedText,
  figures,
  type StatusIconProps,
  useTerminalSize,
} from "@neant/tui";

export function ToolCall({
  summary,
  name,
  args,
  callView,
  resultView,
  startedAt,
  endedAt,
  status,
  outcomeUnknown = false,
  result,
  images,
  onImageOpen,
  imagesSuspended,
  error,
  planReview,
  expanded: globalExpanded = false,
  onToggle,
  locale = "zh",
}: {
  expanded?: boolean;
  onToggle?(): void;
  summary: string;
  id?: string;
  name?: string;
  args?: unknown;
  callView?: ToolCallView;
  resultView?: ToolResultView;
  startedAt?: number;
  endedAt?: number;
  replayed?: boolean;
  status: StatusIconProps["status"];
  outcomeUnknown?: boolean;
  result?: string;
  images?: PromptImage[];
  onImageOpen?(index: number): void;
  imagesSuspended?: boolean;
  error?: string;
  locale?: Locale;
  planReview?: { plan: string; kind: "approve" | "revise" | "takeover"; feedback?: string };
}) {
  const [localExpanded, setExpanded] = useState(false);
  const expanded = globalExpanded || localExpanded;
  const toggle = onToggle ?? (() => setExpanded((value) => !value));
  const [hovered, setHovered] = useState(false);
  const { columns } = useTerminalSize();
  const hitWidth = (text: string) => Math.min(columns, Math.max(1, Bun.stringWidth(text)));
  const t = createTuiI18n(locale);
  const focused = useTerminalFocus();
  const [, time] = useAnimationFrame(status === "running" && focused ? 16 : null);
  const kind = resultView?.kind ?? callView?.kind;
  const color = toolKindColor(kind);
  const key = callView?.displayKey ?? resultView?.displayKey ?? `tool.${name}`;
  const displayName = Object.hasOwn(appCopy[locale], key)
    ? appCopy[locale][key as keyof typeof appCopy.zh]
    : name
      ? name[0]!.toUpperCase() + name.slice(1)
      : undefined;
  const title =
    callView?.card === "terminal"
      ? callView.command
      : callView?.card === "generic" && callView.server && callView.tool
        ? `${callView.server} › ${callView.tool}`
        : callView?.card === "generic" && callView.title
          ? callView.title
          : (JSON.stringify(callView?.card === "generic" ? (callView.rawInput ?? args) : args) ??
            "");
  const jsonTitle =
    callView?.card !== "terminal" &&
    !(callView?.card === "generic" && (callView.title || (callView.server && callView.tool)));
  const header = displayName ? `${displayName}(${title.slice(0, 480)})` : summary;
  const seconds = Math.max(0, Math.floor((Date.now() - (startedAt ?? Date.now())) / 1000));
  const terminal = resultView?.card === "terminal" ? resultView : undefined;
  if (planReview)
    return (
      <ThemedBox flexDirection="column">
        <ThemedBox onClick={() => setExpanded((value) => !value)}>
          <ThemedText
            color="plan"
            wrap="truncate"
          >{`${planReview.kind === "approve" ? (expanded ? "▾" : "▸") : "▾"} ${t(planReview.kind === "approve" ? "plan.review.approved" : planReview.kind === "revise" ? "plan.review.revised" : "plan.review.takeover")}${planReview.kind === "approve" ? ` · ${t(expanded ? "plan.review.collapse" : "plan.review.expand")}` : ""}`}</ThemedText>
        </ThemedBox>
        {(expanded || planReview.kind !== "approve") && <Markdown text={planReview.plan} />}
        {planReview.kind === "revise" && (
          <ThemedText>{`${t("plan.review.feedback")}: ${planReview.feedback ?? ""}`}</ThemedText>
        )}
      </ThemedBox>
    );
  const body =
    resultView?.card === "read"
      ? resultView.content
      : resultView?.card === "web"
        ? resultView.markdown
        : resultView?.card === "generic"
          ? resultView.text
          : resultView?.card === "search"
            ? searchLines(resultView).join("\n")
            : (terminal?.output ?? result);
  const output = status === "error" ? (error ?? terminal?.output) : body;
  const diffView =
    status !== "error"
      ? resultView?.card === "diff"
        ? resultView
        : !resultView && callView?.card === "diff"
          ? callView
          : undefined
      : undefined;
  const diffLines = diffView ? unifiedDiffLines(diffView) : undefined;
  const lines = diffLines?.map((line) => line.text) ?? output?.split(/\r?\n/) ?? [];
  const highlightedLines =
    resultView?.card === "read" && status !== "error"
      ? highlightSyntax(resultView.content, { path: resultView.path })
      : undefined;
  const limit = diffView ? 8 : 3;
  const folded = lines.length > limit + 1;
  const shown = expanded ? lines.slice(0, 400) : folded ? lines.slice(0, limit) : lines;
  const duration =
    status !== "running" && name && startedAt !== undefined && endedAt !== undefined
      ? ` · ${fmtDuration(Math.max(0, endedAt - startedAt), locale)}`
      : "";
  return (
    <ThemedBox
      flexDirection="column"
      backgroundColor={hovered ? "toolCardBackground" : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ThemedBox width={hitWidth(`• ${header}${duration}`)} onClick={toggle}>
        <ThemedText wrap="truncate">
          <ThemedText color={outcomeUnknown ? "warning" : status === "error" ? "error" : color}>
            {hovered
              ? expanded
                ? "▴"
                : "▾"
              : outcomeUnknown
                ? "?"
                : status === "error"
                  ? "✗"
                  : status === "running"
                    ? focused && Math.floor(time / 600) % 2
                      ? " "
                      : process.platform === "darwin"
                        ? "⏺"
                        : "●"
                    : "•"}
          </ThemedText>{" "}
          <ThemedText bold color={color}>
            {displayName ?? header}
          </ThemedText>
          {displayName && (
            <ThemedText>
              (
              {jsonTitle ? (
                <SyntaxHighlightedText text={title.slice(0, 480)} language="json" />
              ) : (
                title.slice(0, 480)
              )}
              )
            </ThemedText>
          )}
          {status !== "running" && name && startedAt !== undefined && endedAt !== undefined && (
            <ThemedText
              dimColor={!hovered}
            >{` · ${fmtDuration(Math.max(0, endedAt - startedAt), locale)}`}</ThemedText>
          )}
        </ThemedText>
      </ThemedBox>
      {(output || diffView || status === "running") && (
        <ThemedBox flexDirection="column" color={status === "error" ? "error" : "text"}>
          {resultView?.card === "web" && status !== "error" ? (
            <ThemedBox>
              <ThemedText>{`${figures.result} `}</ThemedText>
              <ThemedBox flexDirection="column" flexGrow={1}>
                <Markdown text={shown.join("\n")} />
              </ThemedBox>
            </ThemedBox>
          ) : (
            (status === "running" && !output && !diffView
              ? [t("tool.running", { seconds })]
              : shown
            ).map((line, index) => (
              <ThemedBox
                key={index}
                width={hitWidth(
                  `${index === 0 ? `${figures.result} ` : name ? "   " : "  "}${line.trimEnd()}`,
                )}
                onClick={line.trim() || index === 0 ? toggle : undefined}
              >
                <ThemedText
                  color={
                    diffLines?.[index]?.tone === "add"
                      ? "success"
                      : diffLines?.[index]?.tone === "del"
                        ? "error"
                        : diffLines?.[index]?.tone === "dim"
                          ? "subtle"
                          : undefined
                  }
                  wrap="truncate"
                >
                  {index === 0 ? `${figures.result} ` : name ? "   " : "  "}
                  {diffLines?.[index]?.runs ? (
                    <SyntaxHighlightedText runs={diffLines[index]!.runs} />
                  ) : highlightedLines ? (
                    <SyntaxHighlightedText runs={highlightedLines[index]} />
                  ) : (
                    line
                  )}
                </ThemedText>
              </ThemedBox>
            ))
          )}
          {resultView?.card === "search" &&
            resultView.total !== undefined &&
            resultView.total >
              (resultView.shape === "paths"
                ? resultView.paths.length
                : resultView.matches.length) && (
              <ThemedText
                dimColor
              >{`   ${t("tool.search-total", { count: resultView.total })}`}</ThemedText>
            )}
          {folded && !expanded && (
            <ThemedBox
              width={hitWidth(`   ${t("tool.fold", { count: lines.length - limit })}`)}
              onClick={toggle}
            >
              <ThemedText
                dimColor={!hovered}
              >{`   ${t("tool.fold", { count: lines.length - limit })}`}</ThemedText>
            </ThemedBox>
          )}
          {expanded && lines.length > 400 && (
            <ThemedText dimColor={!hovered}>
              {t("tool.window", { shown: 400, total: lines.length })}
            </ThemedText>
          )}
        </ThemedBox>
      )}
      {terminal?.exitCode !== undefined && (
        <ThemedText
          color={terminal.exitCode ? "error" : "subtle"}
        >{`   ${t("tool.exit-code", { code: terminal.exitCode })}`}</ThemedText>
      )}
      {terminal?.signal && (
        <ThemedText color="error">{`   ${t("tool.signal", { signal: terminal.signal })}`}</ThemedText>
      )}
      {terminal?.outputUnavailable && (
        <ThemedText dimColor>{`   ${t("tool.output-unavailable")}`}</ThemedText>
      )}
      {!!images?.length && (
        <ImageGallery
          images={images}
          onOpen={onImageOpen}
          suspended={imagesSuspended}
          locale={locale}
        />
      )}
    </ThemedBox>
  );
}

function searchLines(view: Extract<ToolResultView, { card: "search" }>): string[] {
  if (view.shape === "paths") return view.paths;
  const groups = new Map<string, string[]>();
  for (const match of view.matches) {
    let lines = groups.get(match.path);
    if (!lines) {
      lines = [];
      groups.set(match.path, lines);
    }
    lines.push(`${match.line === undefined ? "" : `${match.line}: `}${match.text}`);
  }
  return [...groups].flatMap(([path, lines]) => [path, ...lines]);
}
