import type { ContextCategory, ContextReport } from "@rukie/shared";
import type { Locale } from "@rukie/i18n";
import { createTuiI18n } from "../i18n";

export const order: ContextCategory[] = [
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

export function contextPresentation(
  report: ContextReport,
  expanded: boolean,
  modelName: string | undefined,
  locale: Locale,
) {
  const t = createTuiI18n(locale);
  const percent = (value: number) =>
    report.window > 0 ? ((value / report.window) * 100).toFixed(1) : "0.0";
  const modelId = report.model.slice(report.model.indexOf("/") + 1);
  const groups = [
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
  return {
    command: expanded ? "/context all" : "/context",
    title: t("context.title"),
    model: t("context.model", { model: modelName ?? modelId, window: formatTokens(report.window) }),
    modelId,
    total: t("context.total", {
      used: formatTokens(report.used),
      window: formatTokens(report.window),
      percent: Math.round(report.window > 0 ? (report.used / report.window) * 100 : 0),
    }),
    estimated: t("context.estimated"),
    expand: expanded ? "" : t("context.expand"),
    legend: order
      .flatMap((name) =>
        report.categories.filter((category) => category.name === name && category.tokens > 0),
      )
      .map((category) => ({
        name: category.name,
        label: t(`context.category.${category.name}`),
        usage: t(category.name === "free-space" ? "context.free" : "context.amount", {
          tokens: formatTokens(category.tokens),
          percent: percent(category.tokens),
        }),
      })),
    groups: groups
      .filter((group) => group.items.length > 0)
      .map((group) => ({
        ...group,
        label: t(`context.category.${group.name}`),
        summary: t("context.summary", {
          count: group.items.length,
          unit: t(`context.unit.${group.unit}${group.items.length === 1 ? "" : "s"}`),
          tokens: formatTokens(
            report.categories.find((category) => category.name === group.name)?.tokens ??
              group.items.reduce((sum, item) => sum + item.tokens, 0),
          ),
        }),
        details: expanded
          ? group.items.map((item) =>
              t("context.detail", { name: item.name, tokens: formatTokens(item.tokens) }),
            )
          : [],
      })),
  };
}
export function contextText(
  report: ContextReport,
  expanded: boolean,
  modelName: string | undefined,
  locale: Locale,
): string {
  const display = contextPresentation(report, expanded, modelName, locale);
  return [
    display.command,
    display.title,
    display.model,
    display.modelId,
    display.total,
    display.estimated,
    ...display.legend.map((row) => `${row.label}: ${row.usage}`),
    ...display.groups.flatMap((group) => [
      `${group.label} · ${group.command}`,
      group.summary,
      ...group.details,
    ]),
    display.expand,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Local snapshot; provider totals and category estimates retain their separate meanings. */
