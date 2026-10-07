import type { PresentedImage } from "../../../view/transcript/images";
import { useRef, useState, useEffect } from "react";
import type { PromptImage } from "@rukie/agent";
import type { Locale } from "@rukie/i18n";
import {
  Box,
  Image,
  ThemedText,
  useTerminalImages,
  useTerminalImageCellSize,
  useTheme,
} from "../../../ink/index.ts";
import { createTuiI18n, formatError } from "../../../view/i18n";
import { useImageSource } from "../image-source";
import { imageName } from "../image-gallery";

/** Card lives only in the message viewport; controls never execute Session actions. */
export function ImagePreview({
  image,
  index,
  total,
  width,
  height,
  locale,
  passive = false,
  onClose,
  onStep,
  onOriginal,
}: {
  image: PresentedImage;
  index: number;
  total: number;
  width: number;
  height: number;
  locale: Locale;
  passive?: boolean;
  onClose?(): void;
  onStep?(delta: number): void;
  onOriginal?(image: PromptImage): Promise<void>;
}) {
  const t = createTuiI18n(locale);
  const theme = useTheme();
  const supported = useTerminalImages(width >= 40 && height >= 12);
  const cellSize = useTerminalImageCellSize();
  const metadata = image.metadata;
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
  const drawableImage =
    drawable && supported && image.mimeType === "image/png" && metadata.width && metadata.height
      ? { width: metadata.width, height: metadata.height }
      : undefined;
  const inspect = !passive && !!drawableImage && !!cellSize?.width && !!cellSize?.height;
  const activeZoom = inspect ? zoom : 0;
  const maxWidth = Math.max(1, Math.min(width - 8, Math.floor(width * 0.95) - 6));
  const maxHeight = Math.max(
    1,
    Math.min(height - 8, Math.floor(height * 0.95) - 7 - Number(total > 1)),
  );
  const sourceWidth = metadata.width ?? 1;
  const sourceHeight = metadata.height ?? 1;
  const cellWidth = cellSize?.width ?? 10;
  const cellHeight = cellSize?.height ?? 20;
  // One calculation keeps rendered crop geometry and zoom-center preservation aligned.
  const geometry = (value: number) => {
    if (value === 0) {
      const ratio = ((sourceWidth / sourceHeight) * cellHeight) / cellWidth;
      const imageHeight = Math.min(maxHeight, Math.max(1, Math.round(maxWidth / ratio)));
      return {
        imageWidth: Math.min(maxWidth, Math.max(1, Math.round(imageHeight * ratio))),
        imageHeight,
        cropWidth: sourceWidth,
        cropHeight: sourceHeight,
      };
    }
    const imageWidth = Math.min(
      maxWidth,
      Math.max(1, Math.ceil((sourceWidth * value) / cellWidth)),
    );
    const imageHeight = Math.min(
      maxHeight,
      Math.max(1, Math.ceil((sourceHeight * value) / cellHeight)),
    );
    return {
      imageWidth,
      imageHeight,
      cropWidth: Math.min(sourceWidth, Math.max(1, Math.round((imageWidth * cellWidth) / value))),
      cropHeight: Math.min(
        sourceHeight,
        Math.max(1, Math.round((imageHeight * cellHeight) / value)),
      ),
    };
  };
  const currentGeometry = geometry(activeZoom);
  const imageWidth = drawable ? currentGeometry.imageWidth : 0;
  const imageHeight = drawable ? currentGeometry.imageHeight : 0;
  const { cropWidth, cropHeight } = currentGeometry;
  const x = Math.max(0, Math.min(sourceWidth - cropWidth, Math.round(pan.x)));
  const y = Math.max(0, Math.min(sourceHeight - cropHeight, Math.round(pan.y)));
  const source = useImageSource(
    image.data,
    !!drawableImage,
    "preview",
    activeZoom ? { x, y, width: cropWidth, height: cropHeight } : undefined,
  );
  const title = `${t("image.preview-title", { index: index + 1 })} · ${image.mimeType.replace("image/", "").toUpperCase()} · ${metadata.width ?? "?"}×${metadata.height ?? "?"} · ${metadata.bytes < 1024 ? `${metadata.bytes} B` : `${(metadata.bytes / 1024).toFixed(1)} KB`}${activeZoom ? ` · ${activeZoom * 100}%` : ""} · ${imageName(image, t("image.label"))}`;
  const cardWidth = Math.min(
    width,
    Math.max(
      Math.min(40, width),
      imageWidth + 6,
      Bun.stringWidth(title) + 6,
      drawable ? 0 : Bun.stringWidth(t("image.preview-fallback")) + 6,
    ),
  );
  const cardHeight = Math.min(height, imageHeight + 6 + Number(total > 1));
  const left = Math.max(0, Math.floor((width - cardWidth) / 2));
  const top = Math.max(0, Math.floor((height - cardHeight) / 2));
  const drag = useRef<{ x: number; y: number } | undefined>(undefined);
  const panBy = (dx: number, dy: number) => {
    if (!activeZoom) return;
    setPan((previous) => ({
      x: Math.max(0, Math.min(sourceWidth - cropWidth, previous.x + dx)),
      y: Math.max(0, Math.min(sourceHeight - cropHeight, previous.y + dy)),
    }));
  };
  const changeZoom = (value: number) => {
    setZoom(value);
    if (value === 0) {
      setPan({ x: 0, y: 0 });
      return;
    }
    const next = geometry(value);
    setPan({
      x: Math.max(
        0,
        Math.min(sourceWidth - next.cropWidth, x + cropWidth / 2 - next.cropWidth / 2),
      ),
      y: Math.max(
        0,
        Math.min(sourceHeight - next.cropHeight, y + cropHeight / 2 - next.cropHeight / 2),
      ),
    });
  };

  const button = (label: string, action: () => void, disabled = false) => (
    <Box onClick={disabled ? () => {} : action}>
      <ThemedText dim={disabled} underline={!disabled}>
        {label}
      </ThemedText>
    </Box>
  );
  const openOriginal = () => {
    if (opening.current || !onOriginal) return;
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
      {!passive && (
        <Box position="absolute" top={0} left={0} width={width} height={height} onClick={onClose} />
      )}
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
        onClick={(event) => event.stopImmediatePropagation()}
        opaque
        noSelect
      >
        <ThemedText bold wrap="truncate">
          {title}
        </ThemedText>
        <Box
          width={drawable ? imageWidth : cardWidth - 6}
          height={drawable ? imageHeight : 1}
          onWheel={
            passive
              ? undefined
              : (event) => {
                  event.stopImmediatePropagation();
                  panBy(
                    (event.deltaX * cellWidth) / Math.max(1, activeZoom),
                    (event.deltaY * cellHeight) / Math.max(1, activeZoom),
                  );
                }
          }
          onDragStart={
            passive
              ? undefined
              : (event) => {
                  event.stopImmediatePropagation();
                  drag.current = { x: event.startCol, y: event.startRow };
                  panBy(
                    ((event.startCol - event.col) * cellWidth) / Math.max(1, activeZoom),
                    ((event.startRow - event.row) * cellHeight) / Math.max(1, activeZoom),
                  );
                  drag.current = { x: event.col, y: event.row };
                }
          }
          onDragMove={
            passive
              ? undefined
              : (event) => {
                  event.stopImmediatePropagation();
                  if (drag.current)
                    panBy(
                      ((drag.current.x - event.col) * cellWidth) / Math.max(1, activeZoom),
                      ((drag.current.y - event.row) * cellHeight) / Math.max(1, activeZoom),
                    );
                  drag.current = { x: event.col, y: event.row };
                }
          }
          onDragEnd={
            passive
              ? undefined
              : (event) => {
                  event.stopImmediatePropagation();
                  drag.current = undefined;
                }
          }
        >
          {drawableImage ? (
            <Image
              source={source}
              presentation="preview"
              alt={t("image.preview-fallback")}
              width={imageWidth}
              height={imageHeight}
            />
          ) : (
            <ThemedText dim wrap="truncate">
              {t("image.preview-fallback")}
            </ThemedText>
          )}
        </Box>
        {!passive && (
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
        )}
        {!passive && total > 1 && height >= 6 && (
          <Box gap={2}>
            {button("‹", () => onStep?.(-1), index === 0)}
            <ThemedText>{`${index + 1}/${total}`}</ThemedText>
            {button("›", () => onStep?.(1), index === total - 1)}
          </Box>
        )}
        {!passive && (
          <Box onClick={openOriginal}>
            <ThemedText underline wrap="truncate">
              {original ?? `${t("image.open-original")}: ${imageName(image, t("image.label"))}`}
            </ThemedText>
          </Box>
        )}
        {!passive && height >= 6 && (
          <ThemedText dim wrap="truncate">
            {t("image.preview-close")}
          </ThemedText>
        )}
      </Box>
    </>
  );
}
