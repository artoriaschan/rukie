import { HintLine, ListItem, ThemedBox, ThemedText } from "../../../ink/index.ts";
import type { ThinkingLevel } from "@rukie/shared";
import type { ModelCatalogEntry } from "@rukie/agent";
import type { Locale } from "@rukie/i18n";
import { createTuiI18n } from "../../../view/i18n";
import { modelRowText, type ModelProviderTab } from "../../../view/model-picker";

/** Provider-local, focus-centered rows; the screen owns synchronous cursor state. */
export function ModelPicker({
  tabs,
  thinkingLevel,
  onThinking,
  tab,
  focus,
  query,
  filteredModels,
  current,
  maxHeight,
  columns,
  locale,
  loading,
  failed,
  notice,
  onPick,
  onTab,
  onWheel,
}: {
  tabs: readonly ModelProviderTab[];
  thinkingLevel: ThinkingLevel;
  onThinking(level: ThinkingLevel): void;
  tab: number;
  focus: number;
  query: string;
  filteredModels: readonly ModelCatalogEntry[];
  current: string;
  maxHeight: number;
  columns: number;
  locale: Locale;
  loading: boolean;
  failed: boolean;
  notice?: string;
  onPick(index: number): void;
  onTab(index: number): void;
  onWheel(delta: number): void;
}) {
  const t = createTuiI18n(locale);
  const models = query ? filteredModels : (tabs[tab]?.models ?? []);
  const width = Math.max(1, columns - 4);
  const spacious = maxHeight >= 14 && Bun.stringWidth(t("model.hint")) <= width;
  const shortHint = maxHeight < 9 || Bun.stringWidth(t("model.hint")) > width;
  const capabilities = maxHeight >= 9;
  // Borders and fixed chrome share the caller's budget with selectable rows.
  // Tiny allocations retain the focused model and keyboard operation without a frame.
  const minimal = maxHeight < 7;
  const showThinking = minimal ? maxHeight >= 3 : maxHeight >= 8;
  const chromeHeight = minimal ? Number(maxHeight >= 2) : spacious ? 9 : 6;
  const count = Math.max(
    1,
    Math.floor((maxHeight - chromeHeight - Number(showThinking)) / (capabilities ? 2 : 1)),
  );
  const providerWindow = stripWindow(
    tabs.map((provider) => provider.name),
    tab,
    width,
  );
  const levels = models[focus]?.thinkingLevels ?? [];
  const levelWindow = stripWindow(levels, Math.max(0, levels.indexOf(thinkingLevel)), width);
  const start = Math.max(0, Math.min(models.length - count, focus - Math.floor(count / 2)));
  if (maxHeight <= 0) return null;
  return (
    <ThemedBox
      flexDirection="column"
      borderStyle={minimal ? undefined : "single"}
      color="permission"
      paddingX={1}
      flexShrink={0}
      onWheel={(event) => onWheel(event.deltaY)}
    >
      {!minimal && (
        <ThemedText color="permission" bold wrap="truncate">
          {t("model.title")}
        </ThemedText>
      )}
      {loading ? (
        <ThemedText wrap="truncate">{t("model.loading")}</ThemedText>
      ) : failed ? (
        <ThemedText color="error" wrap="truncate">
          {t("model.load-failed")}
        </ThemedText>
      ) : (
        <>
          {maxHeight >= 2 && (
            <HintLine>
              {minimal && notice ? notice : t(shortHint ? "model.hint-short" : "model.hint")}
            </HintLine>
          )}
          {spacious && <ThemedBox height={1} />}
          {!minimal &&
            (query ? (
              <ThemedText wrap="truncate">{t("model.filter", { query })}</ThemedText>
            ) : (
              <ThemedBox flexDirection="row" height={1} flexShrink={0}>
                {providerWindow.start > 0 && <ThemedText color="subtle">‹ </ThemedText>}
                {tabs.slice(providerWindow.start, providerWindow.end).map((provider, offset) => {
                  const index = providerWindow.start + offset;
                  return (
                    <ThemedBox
                      key={provider.id}
                      onClick={() => onTab(index)}
                      flexShrink={0}
                      width={Math.min(width - 4, Bun.stringWidth(provider.name) + 3)}
                    >
                      <ThemedText
                        bold={index === tab}
                        color={index === tab ? "suggestion" : "subtle"}
                        wrap="truncate"
                      >{`${index === tab ? "[" : " "}${provider.name}${index === tab ? "]" : " "} `}</ThemedText>
                    </ThemedBox>
                  );
                })}
                {providerWindow.end < tabs.length && <ThemedText color="subtle">›</ThemedText>}
              </ThemedBox>
            ))}
          {models.length === 0 && (
            <ThemedText color="subtle" wrap="truncate">
              {t("model.empty")}
            </ThemedText>
          )}
          {models.slice(start, start + count).map((model, index) => {
            const missing = model.custom && !model.authenticated;
            const prefix = model.spec === current ? "✓ " : "";
            const suffix = missing ? ` · ${t("model.no-credentials")}` : "";
            const text = modelRowText(
              model,
              Math.max(0, columns - 6 - Bun.stringWidth(prefix + suffix)),
              Bun.stringWidth,
            );
            return (
              <ListItem
                key={model.spec}
                picker
                singleLine
                focused={focus === start + index}
                showScrollUp={index === 0 && start > 0}
                showScrollDown={index === count - 1 && start + count < models.length}
                description={
                  capabilities
                    ? t("model.capabilities", {
                        image: model.input.includes("image") ? t("model.image") : t("model.text"),
                        reasoning: model.reasoning ? t("model.reasoning") : t("model.no-reasoning"),
                        context: model.contextWindow.toLocaleString(
                          locale === "zh" ? "zh-CN" : "en-US",
                        ),
                      })
                    : undefined
                }
                onClick={() => onPick(start + index)}
              >
                <ThemedText color={missing ? "inactive" : undefined}>
                  {prefix}
                  {text.name ? `${text.name} ` : ""}
                </ThemedText>
                <ThemedText color={missing ? "inactive" : "subtle"}>
                  {text.spec}
                  {suffix}
                </ThemedText>
              </ListItem>
            );
          })}
          {spacious && <ThemedBox height={1} />}
          {showThinking &&
            (models[focus]?.reasoning ? (
              <ThemedBox flexDirection="row" height={1} flexShrink={0}>
                {levelWindow.start > 0 && <ThemedText color="subtle">‹ </ThemedText>}
                {levels.slice(levelWindow.start, levelWindow.end).map((level) => (
                  <ThemedBox
                    key={level}
                    onClick={() => onThinking(level)}
                    flexShrink={0}
                    width={Bun.stringWidth(level) + 3}
                  >
                    <ThemedText
                      color={level === thinkingLevel ? "suggestion" : "subtle"}
                      bold={level === thinkingLevel}
                      wrap="truncate"
                    >
                      {`${level === thinkingLevel ? "[" : " "}${level}${level === thinkingLevel ? "]" : " "} `}
                    </ThemedText>
                  </ThemedBox>
                ))}
                {levelWindow.end < levels.length && <ThemedText color="subtle">›</ThemedText>}
              </ThemedBox>
            ) : (
              <ThemedText color="inactive" wrap="truncate">
                {t("model.thinking-disabled")}
              </ThemedText>
            ))}
          {spacious && <HintLine>{t("model.thinking-description")}</HintLine>}
          {!minimal && <HintLine>{notice ?? t("model.providers-note")}</HintLine>}
        </>
      )}
      {(loading || failed) && maxHeight >= 2 && <HintLine>{t("model.hint-short")}</HintLine>}
    </ThemedBox>
  );
}

/** Keep the focused cell intact; reserve the two continuation markers on overflow. */
function stripWindow(labels: readonly string[], focus: number, width: number) {
  const sizes = labels.map((label) => Bun.stringWidth(label) + 3);
  if (sizes.reduce((sum, size) => sum + size, 0) <= width) return { start: 0, end: labels.length };
  let start = focus;
  let end = Math.min(labels.length, focus + 1);
  let used = sizes[focus] ?? 0;
  const budget = Math.max(1, width - 4);
  while (start > 0 || end < labels.length) {
    const left = start > 0 ? sizes[start - 1]! : Infinity;
    const right = end < labels.length ? sizes[end]! : Infinity;
    const preferLeft = focus - start <= end - focus - 1;
    if (preferLeft && used + left <= budget) {
      used += left;
      start--;
    } else if (used + right <= budget) {
      used += right;
      end++;
    } else if (used + left <= budget) {
      used += left;
      start--;
    } else break;
  }
  return { start, end };
}
