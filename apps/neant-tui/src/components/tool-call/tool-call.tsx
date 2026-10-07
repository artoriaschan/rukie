import { useSmoothReveal } from "./use-smooth-reveal";
import { useDiffLayout } from "./diff-layout";
import { Markdown } from "../markdown";
import { unifiedDiffLines } from "./diff-lines";
import type { ToolCallView, ToolResultView } from "@neant/shared";
import { fmtDuration } from "@neant/i18n";
import { appCopy } from "../../i18n/locales";
import { useId, useState } from "react";
import type { PromptImage } from "@neant/agent";
import { ImageGallery } from "../image-gallery";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";
import {
  SplitDiffView,
  alignSplitDiff,
  toolKindColor,
  Tooltip,
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
  id,
  replayed = false,
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
  expanded: globalExpanded = false,
  onToggle,
  foldTerminalCommand = true,
  locale = "zh",
}: {
  foldTerminalCommand?: boolean;
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
}) {
  const fallbackId = useId();
  const [localExpanded, setExpanded] = useState(false);
  const expanded = globalExpanded || localExpanded;
  const toggle = onToggle ?? (() => setExpanded((value) => !value));
  const [hovered, setHovered] = useState(false);
  const { columns } = useTerminalSize();
  const diffLayout = useDiffLayout();
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
  const commandLines = callView?.card === "terminal" ? title.split(/\r?\n/) : undefined;
  const hiddenLines =
    foldTerminalCommand && commandLines
      ? Math.max(0, commandLines.length - 1 - Number(title.endsWith("\n")))
      : 0;
  const shownTitle = hiddenLines ? commandLines![0]! : title;
  const clippedTitle = callView?.card === "terminal" ? shownTitle : shownTitle.slice(0, 480);
  const titleHint = hiddenLines
    ? ` ${t("tool.command-lines", { count: hiddenLines })}`
    : shownTitle.length > clippedTitle.length
      ? "…"
      : "";
  const header = displayName ? `${displayName}(${clippedTitle})${titleHint}` : summary;
  const fullHeader = displayName ? `${displayName}(${title})` : summary;

  const seconds = Math.max(0, Math.floor((Date.now() - (startedAt ?? Date.now())) / 1000));
  const terminal = resultView?.card === "terminal" ? resultView : undefined;
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
  const splitRows =
    diffLines && (diffLayout === "split" || (diffLayout === "auto" && columns >= 110))
      ? alignSplitDiff(diffLines)
      : undefined;
  const lines =
    splitRows?.map((row) => ("text" in row ? row.text : "")) ??
    diffLines?.map((line) => line.text) ??
    output?.split(/\r?\n/) ??
    [];
  const highlightedLines =
    resultView?.card === "read" && status !== "error"
      ? highlightSyntax(resultView.content, { path: resultView.path })
      : undefined;
  const limit = diffView ? 8 : 3;
  const folded = lines.length > limit + 1;
  const window = expanded ? 400 : folded ? limit : lines.length;
  const visible = useSmoothReveal(
    id ?? fallbackId,
    Math.min(lines.length, window),
    status === "running" && !resultView && callView?.card === "diff" && !expanded && !replayed,
  );
  const shown = lines.slice(0, visible);
  const duration =
    status !== "running" && name && startedAt !== undefined && endedAt !== undefined
      ? ` · ${fmtDuration(Math.max(0, endedAt - startedAt), locale)}`
      : "";
  const titleHidden =
    hiddenLines > 0 ||
    clippedTitle.length < shownTitle.length ||
    header.split("\n").some((line) => Bun.stringWidth(`• ${line}${duration}`) > columns);
  const metadata = [
    startedAt !== undefined
      ? t("tool.started-at", {
          time: new Date(startedAt).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", {
            hour12: false,
          }),
        })
      : undefined,
    endedAt !== undefined
      ? t("tool.finished-at", {
          time: new Date(endedAt).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", {
            hour12: false,
          }),
        })
      : undefined,
    terminal?.exitCode !== undefined ? t("tool.exit-code", { code: terminal.exitCode }) : undefined,
    terminal?.signal ? t("tool.signal", { signal: terminal.signal }) : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <ThemedBox
      flexDirection="column"
      backgroundColor={hovered ? "toolCardBackground" : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Tooltip
        content={titleHidden ? `${fullHeader}\n${metadata}` : undefined}
        disabled={imagesSuspended}
        width={hitWidth(`• ${header}${duration}`)}
        onClick={toggle}
      >
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
                <SyntaxHighlightedText text={clippedTitle} language="json" />
              ) : (
                clippedTitle
              )}
              )
            </ThemedText>
          )}
          {titleHint}
          {status !== "running" && name && startedAt !== undefined && endedAt !== undefined && (
            <ThemedText
              dimColor={!hovered}
            >{` · ${fmtDuration(Math.max(0, endedAt - startedAt), locale)}`}</ThemedText>
          )}
        </ThemedText>
      </Tooltip>
      {(output || diffView || status === "running") && (
        <ThemedBox flexDirection="column" color={status === "error" ? "error" : "text"}>
          {splitRows ? (
            <ThemedBox>
              <ThemedText preserveWhitespace>{`${figures.result} `}</ThemedText>
              <SplitDiffView
                rows={splitRows.slice(0, visible)}
                width={Math.max(0, columns - 3)}
                onToggle={toggle}
              />
            </ThemedBox>
          ) : resultView?.card === "web" && status !== "error" ? (
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
