import { Box, HintLine, ListItem, ThemedText } from "@neant/tui";
import type { Question } from "@neant/agent";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";

const singleLine = (text: string) => text.replace(/[\r\n]+/g, " ");

export function QuestionDialog({
  question,
  selected,
  maxHeight,
  columns,
  locale,
}: {
  question: Question;
  selected: number;
  maxHeight: number;
  columns: number;
  locale: Locale;
}) {
  const t = createTuiI18n(locale);
  const count = question.options.length;
  const height = Math.min(maxHeight, count + 3);
  const visibleCount = Math.min(count, Math.max(1, height - 3));
  const first = Math.max(0, Math.min(selected, count - visibleCount));
  return (
    <Box flexDirection="column" height={height} paddingX={2} marginBottom={1}>
      <ThemedText color="permission" wrap="truncate">
        {singleLine(question.header)}
      </ThemedText>
      <ThemedText wrap="truncate">{singleLine(question.question)}</ThemedText>
      {question.options.slice(first, first + visibleCount).map(({ label, description }, index) => (
        <Box key={index} height={1} flexShrink={0}>
          <ListItem focused={selected === first + index}>
            <ThemedText wrap="truncate">{`${first + index + 1}. ${singleLine(label)}`}</ThemedText>
            <ThemedText dimColor wrap="truncate">{` · ${singleLine(description)}`}</ThemedText>
          </ListItem>
        </Box>
      ))}
      <HintLine>
        {[t("question.select"), t("dialog.confirm"), t("dialog.deny")].join(
          columns < 50 ? " " : " · ",
        )}
      </HintLine>
    </Box>
  );
}
