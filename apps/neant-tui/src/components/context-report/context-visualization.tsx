import { Box, ThemedText, type ThemeColor } from "@neant/tui";
import type { ContextCategory, ContextReport } from "@neant/shared";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";

// Local reference palette: /context does not recolor the rest of the TUI.
const text = "#999999";
const muted = "#666666";
const colors: Record<ContextCategory, ThemeColor> = {
  "system-prompt": muted,
  "system-tools": muted,
  "mcp-tools": "#267F46",
  "memory-files": "#D77757",
  skills: "#D7AF00",
  messages: "#8B82C9",
  "free-space": muted,
  "compaction-reserve": muted,
};
const order: ContextCategory[] = [
  "system-prompt",
  "system-tools",
  "mcp-tools",
  "memory-files",
  "skills",
  "messages",
  "free-space",
  "compaction-reserve",
];

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}m`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}k`;
  return String(value);
}

/** Local snapshot; provider totals and category estimates retain their separate meanings. */
export function ContextVisualization({
  report,
  columns,
  locale,
  expanded = false,
  modelName,
}: {
  report: ContextReport;
  columns: number;
  locale: Locale;
  expanded?: boolean;
  modelName?: string;
}) {
  const t = createTuiI18n(locale);
  const percent = (value: number) =>
    report.window > 0 ? ((value / report.window) * 100).toFixed(1) : "0.0";
  const million = report.window >= 1_000_000;
  const width = columns < 80 ? 5 : million ? 20 : 10;
  const height = columns < 80 && !million ? 5 : 10;
  const count = width * height;
  const categories = order.flatMap((name) =>
    report.categories.filter((category) => category.name === name && category.tokens > 0),
  );
  const cellTokens = report.window / count;
  const reserve = categories.find((category) => category.name === "compaction-reserve");
  const reserved = Math.min(count, Math.round((reserve?.tokens ?? 0) / cellTokens) || 0);
  const cells: { symbol: string; color: ThemeColor }[] = [];
  // Give every nonempty category at least one cell, matching the reference grid.
  for (const category of categories) {
    if (category.name === "free-space" || category.name === "compaction-reserve") continue;
    const exact = category.tokens / cellTokens;
    const squares = Math.min(count - cells.length, Math.max(1, Math.round(exact)));
    for (let index = 0; index < squares; index++)
      cells.push({
        symbol: index === Math.floor(exact) && exact % 1 < 0.7 ? "⛀" : "⛁",
        color: colors[category.name],
      });
  }
  while (cells.length < count - reserved) cells.push({ symbol: "⛶", color: colors["free-space"] });
  while (cells.length < count) cells.push({ symbol: "⛝", color: colors["compaction-reserve"] });

  const detailGroups = [
    {
      name: "mcp-tools" as const,
      command: "/mcp",
      unit: "tool" as const,
      items: report.mcpTools.map((item) => ({
        name: `${item.server}/${item.name}`,
        tokens: item.tokens,
      })),
    },
    {
      name: "agent-types" as const,
      command: ".agents/agents/",
      unit: "agent" as const,
      items: report.agentTypes,
    },
    {
      name: "memory-files" as const,
      command: "/memory",
      unit: "file" as const,
      items: report.memoryFiles.map((item) => ({ name: item.path, tokens: item.tokens })),
    },
    { name: "skills" as const, command: "/skills", unit: "skill" as const, items: report.skills },
  ];
  const legend = categories.map((category) => {
    const symbol =
      category.name === "free-space" ? "⛶" : category.name === "compaction-reserve" ? "⛝" : "⛁";
    const usage = t(category.name === "free-space" ? "context.free" : "context.amount", {
      tokens: formatTokens(category.tokens),
      percent: percent(category.tokens),
    });
    return (
      <ThemedText key={category.name} color={text} wrap="wrap">
        <ThemedText color={colors[category.name]}>{symbol}</ThemedText>
        {` ${t(`context.category.${category.name}`)}: `}
        <ThemedText color={muted}>{usage}</ThemedText>
      </ThemedText>
    );
  });
  // A 1M grid uses 40 columns; stack if the legend cannot fit beside it.
  const legendWidth = Math.max(
    0,
    ...categories.map((category) =>
      Bun.stringWidth(
        `⛁ ${t(`context.category.${category.name}`)}: ${t("context.amount", {
          tokens: formatTokens(category.tokens),
          percent: percent(category.tokens),
        })}`,
      ),
    ),
  );
  const sideBySide = columns >= 80 && columns >= width * 2 + 7 + legendWidth;
  const modelId = report.model.slice(report.model.indexOf("/") + 1);
  return (
    <Box flexDirection="column" flexShrink={0}>
      <ThemedText color={text} bold>
        <ThemedText backgroundColor="#2B2B2B">{`❯ /context${expanded ? " all" : ""}`}</ThemedText>
      </ThemedText>
      <Box paddingLeft={2}>
        <ThemedText color={text} bold>{`└ ${t("context.title")}`}</ThemedText>
      </Box>
      <Box flexDirection="column" paddingLeft={5}>
        <Box flexDirection={sideBySide ? "row" : "column"} gap={sideBySide ? 2 : 1}>
          <Box flexDirection="column" width={width * 2} flexShrink={0}>
            {Array.from({ length: height }, (_, row) => (
              <ThemedText key={row} wrap="truncate">
                {cells.slice(row * width, (row + 1) * width).map((cell, index) => (
                  <ThemedText key={index} color={cell.color}>{`${cell.symbol} `}</ThemedText>
                ))}
              </ThemedText>
            ))}
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <ThemedText color={muted}>
              {t("context.model", {
                model: modelName ?? modelId,
                window: formatTokens(report.window),
              })}
            </ThemedText>
            <ThemedText color={muted}>{modelId}</ThemedText>
            <ThemedText color={muted}>
              {t("context.total", {
                used: formatTokens(report.used),
                window: formatTokens(report.window),
                percent: Math.round(report.window > 0 ? (report.used / report.window) * 100 : 0),
              })}
            </ThemedText>
            <Box flexDirection="column" marginTop={1}>
              <ThemedText color={muted} italic>
                {t("context.estimated")}
              </ThemedText>
              {legend}
            </Box>
          </Box>
        </Box>
        {detailGroups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <Box key={group.name} flexDirection="column" marginTop={1}>
              <ThemedText color={text}>
                <ThemedText bold>{t(`context.category.${group.name}`)}</ThemedText>
                <ThemedText color={muted}>{` · ${group.command}`}</ThemedText>
              </ThemedText>
              <ThemedText color={muted}>
                {t("context.summary", {
                  count: group.items.length,
                  unit: t(`context.unit.${group.unit}${group.items.length === 1 ? "" : "s"}`),
                  tokens: formatTokens(
                    report.categories.find((category) => category.name === group.name)?.tokens ??
                      group.items.reduce((sum, item) => sum + item.tokens, 0),
                  ),
                })}
              </ThemedText>
              {expanded &&
                group.items.map((item) => (
                  <ThemedText key={item.name} color={muted} wrap="wrap">
                    {t("context.detail", { name: item.name, tokens: formatTokens(item.tokens) })}
                  </ThemedText>
                ))}
            </Box>
          ))}
        {!expanded && (
          <Box marginTop={1}>
            <ThemedText color={muted}>{t("context.expand")}</ThemedText>
          </Box>
        )}
      </Box>
    </Box>
  );
}
