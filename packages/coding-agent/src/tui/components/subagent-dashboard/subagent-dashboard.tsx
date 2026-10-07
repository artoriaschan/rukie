import { usePanelScroll } from "../../hooks/reading-position";
import { InteractiveText } from "../interactive-text";
import { useState, type Ref } from "react";
import type { Locale } from "@rukie/i18n";
import {
  Box,
  Divider,
  ScrollBox,
  ThemedBox,
  ThemedText,
  type ScrollBoxHandle,
} from "../../../ink/index.ts";
import { createTuiI18n } from "../../../view/i18n";
import {
  subagentAppearance,
  subagentElapsed,
  subagentStatusKey,
  type SubagentView,
} from "../subagent-message";

export function ExitButton({ onClick }: { onClick(): void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Box
      flexShrink={0}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <InteractiveText noSelect onClick={onClick} color={hovered ? "text" : "subtle"}>
        {" "}
        ✕
      </InteractiveText>
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
  scrollRef: Ref<ScrollBoxHandle>;
  rows: number;
  columns: number;
  locale: Locale;
  initialTop: number;
  onClose(): void;
  onSelect(id: string): void;
}) {
  const panelScroll = usePanelScroll(scrollRef, initialTop);
  const t = createTuiI18n(locale);
  const failed = subagents.filter(
    (row) =>
      row.status === "failed" ||
      row.status === "aborted" ||
      row.runOutcome === "error" ||
      row.runOutcome === "aborted",
  ).length;
  return (
    <Box flexShrink={0} height={rows} flexDirection="column" paddingX={2} paddingY={1}>
      <Divider color="accent" title={t("subagent.dashboard")} />
      <Box marginY={1} gap={3} flexShrink={0}>
        <ThemedText>
          <ThemedText color="accent">
            {subagents.filter((row) => row.status === "running").length}
          </ThemedText>
          <ThemedText dim> {t("subagent.status.running")}</ThemedText>
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
          <ThemedText dim> {t("subagent.status.completed")}</ThemedText>
        </ThemedText>
        {failed > 0 && (
          <ThemedText>
            <ThemedText color="error">{failed}</ThemedText>
            <ThemedText dim> {t("subagent.status.failed")}</ThemedText>
          </ThemedText>
        )}
        <Box flexShrink={0} flexGrow={1} />
        <ExitButton onClick={onClose} />
      </Box>
      <ScrollBox
        ref={panelScroll}
        stickyScroll={false}
        height={Math.max(1, rows - 10)}
        flexGrow={0}
      >
        {subagents.length === 0 ? (
          <Box flexShrink={0} flexDirection="column" marginTop={2}>
            <ThemedText dim>○</ThemedText>
            <ThemedText dim>{t("subagent.none")}</ThemedText>
            <ThemedText dim>{t("subagent.empty-hint")}</ThemedText>
          </Box>
        ) : (
          subagents.map((subagent, index) => (
            <Box flexShrink={0} key={subagent.agentId} flexDirection="column">
              <DashboardCard
                subagent={subagent}
                focused={focusIndex === index}
                locale={locale}
                onClick={() => onSelect(subagent.agentId)}
              />
              {index < subagents.length - 1 && (
                <ThemedText dim>{"─".repeat(Math.max(1, Math.min(72, columns - 6)))}</ThemedText>
              )}
            </Box>
          ))
        )}
      </ScrollBox>
      <Divider />
      <ThemedText dim>{t("subagent.dashboard-hint")}</ThemedText>
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
  const { color, glyph } = subagentAppearance(subagent);
  const elapsed = subagentElapsed(subagent);
  return (
    <ThemedBox
      flexShrink={0}
      paddingLeft={1}
      marginBottom={1}
      flexDirection="column"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      backgroundColor={hovered && !focused ? "badgeHoverBackground" : undefined}
    >
      <InteractiveText wrap="truncate" onClick={onClick}>
        <ThemedText color={color}>{glyph} </ThemedText>
        <ThemedText bold color={focused ? "accent" : undefined}>
          {t("subagent.prefix")}
          {subagent.description}
        </ThemedText>
        {subagent.status !== "running" && (
          <ThemedText dim>{` · ${t(subagentStatusKey(subagent))}`}</ThemedText>
        )}
        <ThemedText
          dim
        >{`${subagent.model ? ` · ${subagent.model}` : ""}${elapsed === undefined ? "" : ` · ${Math.floor(elapsed / 1000)}s`}${subagent.tokens === undefined ? "" : ` · ${subagent.tokens} tok`} · ${subagent.toolCalls.length} tools`}</ThemedText>
      </InteractiveText>
      {subagent.status === "running" && subagent.outputLines.length > 0 && (
        <ThemedText dim wrap="truncate">{`  │ ${subagent.outputLines.at(-1)}`}</ThemedText>
      )}
    </ThemedBox>
  );
}
