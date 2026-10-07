import type { Locale } from "@rukie/i18n";
import { Box, ThemedBox, ThemedText } from "../../../ink/index.ts";
import { useState } from "react";
import { createTuiI18n } from "../../../view/i18n";
import { SUBAGENT_APPEARANCE, type SubagentView } from "../subagent-message";

export function SubagentPanel({
  subagents,
  collapsed,
  onToggle,
  onOpen,
  locale,
  maxHeight,
}: {
  subagents: readonly SubagentView[];
  collapsed: boolean;
  onToggle(): void;
  onOpen(id: string): void;
  locale: Locale;
  maxHeight: number;
}) {
  const [headerHovered, setHeaderHovered] = useState(false);
  const t = createTuiI18n(locale);
  if (subagents.length === 0) return null;
  const running = subagents.filter((agent) => agent.status === "running").length;
  const preview = subagents.find((agent) => agent.status === "running");
  const compact = maxHeight < 3;
  const folded = collapsed || compact;
  const paddingTop = maxHeight >= 4 ? 1 : 0;
  const rowBudget = compact ? 1 : Math.max(1, maxHeight - paddingTop);
  const overflow = !folded && subagents.length > Math.min(8, rowBudget - 1);
  const limit = Math.max(0, Math.min(8, rowBudget - 1 - Number(overflow)));
  const visible = folded ? (preview && rowBudget >= 2 ? [preview] : []) : subagents.slice(0, limit);
  const hidden = folded ? 0 : subagents.length - visible.length;
  const nodeLabel = (agent: SubagentView) =>
    `${SUBAGENT_APPEARANCE[agent.status].glyph} [${agent.subagentType}] ${agent.description.replace(/[\r\n]+/g, " ")}`;
  return (
    <Box flexShrink={0} flexDirection="column" paddingX={2} paddingTop={paddingTop}>
      <ThemedBox
        flexShrink={0}
        height={1}
        onClick={onToggle}
        onMouseEnter={() => setHeaderHovered(true)}
        onMouseLeave={() => setHeaderHovered(false)}
        backgroundColor={headerHovered ? "badgeHoverBackground" : undefined}
      >
        <Box flexShrink={0}>
          <ThemedText dim wrap="truncate">
            {`${folded ? "▸" : "▾"} ${t("subagent.panel")} ${running}/${subagents.length}`}
          </ThemedText>
        </Box>
        {compact && preview && (
          <Box flexShrink={0} flexGrow={1} onClick={() => onOpen(preview.agentId)}>
            <ThemedText dim wrap="truncate">{`  ${nodeLabel(preview)}`}</ThemedText>
          </Box>
        )}
      </ThemedBox>
      {visible.map((agent, index) => (
        <Box flexShrink={0} key={agent.agentId} height={1} onClick={() => onOpen(agent.agentId)}>
          <ThemedText wrap="truncate">
            <ThemedText dim>
              {index === visible.length - 1 && hidden === 0 ? "└─ " : "├─ "}
            </ThemedText>
            <ThemedText color={SUBAGENT_APPEARANCE[agent.status].color}>
              {nodeLabel(agent)}
            </ThemedText>
          </ThemedText>
        </Box>
      ))}
      {hidden > 0 && rowBudget >= 2 && (
        <Box flexShrink={0} height={1}>
          <ThemedText
            dim
            wrap="truncate"
          >{`└─ ${t("subagent.more", { count: hidden })}`}</ThemedText>
        </Box>
      )}
    </Box>
  );
}
