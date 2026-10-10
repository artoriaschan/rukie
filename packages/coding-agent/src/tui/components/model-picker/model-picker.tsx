import { HintLine, ListItem, ThemedBox, ThemedText } from "../../../ink/index.ts";
import type { ThinkingLevel } from "@rukie/shared";
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
  current,
  maxHeight,
  columns,
  locale,
  loading,
  failed,
  notice,
  onPick,
  onTab,
}: {
  tabs: readonly ModelProviderTab[];
  thinkingLevel: ThinkingLevel;
  onThinking(level: ThinkingLevel): void;
  tab: number;
  focus: number;
  current: string;
  maxHeight: number;
  columns: number;
  locale: Locale;
  loading: boolean;
  failed: boolean;
  notice?: string;
  onPick(index: number): void;
  onTab(index: number): void;
}) {
  const t = createTuiI18n(locale);
  const models = tabs[tab]?.models ?? [];
  const capabilities = maxHeight >= 10;
  const count = Math.max(1, Math.floor((maxHeight - 7) / (capabilities ? 2 : 1)));
  const start = Math.max(0, Math.min(models.length - count, focus - Math.floor(count / 2)));
  return (
    <ThemedBox
      flexDirection="column"
      borderStyle="single"
      color="permission"
      paddingX={1}
      flexShrink={0}
    >
      <ThemedText color="permission" bold wrap="truncate">
        {t("model.title")}
      </ThemedText>
      {loading ? (
        <ThemedText>{t("model.loading")}</ThemedText>
      ) : failed ? (
        <ThemedText color="error" wrap="truncate">
          {t("model.load-failed")}
        </ThemedText>
      ) : (
        <>
          <ThemedBox flexDirection="row" height={1} flexShrink={0}>
            {tabs.map((provider, index) => (
              <ThemedBox key={provider.id} onClick={() => onTab(index)} flexShrink={1}>
                <ThemedText
                  bold={index === tab}
                  color={index === tab ? "suggestion" : "subtle"}
                  wrap="truncate"
                >{`${index === tab ? "[" : " "}${provider.name}${index === tab ? "]" : " "} `}</ThemedText>
              </ThemedBox>
            ))}
          </ThemedBox>
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
          {maxHeight >= 3 &&
            (models[focus]?.reasoning ? (
              <ThemedBox flexDirection="row" height={1} flexShrink={0}>
                {models[focus]!.thinkingLevels.map((level) => (
                  <ThemedBox key={level} onClick={() => onThinking(level)} flexShrink={1}>
                    <ThemedText
                      color={level === thinkingLevel ? "suggestion" : "subtle"}
                      bold={level === thinkingLevel}
                      wrap="truncate"
                    >
                      {`${level === thinkingLevel ? "[" : " "}${level}${level === thinkingLevel ? "]" : " "} `}
                    </ThemedText>
                  </ThemedBox>
                ))}
              </ThemedBox>
            ) : (
              <ThemedText color="inactive">{t("model.thinking-disabled")}</ThemedText>
            ))}
          <HintLine>{notice ?? t("model.providers-note")}</HintLine>
        </>
      )}
      <HintLine>{t("model.hint")}</HintLine>
    </ThemedBox>
  );
}
