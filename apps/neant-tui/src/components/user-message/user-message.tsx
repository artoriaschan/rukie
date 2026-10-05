import { Box, ThemedBox, ThemedText, figures } from "@neant/tui";
import type { PromptImage } from "@neant/agent";
import type { Locale } from "@neant/i18n";
import { ImagePlaceholder } from "../image-placeholder";
import { createTuiI18n } from "../../i18n";

export function UserMessage({
  text,
  source,
  images,
  onImageOpen,
  locale = "zh",
}: {
  text: string;
  source?: string;
  images?: PromptImage[];
  onImageOpen?(image: PromptImage): void;
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
      {images?.map((image, index) => (
        <ImagePlaceholder key={index} image={image} onOpen={onImageOpen} />
      ))}
    </Box>
  );
}
