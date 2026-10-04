import { Box, ThemedBox, ThemedText, figures } from "@neant/tui";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";

export function UserMessage({
  text,
  source,
  locale = "zh",
}: {
  text: string;
  source?: string;
  locale?: Locale;
}) {
  const t = createTuiI18n(locale);
  return (
    <Box flexDirection="column">
      {source === "stop_hook" && (
        <Box paddingLeft={2}>
          <ThemedText color="subtle">{t("message.stop-hook-feedback")}</ThemedText>
        </Box>
      )}
      <ThemedBox color="userPromptLabel" paddingRight={3}>
        <Box width={2} flexShrink={0}>
          <ThemedText bold>{figures.user}</ThemedText>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <ThemedText bold preserveWhitespace>
            {text}
          </ThemedText>
        </Box>
      </ThemedBox>
    </Box>
  );
}
