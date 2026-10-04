import type { Locale } from "@neant/i18n";
import { Box, ThemedBox, ThemedText } from "@neant/tui";
import { useState } from "react";
import { createTuiI18n } from "../../i18n";
import { SUBAGENT_APPEARANCE, type SubagentView } from "../subagent-message";

export function SubagentPanel({
  subagents,
  working,
  collapsed,
  onToggle,
  onOpen,
  locale,
  maxHeight,
}: {
  subagents: readonly SubagentView[];
  working: boolean;
  collapsed: boolean;
  onToggle(): void;
  onOpen(id: string): void;
  locale: Locale;
  maxHeight: number;
}) {
  const [headerHovered, setHeaderHovered] = useState(false);
  const t = createTuiI18n(locale);
  const remaining = working
    ? subagents
    : subagents.filter((agent) => agent.status === "running" || agent.status === "idle");
  if (remaining.length === 0) return null;
  const running = subagents.filter((agent) => agent.status === "running").length;
  const preview = subagents.find((agent) => agent.status === "running");
  const compact = maxHeight < 3;
  const folded = collapsed || compact;
  const paddingTop = maxHeight >= 4 ? 1 : 0;
  const rowBudget = compact ? 1 : Math.max(1, maxHeight - paddingTop);
  const overflow = !folded && remaining.length > Math.min(8, rowBudget - 1);
  const limit = Math.max(0, Math.min(8, rowBudget - 1 - Number(overflow)));
  const visible = folded ? (preview && rowBudget >= 2 ? [preview] : []) : remaining.slice(0, limit);
  const hidden = folded ? 0 : remaining.length - visible.length;
  const nodeLabel = (agent: SubagentView) =>
    `${SUBAGENT_APPEARANCE[agent.status].glyph} [${agent.subagentType}] ${agent.description.replace(/[\r\n]+/g, " ")}`;
  return (
    <Box flexDirection="column" paddingX={2} paddingTop={paddingTop}>
      <ThemedBox
        height={1}
        onClick={onToggle}
        onMouseEnter={() => setHeaderHovered(true)}
        onMouseLeave={() => setHeaderHovered(false)}
        backgroundColor={headerHovered ? "badgeHoverBackground" : undefined}
      >
        <Box flexShrink={0}>
          <ThemedText dimColor wrap="truncate">
            {`${folded ? "▸" : "▾"} ${t("subagent.panel")} ${running}/${subagents.length}`}
          </ThemedText>
        </Box>
        {compact && preview && (
          <Box flexGrow={1} onClick={() => onOpen(preview.agentId)}>
            <ThemedText dimColor wrap="truncate">{`  ${nodeLabel(preview)}`}</ThemedText>
          </Box>
        )}
      </ThemedBox>
      {visible.map((agent, index) => (
        <Box key={agent.agentId} height={1} onClick={() => onOpen(agent.agentId)}>
          <ThemedText wrap="truncate">
            <ThemedText dimColor>
              {index === visible.length - 1 && hidden === 0 ? "└─ " : "├─ "}
            </ThemedText>
            <ThemedText color={SUBAGENT_APPEARANCE[agent.status].color}>
              {nodeLabel(agent)}
            </ThemedText>
          </ThemedText>
        </Box>
      ))}
      {hidden > 0 && rowBudget >= 2 && (
        <Box height={1}>
          <ThemedText
            dimColor
            wrap="truncate"
          >{`└─ ${t("subagent.more", { count: hidden })}`}</ThemedText>
        </Box>
      )}
    </Box>
  );
}
