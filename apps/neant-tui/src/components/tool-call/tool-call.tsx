import {
  toolCardTitle,
  toolCardBody,
  toolCardName,
  toolCardNotices,
  toolCardDiff,
} from "./presentation";
import { useSmoothReveal } from "@neant/tui";
import { useDiffLayout } from "./diff-layout";
import { Markdown } from "@neant/tui";
import { unifiedDiffLines } from "./diff-lines";
import type { ToolCallView, ToolResultView } from "@neant/shared";
import { fmtDuration } from "@neant/i18n";
import { useId, useState, useMemo } from "react";
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
  searchLocation,
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
  onPathClick,
  foldTerminalCommand = true,
  locale = "zh",
}: {
  foldTerminalCommand?: boolean;
  expanded?: boolean;
  onToggle?(): void;
  searchLocation?: { part: "header" | "body"; line: number; offset: number };
  onPathClick?(path: string): void;
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
  const displayName = toolCardName({ name, callView, resultView }, locale);
  const title = toolCardTitle({ args, callView, resultView, isRunning: status === "running" });
  const titleView = status === "running" || resultView ? callView : undefined;
  const path =
    resultView?.card === "read"
      ? resultView.path
      : titleView?.card === "generic" && ["read", "edit"].includes(titleView.kind)
        ? titleView.title
        : titleView?.card === "diff"
          ? titleView.diffs[0]?.path
          : undefined;
  const pathOffset = path ? title.indexOf(path) : -1;
  const jsonTitle =
    titleView?.card !== "terminal" &&
    titleView?.card !== "diff" &&
    !(titleView?.card === "generic" && (titleView.title || (titleView.server && titleView.tool)));
  const commandLines = titleView?.card === "terminal" ? title.split(/\r?\n/) : undefined;
  const hiddenLines =
    foldTerminalCommand && !expanded && commandLines
      ? Math.max(0, commandLines.length - 1 - Number(title.endsWith("\n")))
      : 0;
  const titleOffset =
    searchLocation?.part === "header"
      ? Math.max(0, searchLocation.offset - (displayName?.length ?? 0) - 1)
      : undefined;
  const firstCommandLine = commandLines?.findIndex((line) => line.trim()) ?? 0;
  const selectedLine =
    titleOffset !== undefined && commandLines
      ? title.slice(0, titleOffset).split(/\r?\n/).length - 1
      : 0;
  const shownTitle =
    titleOffset !== undefined && commandLines
      ? commandLines[selectedLine]!
      : hiddenLines
        ? commandLines![Math.max(0, firstCommandLine)]!
        : title;
  const titleStart =
    titleOffset !== undefined
      ? Math.max(
          0,
          (commandLines
            ? titleOffset - title.slice(0, titleOffset).lastIndexOf("\n") - 1
            : titleOffset) - 10,
        )
      : 0;
  let hiddenChars = 0;
  const terminalTitle = shownTitle
    .slice(titleStart)
    .split("\n")
    .map((line) => {
      if (titleView?.card !== "terminal" || expanded || line.length <= 1000) return line;
      let end = 1000;
      const lead = line.charCodeAt(end - 1);
      const trail = line.charCodeAt(end);
      if (lead >= 0xd800 && lead <= 0xdbff && trail >= 0xdc00 && trail <= 0xdfff) end--;
      const count = line.length - end;
      hiddenChars += count;
      return `${line.slice(0, end)} ${t("tool.command-chars", { count })}`;
    })
    .join("\n");
  const clippedTitle =
    titleView?.card === "terminal" ? terminalTitle : shownTitle.slice(titleStart, titleStart + 480);
  const duration =
    status !== "running" && name && startedAt !== undefined && endedAt !== undefined
      ? ` · ${fmtDuration(Math.max(0, endedAt - startedAt), locale)}`
      : "";
  const pathLeft =
    2 +
    Bun.stringWidth(displayName ?? "") +
    1 +
    (pathOffset >= titleStart ? Bun.stringWidth(title.slice(titleStart, pathOffset)) : 0);
  const pathWidth =
    path && pathOffset >= titleStart
      ? Math.max(
          0,
          Math.min(
            Bun.stringWidth(path),
            columns - pathLeft - Bun.stringWidth(duration) - (hovered ? 2 : 0),
            480 - (pathOffset - titleStart),
          ),
        )
      : 0;
  const titleHint = hiddenLines
    ? ` ${t("tool.command-lines", { count: hiddenLines })}`
    : shownTitle.length > clippedTitle.length
      ? "…"
      : "";
  const parenthesized = titleView?.card === "terminal" || jsonTitle;
  const header = displayName
    ? `${displayName}${parenthesized ? "(" : " "}${clippedTitle}${parenthesized ? ")" : ""}${titleHint}`
    : summary;
  const fullHeader = displayName
    ? `${displayName}${parenthesized ? "(" : " "}${title}${parenthesized ? ")" : ""}`
    : summary;

  const seconds = Math.max(0, Math.floor((Date.now() - (startedAt ?? Date.now())) / 1000));
  const terminal = resultView?.card === "terminal" ? resultView : undefined;
  const output = toolCardBody({ callView, resultView, result, error, isError: status === "error" });
  const diffView = toolCardDiff({
    callView,
    resultView,
    isError: status === "error",
    isRunning: status === "running",
  });
  const diffLines = useMemo(() => (diffView ? unifiedDiffLines(diffView) : undefined), [diffView]);
  const splitRows = useMemo(
    () =>
      diffLines && (diffLayout === "split" || (diffLayout === "auto" && columns >= 110))
        ? alignSplitDiff(diffLines)
        : undefined,
    [diffLines, diffLayout, columns],
  );
  const lines =
    splitRows?.map((row) => ("text" in row ? row.text : "")) ??
    diffLines?.map((line) => line.text) ??
    output?.trimEnd().split(/\r?\n/) ??
    [];
  const highlightedLines = useMemo(
    () =>
      resultView?.card === "read" && status !== "error"
        ? highlightSyntax(resultView.content, { path: resultView.path })
        : undefined,
    [resultView, status],
  );
  const limit = diffView ? 8 : 3;
  const folded = lines.length > limit + 1;
  const windowStart =
    expanded && searchLocation?.part === "body"
      ? Math.max(0, Math.min(Math.max(0, lines.length - 400), searchLocation.line - 5))
      : 0;
  const window = expanded ? 400 : folded ? limit : lines.length;
  const visible = useSmoothReveal(
    id ?? fallbackId,
    Math.min(lines.length - windowStart, window),
    status === "running" && !resultView && !!callView && !expanded && !replayed && !error,
  );
  const shown = lines.slice(windowStart, windowStart + visible);
  const titleHidden =
    titleStart > 0 ||
    hiddenLines > 0 ||
    hiddenChars > 0 ||
    clippedTitle.length < shownTitle.length ||
    (titleView?.card !== "terminal" &&
      header.split("\n").some((line) => Bun.stringWidth(`• ${line}${duration} ▾`) > columns));
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
        scrollAnchorId={id ? `tool-${id}-header` : undefined}
        content={titleHidden ? `${fullHeader}\n${metadata}` : undefined}
        disabled={imagesSuspended}
        width={hitWidth(`• ${header}${duration}${hovered ? " ▾" : ""}`)}
        onClick={toggle}
      >
        <ThemedBox flexGrow={1}>
          <ThemedBox width={2} flexShrink={0}>
            <ThemedText
              preserveWhitespace
              color={outcomeUnknown ? "warning" : status === "error" ? "error" : color}
            >
              {outcomeUnknown
                ? "?"
                : status === "error"
                  ? "✗"
                  : status === "running"
                    ? focused && Math.floor(time / 600) % 2
                      ? " "
                      : process.platform === "darwin"
                        ? "⏺"
                        : "●"
                    : "•"}{" "}
            </ThemedText>
          </ThemedBox>
          <ThemedBox flexGrow={1} flexShrink={1}>
            <ThemedText wrap={titleView?.card === "terminal" ? "wrap" : "truncate"}>
              <ThemedText bold color={color}>
                {displayName ?? header}
              </ThemedText>
              {displayName && (
                <ThemedText>
                  {parenthesized ? "(" : " "}
                  {jsonTitle ? (
                    <SyntaxHighlightedText text={clippedTitle} language="json" />
                  ) : path && pathOffset >= titleStart ? (
                    <>
                      {title.slice(titleStart, pathOffset)}
                      <ThemedText underline>
                        {path.slice(0, 480 - (pathOffset - titleStart))}
                      </ThemedText>
                      {title.slice(pathOffset + path.length, titleStart + 480)}
                    </>
                  ) : (
                    clippedTitle
                  )}
                  {parenthesized ? ")" : ""}
                </ThemedText>
              )}
              {titleHint}
            </ThemedText>
          </ThemedBox>
          {status !== "running" && name && startedAt !== undefined && endedAt !== undefined && (
            <ThemedBox width={Bun.stringWidth(duration)} flexShrink={0}>
              <ThemedText preserveWhitespace dimColor={!hovered}>
                {duration}
              </ThemedText>
            </ThemedBox>
          )}
          {hovered && (
            <ThemedBox width={2} flexShrink={0}>
              <ThemedText preserveWhitespace dimColor>
                {expanded ? " ▴" : " ▾"}
              </ThemedText>
            </ThemedBox>
          )}
        </ThemedBox>
        {onPathClick && path && pathWidth > 0 && (
          <ThemedBox
            position="absolute"
            left={pathLeft}
            top={0}
            width={pathWidth}
            height={1}
            onClick={() => onPathClick(path)}
          />
        )}
      </Tooltip>
      {(output || diffView || status === "running") && (
        <ThemedBox flexDirection="column" color={status === "error" ? "error" : "text"}>
          {splitRows ? (
            <ThemedBox>
              <ThemedText preserveWhitespace>{` ${figures.result} `}</ThemedText>
              <SplitDiffView
                rows={splitRows.slice(windowStart, windowStart + visible).map((row, index) => ({
                  ...row,
                  scrollAnchorId: id ? `tool-${id}-line-${windowStart + index}` : undefined,
                }))}
                width={Math.max(0, columns - 3)}
                onToggle={toggle}
                onPathClick={onPathClick}
              />
            </ThemedBox>
          ) : resultView?.card === "web" && status !== "error" ? (
            <ThemedBox>
              <ThemedText dimColor>{` ${figures.result} `}</ThemedText>
              <ThemedBox
                scrollAnchorId={id ? `tool-${id}-body` : undefined}
                flexDirection="column"
                flexGrow={1}
              >
                <Markdown text={shown.join("\n")} onClick={toggle} />
              </ThemedBox>
            </ThemedBox>
          ) : (
            (status === "running" && !output && !diffView
              ? [t("tool.running", { seconds })]
              : shown
            ).map((line, index) => (
              <ThemedBox
                scrollAnchorId={id ? `tool-${id}-line-${windowStart + index}` : undefined}
                key={windowStart + index}
                width={hitWidth(`   ${line.trimEnd()}`)}
                onClick={line.trim() ? toggle : undefined}
              >
                <ThemedBox width={3} flexShrink={0}>
                  <ThemedText dimColor preserveWhitespace>
                    {index === 0 ? ` ${figures.result} ` : "   "}
                  </ThemedText>
                </ThemedBox>
                <ThemedBox flexGrow={1} flexShrink={1}>
                  <ThemedText
                    color={
                      diffLines?.[windowStart + index]?.tone === "add"
                        ? "success"
                        : diffLines?.[windowStart + index]?.tone === "del"
                          ? "error"
                          : diffLines?.[windowStart + index]?.tone === "dim"
                            ? "subtle"
                            : undefined
                    }
                    wrap="wrap"
                  >
                    {diffLines?.[windowStart + index]?.runs ? (
                      <SyntaxHighlightedText runs={diffLines[windowStart + index]!.runs} />
                    ) : highlightedLines ? (
                      <SyntaxHighlightedText runs={highlightedLines[windowStart + index]} />
                    ) : (
                      <ThemedText underline={diffLines?.[windowStart + index]?.tone === "path"}>
                        {line}
                      </ThemedText>
                    )}
                  </ThemedText>
                </ThemedBox>
                {onPathClick &&
                  diffLines?.[windowStart + index]?.tone === "path" &&
                  diffLines[windowStart + index]!.path && (
                    <ThemedBox
                      position="absolute"
                      left={3}
                      top={0}
                      width={Math.max(0, Math.min(columns - 3, Bun.stringWidth(line)))}
                      height={1}
                      onClick={() => onPathClick(diffLines[windowStart + index]!.path!)}
                    />
                  )}
              </ThemedBox>
            ))
          )}
          {resultView?.card === "search" &&
            resultView.total !== undefined &&
            resultView.total >
              (resultView.shape === "paths"
                ? resultView.paths.length
                : resultView.matches.length) && (
              <ThemedBox scrollAnchorId={id ? `tool-${id}-verdict` : undefined}>
                <ThemedText
                  dimColor
                >{`   ${t("tool.search-total", { count: resultView.total })}`}</ThemedText>
              </ThemedBox>
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
              {windowStart
                ? t("tool.window-range", {
                    start: windowStart + 1,
                    end: Math.min(lines.length, windowStart + 400),
                    total: lines.length,
                  })
                : t("tool.window", { shown: 400, total: lines.length })}
            </ThemedText>
          )}
        </ThemedBox>
      )}
      <ThemedBox scrollAnchorId={id ? `tool-${id}-verdict` : undefined} flexDirection="column">
        {terminal?.exitCode !== undefined && terminal.exitCode !== 0 && (
          <ThemedText
            color={terminal.exitCode ? "error" : "subtle"}
          >{`   ${t("tool.exit-code", { code: terminal.exitCode })}`}</ThemedText>
        )}
        {terminal?.signal && (
          <ThemedText color="error">{`   ${t("tool.signal", { signal: terminal.signal })}`}</ThemedText>
        )}
        {toolCardNotices(resultView, locale).map((notice) => (
          <ThemedText key={notice} dimColor>{`   ${notice}`}</ThemedText>
        ))}
      </ThemedBox>
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
