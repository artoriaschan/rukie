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

/** Search the visible catalog in provider order without changing tab-local focus. */
export function filterModelTabs(
  tabs: readonly ModelProviderTab[],
  query: string,
): ModelCatalogEntry[] {
  const needle = query.toLowerCase();
  return tabs.flatMap((tab) =>
    tab.models.filter((model) =>
      [model.name, model.spec, model.providerName].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    ),
  );
}
