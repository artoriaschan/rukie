import { Box, ThemedText, type ThemeColor } from "@neant/tui";
import type { ContextCategory, ContextReport } from "@neant/shared";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";

const colors: Record<ContextCategory, ThemeColor> = {
  "system-prompt": "accent",
  "memory-files": "remember",
  "system-tools": "toolNameExec",
  "mcp-tools": "toolNameMutate",
  skills: "plan",
  messages: "success",
  "free-space": "inactive",
  "compaction-reserve": "subtle",
};

/** Pure snapshot presentation; category estimates keep their independent provider total. */
export function ContextVisualization({
  report,
  columns,
  locale,
}: {
  report: ContextReport;
  columns: number;
  locale: Locale;
}) {
  const t = createTuiI18n(locale);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const percent = (value: number) =>
    report.window > 0 ? `${((value / report.window) * 100).toFixed(1)}` : "0.0";
  const million = report.window >= 1000000;
  const width = columns < 80 ? 5 : million ? 20 : 10;
  const height = columns < 80 && !million ? 5 : 10;
  const count = width * height;
  const cellTokens = report.window / count;
  const reserve =
    report.categories.find((category) => category.name === "compaction-reserve")?.tokens ?? 0;
  const limit = Math.max(0, report.window - reserve);
  let offset = 0;
  const spans = report.categories
    .filter((category) => !["free-space", "compaction-reserve"].includes(category.name))
    .map((category) => {
      const start = offset;
      offset = Math.min(limit, offset + category.tokens);
      return { ...category, start, end: offset };
    });
  const cells = Array.from({ length: count }, (_, index) => {
    const start = index * cellTokens;
    const end = start + cellTokens;
    if (report.window > 0 && start >= limit)
      return { symbol: "⛝", color: colors["compaction-reserve"] };
    const overlaps = spans.map((span) => ({
      name: span.name,
      tokens: Math.max(0, Math.min(end, span.end) - Math.max(start, span.start)),
    }));
    const occupied = overlaps.reduce((total, span) => total + span.tokens, 0);
    const owner = overlaps.toSorted((a, b) => b.tokens - a.tokens)[0];
    if (occupied <= 0 || !owner) return { symbol: "⛶", color: colors["free-space"] };
    return { symbol: occupied / cellTokens < 0.7 ? "⛀" : "⛁", color: colors[owner.name] };
  });
  const detailGroups = [
    {
      name: "memory-files" as const,
      items: report.memoryFiles.map((item) => ({ name: item.path, tokens: item.tokens })),
    },
    {
      name: "mcp-tools" as const,
      items: report.mcpTools.map((item) => ({
        name: `${item.server}/${item.name}`,
        tokens: item.tokens,
      })),
    },
    { name: "skills" as const, items: report.skills },
    { name: "agent-types" as const, items: report.agentTypes },
  ];
  return (
    <Box flexDirection="row" gap={2} flexShrink={0}>
      <Box flexDirection="column" width={width} flexShrink={0}>
        {Array.from({ length: height }, (_, row) => (
          <ThemedText key={row} wrap="truncate">
            {cells.slice(row * width, (row + 1) * width).map((cell, index) => (
              <ThemedText key={index} color={cell.color}>
                {cell.symbol}
              </ThemedText>
            ))}
          </ThemedText>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <ThemedText wrap="wrap">
          {t("context.total", {
            model: report.model,
            used: number(report.used),
            window: number(report.window),
            percent: percent(report.used),
          })}
        </ThemedText>
        <ThemedText color="inactive" wrap="wrap">
          {t("context.estimated")}
        </ThemedText>
        {report.categories.map((category) => (
          <ThemedText key={category.name} color={colors[category.name]} wrap="wrap">
            {t("context.category", {
              symbol:
                category.name === "free-space"
                  ? "⛶"
                  : category.name === "compaction-reserve"
                    ? "⛝"
                    : "⛁",
              name: t(`context.category.${category.name}`),
              tokens: number(category.tokens),
              percent: percent(category.tokens),
            })}
          </ThemedText>
        ))}
        {detailGroups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <Box key={group.name} flexDirection="column">
              <ThemedText color="inactive">{t(`context.category.${group.name}`)}</ThemedText>
              {group.items.map((item) => (
                <ThemedText key={item.name} wrap="wrap">
                  {t("context.detail", { name: item.name, tokens: number(item.tokens) })}
                </ThemedText>
              ))}
            </Box>
          ))}
      </Box>
    </Box>
  );
}
