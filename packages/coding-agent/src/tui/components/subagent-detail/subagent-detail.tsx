import type { Ref } from "react";
import type { Locale } from "@neant/i18n";
import {
  Box,
  ScrollBox,
  ThemedText,
  type ScrollHandle,
  type ScrollSnapshot,
} from "../../../ink/index.ts";
import { createTuiI18n } from "../../i18n";
import {
  subagentAppearance,
  subagentElapsed,
  type SubagentOutput,
  subagentStatusKey,
  type SubagentView,
} from "../subagent-message";
import { ToolCall } from "../tool-call";
import { Markdown } from "../../../ink/index.ts";
import { ExitButton } from "../subagent-dashboard";

function formatDuration(elapsed: number) {
  return elapsed < 1000
    ? `${Math.floor(elapsed)}ms`
    : elapsed < 60000
      ? `${(elapsed / 1000).toFixed(1)}s`
      : `${Math.floor(elapsed / 60000)}m${Math.floor((elapsed % 60000) / 1000)}s`;
}

export type DetailPage = "summary" | "output" | "tools";
interface SubagentDetailView extends SubagentView {
  output: readonly SubagentOutput[];
}

export function SubagentDetailScene({
  subagent,
  page,
  thinkingOpen,
  expanded = false,
  foldTerminalCommand = true,
  scrollRef,
  initialScroll,
  rows,
  locale,
  onBack,
  onPathClick,
  onPage,
  onInterrupt,
  agentView = false,
}: {
  subagent: SubagentDetailView;
  agentView?: boolean;
  page: DetailPage;
  thinkingOpen: boolean;
  expanded?: boolean;
  foldTerminalCommand?: boolean;
  scrollRef: Ref<ScrollHandle>;
  initialScroll?: ScrollSnapshot;
  rows: number;
  locale: Locale;
  onBack(): void;
  onPathClick?(path: string): void;
  onPage(page: DetailPage): void;
  onInterrupt(): void;
}) {
  const t = createTuiI18n(locale);
  const { color, glyph } = subagentAppearance(subagent);
  const elapsed = subagentElapsed(subagent);
  const duration = elapsed === undefined ? undefined : formatDuration(elapsed);
  const reason = subagent.runReason ?? subagent.error;
  const outputBlocks: SubagentOutput[] = [];
  for (const line of subagent.output) {
    const previous = outputBlocks.at(-1);
    if (previous && line.type !== "tool" && previous.type === line.type)
      previous.text += "\n" + line.text;
    else outputBlocks.push({ ...line });
  }
  const finalText = subagent.output.findLast((line) => line.type === "text")?.text;
  const conclusion =
    subagent.status !== "running"
      ? outputBlocks.findLastIndex((block) => block.type === "text" && block.text.trim())
      : -1;
  const timestamp = (time?: number) =>
    time ? new Date(time).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US") : "—";
  const renderTool = (tool: SubagentView["toolCalls"][number]) => (
    <ToolCall
      foldTerminalCommand={foldTerminalCommand}
      key={tool.id}
      onPathClick={onPathClick}
      id={`${subagent.agentId}:${tool.id}`}
      name={tool.name}
      args={tool.args}
      summary={`${tool.name} ${tool.argsPreview}`}
      callView={tool.view}
      resultView={tool.resultView}
      startedAt={tool.startedAt}
      endedAt={tool.endedAt}
      expanded={expanded}
      status={
        tool.status === "running" ? "running" : tool.status === "failed" ? "error" : "success"
      }
      result={
        tool.status === "unknown" ? t("tool.outcome-unknown") : (tool.result ?? tool.resultPreview)
      }
      error={tool.error}
      outcomeUnknown={tool.status === "unknown"}
      locale={locale}
    />
  );
  return (
    <Box height={rows} paddingX={2} paddingY={1} flexDirection="column">
      <Box flexShrink={0}>
        <ThemedText wrap="truncate">
          <ThemedText color={color}>{glyph} </ThemedText>
          <ThemedText bold>
            {agentView ? `${t("subagent.agent-view")} · ` : t("subagent.prefix")}
            {subagent.description}
          </ThemedText>
          <ThemedText dimColor> · </ThemedText>
          <ThemedText color={color}>{t(subagentStatusKey(subagent))}</ThemedText>
        </ThemedText>
        <Box flexGrow={1} />
        <ExitButton onClick={onBack} />
      </Box>
      <ThemedText wrap="truncate">
        {subagent.model}
        <ThemedText
          dimColor
        >{`${duration === undefined ? "" : ` · ${duration}`}${subagent.tokens === undefined ? "" : ` · ${subagent.tokens} tok`} · ${subagent.toolCalls.length} tools`}</ThemedText>
      </ThemedText>
      <ThemedText
        dimColor
        wrap="truncate"
      >{`id ${subagent.agentId.slice(0, 8)} · ${t("subagent.started")} ${timestamp(subagent.startedAt)}${subagent.completedAt ? ` · ${t("subagent.ended")} ${timestamp(subagent.completedAt)}` : ""}`}</ThemedText>
      {reason && <ThemedText color="error">{reason}</ThemedText>}
      {!agentView && (
        <Box marginTop={1} flexShrink={0}>
          {(["summary", "output", "tools"] as const).map((tab, index) => (
            <Box key={tab}>
              <Box onClick={() => onPage(tab)}>
                <ThemedText
                  bold={page === tab}
                  inverse={page === tab}
                  color={page === tab ? "accent" : undefined}
                >{` ${t(`subagent.${tab}`)} `}</ThemedText>
              </Box>
              {index < 2 && <ThemedText dimColor>│</ThemedText>}
            </Box>
          ))}
          <ThemedText
            dimColor
          >{`  ${["summary", "output", "tools"].indexOf(page) + 1}/3`}</ThemedText>
        </Box>
      )}
      <ThemedText dimColor wrap="truncate">
        {"─".repeat(72)}
      </ThemedText>
      <ScrollBox
        key={page}
        ref={scrollRef}
        initialTop={initialScroll?.top}
        initialAnchor={initialScroll?.anchor}
        initialFollow={
          initialScroll?.following ?? (subagent.status === "running" && page === "output")
        }
        height={Math.max(1, rows - 14)}
        flexGrow={0}
        paddingX={1}
      >
        {page === "summary" && (
          <Box flexDirection="column">
            {[
              [t("subagent.status"), t(subagentStatusKey(subagent))],
              ...(subagent.model ? [[t("subagent.model"), subagent.model]] : []),
              ...(duration === undefined ? [] : [[t("subagent.duration"), duration]]),
              ...(subagent.tokens === undefined ? [] : [["tokens", `${subagent.tokens}`]]),
              [t("subagent.tools"), `${subagent.toolCalls.length}`],
              [t("subagent.started"), timestamp(subagent.startedAt)],
              ...(subagent.completedAt
                ? [[t("subagent.ended"), timestamp(subagent.completedAt)]]
                : []),
            ].map(([label, value]) => (
              <Box key={label}>
                <Box width={14}>
                  <ThemedText dimColor>{label}</ThemedText>
                </Box>
                <ThemedText>{value}</ThemedText>
              </Box>
            ))}
            {subagent.status !== "running" && finalText && (
              <Box flexDirection="column" marginTop={1}>
                <ThemedText dimColor bold>
                  {t("subagent.summary")}
                </ThemedText>
                <Markdown text={finalText} />
              </Box>
            )}
          </Box>
        )}
        {page === "output" &&
          (subagent.output.length ? (
            outputBlocks.map((line, index) => (
              <Box key={index} flexDirection="column">
                {index === conclusion && (
                  <ThemedText dimColor>{`── ${t("subagent.conclusion")} ──`}</ThemedText>
                )}
                {line.type === "text" ? (
                  <Markdown text={line.text} />
                ) : line.type === "user" ? (
                  <ThemedText>
                    <ThemedText selectable={false} color="warning">
                      {"❯ "}
                    </ThemedText>
                    {line.text}
                  </ThemedText>
                ) : line.type === "thinking" ? (
                  <Box flexDirection="column">
                    <ThemedText
                      dimColor
                    >{`${thinkingOpen ? "▾" : "▸"} ${t("subagent.thinking")}`}</ThemedText>
                    {thinkingOpen && <Markdown text={line.text} dimColor />}
                  </Box>
                ) : subagent.toolCalls.find((tool) => tool.id === line.toolId) ? (
                  renderTool(subagent.toolCalls.find((tool) => tool.id === line.toolId)!)
                ) : (
                  <ThemedText color="accent">{`● ${line.text}`}</ThemedText>
                )}
              </Box>
            ))
          ) : (
            <ThemedText dimColor>{t("subagent.no-output")}</ThemedText>
          ))}
        {page === "tools" &&
          (subagent.toolCalls.length ? (
            subagent.toolCalls.map(renderTool)
          ) : (
            <ThemedText dimColor>{t("subagent.no-tools")}</ThemedText>
          ))}
      </ScrollBox>
      <ThemedText dimColor wrap="truncate">
        {"─".repeat(72)}
      </ThemedText>
      <Box flexShrink={0}>
        <ThemedText dimColor>
          {agentView ? t("subagent.readonly-hint") : t("subagent.detail-hint")}
        </ThemedText>
        <Box flexGrow={1} />
        {!agentView && subagent.status === "running" && (
          <Box onClick={onInterrupt}>
            <ThemedText color="error">{t("subagent.interrupt")}</ThemedText>
          </Box>
        )}
      </Box>
      {page === "output" && subagent.output.some((line) => line.type === "thinking") && (
        <ThemedText dimColor>{t("subagent.thinking-hint")}</ThemedText>
      )}
    </Box>
  );
}
