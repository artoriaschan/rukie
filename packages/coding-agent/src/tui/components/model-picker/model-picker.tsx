import { HintLine, ListItem, ThemedBox, ThemedText } from "../../../ink/index.ts";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../../view/i18n";

/** A focus-centered, bounded list using the same picker rows as rewind. */
export function ModelPicker({
  models,
  focus,
  current,
  maxHeight,
  locale,
  onPick,
}: {
  models: readonly { spec: string; name: string }[];
  focus: number;
  current: string;
  maxHeight: number;
  locale: Locale;
  onPick(index: number): void;
}) {
  const t = createTuiI18n(locale);
  const count = Math.max(1, maxHeight - 4);
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
      {models.slice(start, start + count).map((model, index) => (
        <ListItem
          key={model.spec}
          picker
          singleLine
          focused={focus === start + index}
          showScrollUp={index === 0 && start > 0}
          showScrollDown={index === count - 1 && start + count < models.length}
          onClick={() => onPick(start + index)}
        >{`${model.spec === current ? "✓ " : ""}${model.spec}`}</ListItem>
      ))}
      <HintLine>{t("model.hint")}</HintLine>
    </ThemedBox>
  );
}
