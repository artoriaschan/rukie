import { useState, type Ref } from "react";
import type { Locale } from "@neant/i18n";
import { Box, Divider, ScrollBox, ThemedBox, ThemedText, type ScrollHandle } from "@neant/tui";
import { createTuiI18n } from "../../i18n";
import { SUBAGENT_APPEARANCE, subagentStatusKey, type SubagentView } from "../subagent-message";

export function ExitButton({ onClick }: { onClick(): void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Box
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ThemedText color={hovered ? "text" : "subtle"}> ✕</ThemedText>
    </Box>
  );
}

export function SubagentDashboard({
  subagents,
  focusIndex,
  scrollRef,
  rows,
  columns,
  locale,
  onClose,
  initialTop,
  onSelect,
}: {
  subagents: readonly SubagentView[];
  focusIndex: number;
  scrollRef: Ref<ScrollHandle>;
  rows: number;
  columns: number;
  locale: Locale;
  initialTop: number;
  onClose(): void;
  onSelect(id: string): void;
}) {
  const t = createTuiI18n(locale);
  const failed = subagents.filter(
    (row) => row.status === "failed" || row.status === "aborted",
  ).length;
  return (
    <Box height={rows} flexDirection="column" paddingX={2} paddingY={1}>
      <Divider color="accent" title={t("subagent.dashboard")} />
      <Box marginY={1} gap={3} flexShrink={0}>
        <ThemedText>
          <ThemedText color="accent">
            {subagents.filter((row) => row.status === "running").length}
          </ThemedText>
          <ThemedText dimColor> {t("subagent.status.running")}</ThemedText>
        </ThemedText>
        <ThemedText>
          <ThemedText color="success">
            {
              subagents.filter(
                (row) =>
                  row.runOutcome === "completed" || (row.status === "completed" && !row.runOutcome),
              ).length
            }
          </ThemedText>
          <ThemedText dimColor> {t("subagent.status.completed")}</ThemedText>
        </ThemedText>
        {failed > 0 && (
          <ThemedText>
            <ThemedText color="error">{failed}</ThemedText>
            <ThemedText dimColor> {t("subagent.status.failed")}</ThemedText>
          </ThemedText>
        )}
        <Box flexGrow={1} />
        <ExitButton onClick={onClose} />
      </Box>
      <ScrollBox
        ref={scrollRef}
        initialFollow={false}
        initialTop={initialTop}
        height={Math.max(1, rows - 10)}
        flexGrow={0}
      >
        {subagents.length === 0 ? (
          <Box flexDirection="column" marginTop={2}>
            <ThemedText dimColor>○</ThemedText>
            <ThemedText dimColor>{t("subagent.none")}</ThemedText>
            <ThemedText dimColor>{t("subagent.empty-hint")}</ThemedText>
          </Box>
        ) : (
          subagents.map((subagent, index) => (
            <Box key={subagent.agentId} flexDirection="column">
              <DashboardCard
                subagent={subagent}
                focused={focusIndex === index}
                locale={locale}
                onClick={() => onSelect(subagent.agentId)}
              />
              {index < subagents.length - 1 && (
                <ThemedText dimColor>
                  {"─".repeat(Math.max(1, Math.min(72, columns - 6)))}
                </ThemedText>
              )}
            </Box>
          ))
        )}
      </ScrollBox>
      <Divider />
      <ThemedText dimColor>{t("subagent.dashboard-hint")}</ThemedText>
    </Box>
  );
}

function DashboardCard({
  subagent,
  focused,
  locale,
  onClick,
}: {
  subagent: SubagentView;
  focused: boolean;
  locale: Locale;
  onClick(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const t = createTuiI18n(locale);
  const { color, glyph } = SUBAGENT_APPEARANCE[subagent.status];
  return (
    <ThemedBox
      paddingLeft={1}
      marginBottom={1}
      flexDirection="column"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      backgroundColor={hovered && !focused ? "badgeHoverBackground" : undefined}
    >
      <ThemedText wrap="truncate">
        <ThemedText color={color}>{glyph} </ThemedText>
        <ThemedText bold color={focused ? "accent" : undefined}>
          {t("subagent.prefix")}
          {subagent.description}
        </ThemedText>
        {subagent.status !== "running" && (
          <ThemedText dimColor>{` · ${t(subagentStatusKey(subagent))}`}</ThemedText>
        )}
        <ThemedText
          dimColor
        >{` · ${subagent.model ?? t("subagent.default-model")} · ${Math.floor((subagent.status === "running" ? Date.now() - subagent.startedAt : subagent.durationMs) / 1000)}s · ${subagent.tokens} tok · ${subagent.toolCalls.length} tools`}</ThemedText>
      </ThemedText>
      {subagent.status === "running" && subagent.outputLines.length > 0 && (
        <ThemedText dimColor wrap="truncate">{`  │ ${subagent.outputLines.at(-1)}`}</ThemedText>
      )}
    </ThemedBox>
  );
}
