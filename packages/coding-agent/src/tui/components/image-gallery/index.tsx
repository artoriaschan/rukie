import type { PromptImage } from "@neant/agent";
import type { PresentedImage } from "../../../view/transcript/images";
import type { Locale } from "@neant/i18n";
import {
  Box,
  Image,
  ThemedText,
  useTerminalGraphics,
  useTerminalSize,
} from "../../../ink/index.ts";
import { createTuiI18n } from "../../../view/i18n";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Image names are bounded display data, never terminal commands. */
export function imageName(image: PromptImage, fallback: string) {
  // oxlint-disable-next-line no-control-regex -- Remove terminal and C1 control characters.
  const safe = (image.name ?? fallback).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
  let label = "";
  for (const { segment } of graphemes.segment(safe)) {
    if (Bun.stringWidth(label + segment) > 80) break;
    label += segment;
  }
  return label;
}

export function ImageGallery({
  images,
  onOpen,
  suspended = false,
  locale = "zh",
}: {
  images: readonly PresentedImage[];
  onOpen?(index: number): void;
  suspended?: boolean;
  locale?: Locale;
}) {
  const { columns, rows } = useTerminalSize();
  const graphics = useTerminalGraphics();
  const t = createTuiI18n(locale);
  const available = Math.max(1, columns - 5);
  const perRow = Math.max(1, Math.floor((available + 1) / 11));
  const groups =
    images.length <= 1
      ? [images]
      : Array.from({ length: Math.ceil(images.length / perRow) }, (_, row) =>
          images.slice(row * perRow, (row + 1) * perRow),
        );
  return (
    <Box flexDirection="column" paddingLeft={2} gap={1}>
      {groups.map((group, row) => (
        <Box key={row} gap={1}>
          {group.map((image, column) => (
            <Thumbnail
              key={column}
              image={image}
              multiple={images.length > 1}
              available={available}
              graphics={graphics.supported && columns >= 40 && rows >= 12 && !suspended}
              onOpen={onOpen ? () => onOpen(row * perRow + column) : undefined}
              fallback={t("image.label")}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}

function Thumbnail({
  image,
  multiple,
  available,
  graphics,
  onOpen,
  fallback,
}: {
  image: PresentedImage;
  multiple: boolean;
  available: number;
  graphics: boolean;
  onOpen?: () => void;
  fallback: string;
}) {
  const metadata = image.metadata;
  const ratio = Math.max(0.25, Math.min(4, (metadata.width ?? 1) / (metadata.height ?? 1)));
  const width = Math.min(multiple ? 10 : 24, available);
  const height = multiple
    ? Math.max(1, Math.round(width / 2))
    : Math.min(12, Math.max(1, Math.round(width / ratio / 2)));
  const fitWidth = multiple ? width : Math.min(width, Math.max(1, Math.round(height * ratio * 2)));
  const actualRatio = ((metadata.width ?? 1) / (metadata.height ?? 1)) * 2;
  const drawHeight = Math.min(height, Math.max(1, Math.round(fitWidth / actualRatio)));
  const drawWidth = Math.min(fitWidth, Math.max(1, Math.round(drawHeight * actualRatio)));
  return (
    <Box flexDirection="column" width={fitWidth} height={height + 1} onClick={onOpen}>
      <Box width={fitWidth} height={height}>
        <ThemedText
          dimColor
          wrap="truncate"
        >{`[Image · ${imageName(image, fallback)}]`}</ThemedText>
        {graphics && image.mimeType === "image/png" && metadata.width && metadata.height ? (
          <Image
            position="absolute"
            top={Math.floor((height - drawHeight) / 2)}
            left={Math.floor((fitWidth - drawWidth) / 2)}
            data={image.data}
            mimeType={image.mimeType}
            sourceWidth={metadata.width}
            sourceHeight={metadata.height}
            width={drawWidth}
            height={drawHeight}
          />
        ) : null}
      </Box>
      <ThemedText dimColor wrap="truncate">
        {imageName(image, fallback)}
      </ThemedText>
    </Box>
  );
}
