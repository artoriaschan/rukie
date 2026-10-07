import { Box, ThemedBox, ThemedText, figures } from "@neant/tui";
import type { PromptImage } from "@neant/agent";
import type { Locale } from "@neant/i18n";
import { ImageGallery } from "../image-gallery";
import { createTuiI18n } from "../../i18n";

export function UserMessage({
  text,
  source,
  images,
  onImageOpen,
  imagesSuspended,
  locale = "zh",
}: {
  text: string;
  source?: string;
  images?: PromptImage[];
  onImageOpen?(index: number): void;
  imagesSuspended?: boolean;
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
      {text.trim() && (
        <ThemedBox color="userPromptLabel" paddingRight={3}>
          <Box width={2} flexShrink={0} selectable={false}>
            <ThemedText bold>{figures.user}</ThemedText>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <ThemedText bold preserveWhitespace>
              {text}
            </ThemedText>
          </Box>
        </ThemedBox>
      )}
      {!!images?.length && (
        <ImageGallery
          images={images}
          onOpen={onImageOpen}
          suspended={imagesSuspended}
          locale={locale}
        />
      )}
    </Box>
  );
}
