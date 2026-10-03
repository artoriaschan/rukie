import { Box, HintLine, ListItem, ThemedText, ThemedTextInput } from "@neant/tui";
import type { Question } from "@neant/agent";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";

const singleLine = (text: string) => text.replace(/[\r\n]+/g, " ");

export function QuestionDialog({
  question,
  selected,
  checked,
  editing,
  custom,
  onCustomChange,
  onCustomSubmit,
  maxHeight,
  columns,
  locale,
}: {
  question: Question;
  selected: number;
  checked: number[];
  editing: boolean;
  custom: string;
  onCustomChange(value: string): void;
  onCustomSubmit(): void;
  maxHeight: number;
  columns: number;
  locale: Locale;
}) {
  const t = createTuiI18n(locale);
  const options = [...question.options, { label: t("question.other"), description: "" }];
  const count = options.length;
  const height = Math.min(maxHeight, count + 3);
  const visibleCount = Math.min(count, Math.max(1, height - 3));
  const first = Math.max(0, Math.min(selected, count - visibleCount));
  return (
    <Box flexDirection="column" height={height} paddingX={2} marginBottom={1}>
      <ThemedText color="permission" wrap="truncate">
        {singleLine(question.header)}
      </ThemedText>
      <ThemedText wrap="truncate">{singleLine(question.question)}</ThemedText>
      {options.slice(first, first + visibleCount).map(({ label, description }, index) => (
        <Box key={index} height={1} flexShrink={0}>
          {editing && first + index === question.options.length ? (
            <Box>
              <Box width={Bun.stringWidth(t("question.other")) + 8} flexShrink={0}>
                <ThemedText color="accent">{`❯ ${count}. ${t("question.other")}: `}</ThemedText>
              </Box>
              <ThemedTextInput
                value={custom}
                onChange={onCustomChange}
                onSubmit={onCustomSubmit}
                maxLines={1}
                columns={Math.max(1, columns - 12 - Bun.stringWidth(t("question.other")))}
                cursorStyle="block"
              />
            </Box>
          ) : (
            <ListItem focused={selected === first + index}>
              <ThemedText wrap="truncate">{`${first + index + 1}. ${(question.multiSelect || checked.length > 0) && first + index < question.options.length ? `[${checked.includes(first + index) ? "x" : " "}] ` : ""}${singleLine(label)}`}</ThemedText>
              {description && (
                <ThemedText dimColor wrap="truncate">{` · ${singleLine(description)}`}</ThemedText>
              )}
            </ListItem>
          )}
        </Box>
      ))}
      <HintLine>
        {[
          ...(!editing
            ? [
                ...(columns >= 50 ? [t("question.select")] : []),
                t(
                  question.multiSelect
                    ? "question.toggle"
                    : columns < 50
                      ? "question.keep-short"
                      : "question.keep",
                ),
              ]
            : []),
          t("dialog.confirm"),
          t("dialog.deny"),
        ].join(columns < 50 ? " " : " · ")}
      </HintLine>
    </Box>
  );
}
