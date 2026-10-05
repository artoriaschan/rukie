import { Box, ThemedText } from "@neant/tui";
import type { PromptImage } from "@neant/agent";

const names = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function ImagePlaceholder({
  image,
  onOpen,
}: {
  image: PromptImage;
  onOpen?(image: PromptImage): void;
}) {
  let name = "";
  // Filenames are display data; control bytes cannot alter terminal presentation.
  // oxlint-disable-next-line no-control-regex -- Flatten untrusted filename controls.
  const displayName = (image.name ?? "Image").replace(/[\x00-\x1f\x7f]/g, " ");
  for (const { segment } of names.segment(displayName)) {
    if (Bun.stringWidth(name + segment) > 80) break;
    name += segment;
  }
  return (
    <Box paddingLeft={2} onClick={onOpen ? () => onOpen(image) : undefined}>
      <ThemedText dimColor wrap="truncate">{`[Image · ${name}]`}</ThemedText>
    </Box>
  );
}
