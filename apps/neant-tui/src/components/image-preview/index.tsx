import { useMemo, useRef, useState, useEffect } from "react";
import type { PromptImage } from "@neant/agent";
import type { Locale } from "@neant/i18n";
import { Box, Image, ThemedText, useInput, useTerminalGraphics, useTheme } from "@neant/tui";
import { createTuiI18n, formatError } from "../../i18n";
import { imageMetadata, imageName } from "../image-gallery";

/** Card lives only in the message viewport; controls never execute Session actions. */
export function ImagePreview({
  image,
  index,
  total,
  width,
  height,
  locale,
  onClose,
  onStep,
  onOriginal,
}: {
  image: PromptImage;
  index: number;
  total: number;
  width: number;
  height: number;
  locale: Locale;
  onClose(): void;
  onStep(delta: number): void;
  onOriginal(image: PromptImage): Promise<void>;
}) {
  const t = createTuiI18n(locale);
  const theme = useTheme();
  const graphics = useTerminalGraphics();
  const metadata = useMemo(() => imageMetadata(image), [image]);
  const [zoom, setZoom] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [original, setOriginal] = useState<string>();
  const opening = useRef(false);
  const owner = useRef(true);
  useEffect(
    () => () => {
      owner.current = false;
    },
    [],
  );
  const drawable = width >= 40 && height >= 12;
  const inspect =
    drawable &&
    graphics.supported &&
    image.mimeType === "image/png" &&
    !!graphics.cellWidth &&
    !!graphics.cellHeight &&
    !!metadata.width &&
    !!metadata.height;
  const activeZoom = inspect ? zoom : 0;
  const maxWidth = Math.max(1, Math.min(width - 8, Math.floor(width * 0.95) - 6));
  const maxHeight = Math.max(
    1,
    Math.min(height - 8, Math.floor(height * 0.95) - 7 - Number(total > 1)),
  );
  const sourceWidth = metadata.width ?? 1;
  const sourceHeight = metadata.height ?? 1;
  const cellWidth = graphics.cellWidth ?? 10;
  const cellHeight = graphics.cellHeight ?? 20;
  const ratio = ((sourceWidth / sourceHeight) * cellHeight) / cellWidth;
  const fitHeight = Math.min(maxHeight, Math.max(1, Math.round(maxWidth / ratio)));
  const fitWidth = Math.min(maxWidth, Math.max(1, Math.round(fitHeight * ratio)));
  const imageWidth = !drawable
    ? 0
    : activeZoom
      ? Math.min(maxWidth, Math.max(1, Math.ceil((sourceWidth * activeZoom) / cellWidth)))
      : fitWidth;
  const imageHeight = !drawable
    ? 0
    : activeZoom
      ? Math.min(maxHeight, Math.max(1, Math.ceil((sourceHeight * activeZoom) / cellHeight)))
      : fitHeight;
  const cropWidth = activeZoom
    ? Math.min(sourceWidth, Math.max(1, Math.round((imageWidth * cellWidth) / activeZoom)))
    : sourceWidth;
  const cropHeight = activeZoom
    ? Math.min(sourceHeight, Math.max(1, Math.round((imageHeight * cellHeight) / activeZoom)))
    : sourceHeight;
  const x = Math.max(0, Math.min(sourceWidth - cropWidth, Math.round(pan.x)));
  const y = Math.max(0, Math.min(sourceHeight - cropHeight, Math.round(pan.y)));
  const title = `${t("image.preview-title", { index: index + 1 })} · ${image.mimeType.replace("image/", "").toUpperCase()} · ${metadata.width ?? "?"}×${metadata.height ?? "?"} · ${metadata.bytes < 1024 ? `${metadata.bytes} B` : `${(metadata.bytes / 1024).toFixed(1)} KB`}${activeZoom ? ` · ${activeZoom * 100}%` : ""} · ${imageName(image, t("image.label"))}`;
  const cardWidth = Math.min(
    width,
    Math.max(Math.min(40, width), imageWidth + 6, Bun.stringWidth(title) + 6),
  );
  const cardHeight = Math.min(height, imageHeight + 6 + Number(total > 1));
  const left = Math.max(0, Math.floor((width - cardWidth) / 2));
  const top = Math.max(0, Math.floor((height - cardHeight) / 2));
  const drag = useRef<{ x: number; y: number } | undefined>(undefined);
  const panBy = (dx: number, dy: number) => {
    if (!activeZoom) return;
    setPan({
      x: Math.max(0, Math.min(sourceWidth - cropWidth, x + dx)),
      y: Math.max(0, Math.min(sourceHeight - cropHeight, y + dy)),
    });
  };
  useInput((event) => {
    const overImage =
      "x" in event &&
      event.x >= left + 3 &&
      event.x < left + 3 + imageWidth &&
      event.y >= top + 2 &&
      event.y < top + 2 + imageHeight;
    if (event.type === "wheel" && overImage)
      panBy(0, (event.delta * cellHeight * 3) / Math.max(1, activeZoom));
    if (event.type === "mouse" && event.button === 0) {
      if (event.action === "press" && overImage && activeZoom)
        drag.current = { x: event.x, y: event.y };
      else if (event.action === "release") drag.current = undefined;
    }
    if (event.type === "move" && drag.current && "button" in event && event.button === 0) {
      panBy(
        ((drag.current.x - event.x) * cellWidth) / Math.max(1, activeZoom),
        ((drag.current.y - event.y) * cellHeight) / Math.max(1, activeZoom),
      );
      drag.current = { x: event.x, y: event.y };
    }
  });
  const changeZoom = (value: number) => {
    const nextWidth = Math.min(
      sourceWidth,
      Math.max(
        1,
        Math.round(
          (Math.min(maxWidth, Math.ceil((sourceWidth * value) / cellWidth)) * cellWidth) /
            Math.max(1, value),
        ),
      ),
    );
    const nextHeight = Math.min(
      sourceHeight,
      Math.max(
        1,
        Math.round(
          (Math.min(maxHeight, Math.ceil((sourceHeight * value) / cellHeight)) * cellHeight) /
            Math.max(1, value),
        ),
      ),
    );
    setZoom(value);
    setPan({
      x: Math.max(0, Math.min(sourceWidth - nextWidth, x + cropWidth / 2 - nextWidth / 2)),
      y: Math.max(0, Math.min(sourceHeight - nextHeight, y + cropHeight / 2 - nextHeight / 2)),
    });
  };

  const button = (label: string, action: () => void, disabled = false) => (
    <Box onClick={disabled ? () => {} : action}>
      <ThemedText dimColor={disabled} underline={!disabled}>
        {label}
      </ThemedText>
    </Box>
  );
  const openOriginal = () => {
    if (opening.current) return;
    opening.current = true;
    setOriginal(t("image.opening"));
    void onOriginal(image)
      .then(
        () => {
          if (owner.current) setOriginal(undefined);
        },
        (error: unknown) => {
          if (owner.current) setOriginal(t("image.open-error", { error: formatError(error, t) }));
        },
      )
      .finally(() => {
        opening.current = false;
      });
  };
  return (
    <>
      <Box position="absolute" top={0} left={0} width={width} height={height} onClick={onClose} />
      <Box
        position="absolute"
        top={top}
        left={left}
        width={cardWidth}
        height={cardHeight}
        backgroundColor={theme.inverseText}
        borderStyle="round"
        paddingX={2}
        flexDirection="column"
        onClick={() => {}}
      >
        <ThemedText bold wrap="truncate">
          {title}
        </ThemedText>
        {drawable && (
          <Box width={imageWidth} height={imageHeight}>
            <ThemedText dimColor wrap="truncate">
              {t("image.preview-fallback")}
            </ThemedText>
            {graphics.supported &&
            image.mimeType === "image/png" &&
            metadata.width &&
            metadata.height ? (
              <Image
                position="absolute"
                top={0}
                left={0}
                data={image.data}
                mimeType={image.mimeType}
                sourceWidth={metadata.width}
                sourceHeight={metadata.height}
                width={imageWidth}
                height={imageHeight}
                crop={activeZoom ? { x, y, width: cropWidth, height: cropHeight } : undefined}
              />
            ) : null}
          </Box>
        )}
        <Box gap={2}>
          {button(t("image.fit"), () => changeZoom(0))}
          {button("100%", () => changeZoom(1), !inspect)}
          {button("−", () => changeZoom(activeZoom / 2), !inspect || activeZoom <= 1)}
          {button(
            "+",
            () => changeZoom(activeZoom ? Math.min(8, activeZoom * 2) : 1),
            !inspect || activeZoom >= 8,
          )}
          {button("←", () => panBy(-cropWidth / 4, 0), !activeZoom)}
          {button("↑", () => panBy(0, -cropHeight / 4), !activeZoom)}
          {button("↓", () => panBy(0, cropHeight / 4), !activeZoom)}
          {button("→", () => panBy(cropWidth / 4, 0), !activeZoom)}
        </Box>
        {total > 1 && height >= 6 && (
          <Box gap={2}>
            {button("‹", () => onStep(-1), index === 0)}
            <ThemedText>{`${index + 1}/${total}`}</ThemedText>
            {button("›", () => onStep(1), index === total - 1)}
          </Box>
        )}
        <Box onClick={openOriginal}>
          <ThemedText underline wrap="truncate">
            {original ?? `${t("image.open-original")}: ${imageName(image, t("image.label"))}`}
          </ThemedText>
        </Box>
        {height >= 6 && (
          <ThemedText dimColor wrap="truncate">
            {t("image.preview-close")}
          </ThemedText>
        )}
      </Box>
    </>
  );
}
