import type { Locale } from "@rukie/i18n";
import type { ThinkingLevel } from "@rukie/shared";
import { createTuiI18n } from "../i18n";
import type { ModelCatalogEntry } from "@rukie/agent";

export interface ModelProviderTab {
  id: string;
  name: string;
  custom: boolean;
  models: readonly ModelCatalogEntry[];
}

/** Frontend visibility policy; credential discovery remains in Agent Core. */
export function modelProviderTabs(
  catalog: readonly ModelCatalogEntry[],
  current: string,
): ModelProviderTab[] {
  const tabs = new Map<string, ModelProviderTab>();
  const currentProvider = current.slice(0, current.indexOf("/"));
  for (const model of catalog) {
    if (!model.authenticated && !model.custom && model.providerId !== currentProvider) continue;
    const tab = tabs.get(model.providerId);
    if (tab) tabs.set(model.providerId, { ...tab, models: [...tab.models, model] });
    else
      tabs.set(model.providerId, {
        id: model.providerId,
        name: model.providerName,
        custom: model.custom,
        models: [model],
      });
  }
  return [...tabs.values()].sort(
    (a, b) =>
      Number(b.custom) - Number(a.custom) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

/** The terminal supplies cell measurement so this projection stays runtime independent. */
export function modelRowText(
  model: { name: string; spec: string },
  columns: number,
  measure: (text: string) => number,
): { name: string; spec: string } {
  const truncate = (text: string, width: number) => {
    if (measure(text) <= width) return text;
    if (width < 1) return "";
    let result = "";
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      text,
    )) {
      if (measure(result + segment + "…") > width) break;
      result += segment;
    }
    return result + "…";
  };
  const spec = truncate(model.spec, columns);
  const nameWidth = columns - measure(spec) - 1;
  return { name: model.name === model.spec ? "" : truncate(model.name, nameWidth), spec };
}

/** One localized notice describes only the changed facts in the effective selection. */
export function modelSelectionNotice(
  before: { model: string; thinkingLevel: ThinkingLevel },
  after: { model: string; thinkingLevel: ThinkingLevel; clampedFrom?: ThinkingLevel },
  name: string | undefined,
  locale: Locale,
  layout?: { columns: number; measure(text: string): number },
): string | undefined {
  const t = createTuiI18n(locale);
  const changes: string[] = [];
  if (before.model !== after.model) {
    const model = name && name !== after.model ? `${name} (${after.model})` : after.model;
    changes.push(t("model.changed", { model }));
  }
  if (before.thinkingLevel !== after.thinkingLevel)
    changes.push(
      t(changes.length ? "model.thinking-value" : "model.thinking-changed", {
        level: after.thinkingLevel,
      }),
    );
  if (after.clampedFrom)
    changes.push(t("model.thinking-clamped", { from: after.clampedFrom, to: after.thinkingLevel }));
  if (!changes.length) return undefined;
  if (!layout) return changes.join(" · ");
  const lines: string[] = [];
  let line = "";
  for (const [index, change] of changes.entries()) {
    const part = index ? `· ${change}` : change;
    if (line && layout.measure(`${line} ${part}`) <= layout.columns) line += ` ${part}`;
    else {
      if (line) lines.push(line);
      line = "";
      for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        part,
      )) {
        if (line && layout.measure(line + segment) > layout.columns) {
          lines.push(line.trimEnd());
          line = "";
        }
        line += segment;
      }
    }
  }
  if (line) lines.push(line.trimEnd());
  return lines.join("\n");
}
