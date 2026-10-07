import { Box, ThemedBox, ThemedText, figures } from "../../../ink/index.ts";
import type { PresentedImage } from "../../../view/transcript/images";
import type { Locale } from "@rukie/i18n";
import { ImageGallery } from "../image-gallery";
import { createTuiI18n } from "../../../view/i18n";

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
  images?: PresentedImage[];
  onImageOpen?(index: number): void;
  imagesSuspended?: boolean;
  locale?: Locale;
}) {
  const t = createTuiI18n(locale);
  return (
    <Box flexShrink={0} flexDirection="column">
      {source === "stop_hook" && (
        <Box flexShrink={0} paddingLeft={2}>
          <ThemedText color="subtle">{t("message.stop-hook-feedback")}</ThemedText>
        </Box>
      )}
      {text.trim() && (
        <ThemedBox flexShrink={0} color="userPromptLabel" paddingRight={3}>
          <Box width={2} flexShrink={0} noSelect>
            <ThemedText bold>{figures.user}</ThemedText>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <ThemedText bold>{text}</ThemedText>
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
