import type { Ref } from "react";
import type { Locale } from "@neant/i18n";
import { Box, ScrollBox, ThemedText, type ScrollHandle } from "@neant/tui";
import { createTuiI18n } from "../../i18n";
import { SUBAGENT_APPEARANCE, subagentStatusKey, type SubagentView } from "../subagent-message";
import { ToolCall } from "../tool-call";
import { Markdown } from "../markdown";
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
  output: readonly { type: "text" | "thinking" | "tool"; text: string }[];
}

export function SubagentDetailScene({
  subagent,
  page,
  thinkingOpen,
  expanded = false,
  scrollRef,
  rows,
  locale,
  onBack,
  onPage,
  onInterrupt,
}: {
  subagent: SubagentDetailView;
  page: DetailPage;
  thinkingOpen: boolean;
  expanded?: boolean;
  scrollRef: Ref<ScrollHandle>;
  rows: number;
  locale: Locale;
  onBack(): void;
  onPage(page: DetailPage): void;
  onInterrupt(): void;
}) {
  const t = createTuiI18n(locale);
  const { color, glyph } = SUBAGENT_APPEARANCE[subagent.status];
  const elapsed =
    subagent.status === "running"
      ? Math.max(0, Date.now() - subagent.startedAt)
      : subagent.durationMs;
  const duration = formatDuration(elapsed);
  const reason = subagent.runReason ?? subagent.error;
  const outputBlocks: { type: "text" | "thinking" | "tool"; text: string }[] = [];
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
  const timestamp = (time: number) =>
    time ? new Date(time).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US") : "—";
  return (
    <Box height={rows} paddingX={2} paddingY={1} flexDirection="column">
      <Box flexShrink={0}>
        <ThemedText wrap="truncate">
          <ThemedText color={color}>{glyph} </ThemedText>
          <ThemedText bold>
            {t("subagent.prefix")}
            {subagent.description}
          </ThemedText>
          <ThemedText dimColor> · </ThemedText>
          <ThemedText color={color}>{t(subagentStatusKey(subagent))}</ThemedText>
        </ThemedText>
        <Box flexGrow={1} />
        <ExitButton onClick={onBack} />
      </Box>
      <ThemedText wrap="truncate">
        {subagent.model ?? t("subagent.default-model")}
        <ThemedText
          dimColor
        >{` · ${duration} · ${subagent.tokens} tok · ${subagent.toolCalls.length} tools`}</ThemedText>
      </ThemedText>
      <ThemedText
        dimColor
        wrap="truncate"
      >{`id ${subagent.agentId.slice(0, 8)} · ${t("subagent.started")} ${timestamp(subagent.startedAt)}${subagent.completedAt ? ` · ${t("subagent.ended")} ${timestamp(subagent.completedAt)}` : ""}`}</ThemedText>
      {reason && <ThemedText color="error">{reason}</ThemedText>}
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
      <ThemedText dimColor wrap="truncate">
        {"─".repeat(72)}
      </ThemedText>
      <ScrollBox
        key={page}
        ref={scrollRef}
        initialFollow={false}
        height={Math.max(1, rows - 14)}
        flexGrow={0}
        paddingX={1}
      >
        {page === "summary" && (
          <Box flexDirection="column">
            {[
              [t("subagent.status"), t(subagentStatusKey(subagent))],
              [t("subagent.model"), subagent.model ?? t("subagent.default-model")],
              [t("subagent.duration"), duration],
              ["tokens", `${subagent.tokens}`],
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
                ) : line.type === "thinking" ? (
                  <Box flexDirection="column">
                    <ThemedText
                      dimColor
                    >{`${thinkingOpen ? "▾" : "▸"} ${t("subagent.thinking")}`}</ThemedText>
                    {thinkingOpen && <ThemedText dimColor>{line.text}</ThemedText>}
                  </Box>
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
            subagent.toolCalls.map((tool) => (
              <ToolCall
                key={tool.id}
                id={tool.id}
                name={tool.name}
                args={tool.args}
                summary={`${tool.name} ${tool.argsPreview}`}
                callView={tool.view}
                resultView={tool.resultView}
                startedAt={tool.startedAt}
                endedAt={tool.endedAt}
                expanded={expanded}
                status={
                  tool.status === "running"
                    ? "running"
                    : tool.status === "failed"
                      ? "error"
                      : "success"
                }
                result={tool.result ?? tool.resultPreview}
                error={tool.error}
                locale={locale}
              />
            ))
          ) : (
            <ThemedText dimColor>{t("subagent.no-tools")}</ThemedText>
          ))}
      </ScrollBox>
      <ThemedText dimColor wrap="truncate">
        {"─".repeat(72)}
      </ThemedText>
      <Box flexShrink={0}>
        <ThemedText dimColor>{t("subagent.detail-hint")}</ThemedText>
        <Box flexGrow={1} />
        {subagent.status === "running" && (
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
