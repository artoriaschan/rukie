import { Box, ThemedText, type ThemeColor } from "../../../ink/index.ts";
import type { ContextCategory, ContextReport } from "@rukie/shared";
import type { Locale } from "@rukie/i18n";
import { UserMessage } from "../user-message";

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
import { contextPresentation, order } from "../../../view/transcript/context";

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
  const display = contextPresentation(report, expanded, modelName, locale);
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

  const legend = display.legend.map((category) => {
    const symbol =
      category.name === "free-space" ? "⛶" : category.name === "compaction-reserve" ? "⛝" : "⛁";
    return (
      <ThemedText key={category.name} color={text} wrap="wrap">
        <ThemedText color={colors[category.name]}>{symbol}</ThemedText>
        {` ${category.label}: `}
        <ThemedText color={muted}>{category.usage}</ThemedText>
      </ThemedText>
    );
  });
  // A 1M grid uses 40 columns; stack if the legend cannot fit beside it.
  const legendWidth = Math.max(
    0,
    ...display.legend.map((category) => Bun.stringWidth(`⛁ ${category.label}: ${category.usage}`)),
  );
  const sideBySide = columns >= 80 && columns >= width * 2 + 7 + legendWidth;
  return (
    <Box flexDirection="column" flexShrink={0}>
      <UserMessage text={display.command} locale={locale} />
      <Box paddingLeft={2}>
        <ThemedText color={text} bold>{`└ ${display.title}`}</ThemedText>
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
            <ThemedText color={muted}>{display.model}</ThemedText>
            <ThemedText color={muted}>{display.modelId}</ThemedText>
            <ThemedText color={muted}>{display.total}</ThemedText>
            <Box flexDirection="column" marginTop={1}>
              <ThemedText color={muted} italic>
                {display.estimated}
              </ThemedText>
              {legend}
            </Box>
          </Box>
        </Box>
        {display.groups.map((group) => (
          <Box key={group.name} flexDirection="column" marginTop={1}>
            <ThemedText color={text}>
              <ThemedText bold>{group.label}</ThemedText>
              <ThemedText color={muted}>{` · ${group.command}`}</ThemedText>
            </ThemedText>
            <ThemedText color={muted}>{group.summary}</ThemedText>
            {expanded &&
              group.details.map((detail) => (
                <ThemedText key={detail} color={muted} wrap="wrap">
                  {detail}
                </ThemedText>
              ))}
          </Box>
        ))}
        {!expanded && (
          <Box marginTop={1}>
            <ThemedText color={muted}>{display.expand}</ThemedText>
          </Box>
        )}
      </Box>
    </Box>
  );
}
