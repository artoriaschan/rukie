import sharp from "sharp";
import { useEffect, useState } from "react";
import type { TerminalImageSource } from "../../ink/index.ts";

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Decode/crop the original in the application; published RGBA buffers are never mutated. */
export async function decodeTerminalImage(
  original: Uint8Array,
  presentation: "transcript" | "preview",
  crop?: ImageCrop,
): Promise<TerminalImageSource> {
  let pipeline = sharp(original, { limitInputPixels: 64 * 1024 * 1024 });
  const metadata = await pipeline.metadata();
  if (!metadata.width || !metadata.height) throw new Error("Image has no pixel dimensions");
  const width = crop?.width ?? metadata.width;
  const height = crop?.height ?? metadata.height;
  if (crop) pipeline = pipeline.extract({ left: crop.x, top: crop.y, width, height });
  const edge = presentation === "preview" ? 2048 : 1024;
  const bytes = presentation === "preview" ? 8 * 1024 * 1024 : 4 * 1024 * 1024;
  const scale = Math.min(1, edge / width, edge / height, Math.sqrt(bytes / (width * height * 4)));
  const result = await pipeline
    .resize(Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale)), {
      fit: "fill",
    })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Object.freeze({
    data: new Uint8Array(result.data),
    width: result.info.width,
    height: result.info.height,
  });
}

/** Only current mounted demand may publish a decoded snapshot; closing releases component ownership. */
export function useImageSource(
  data: string,
  enabled: boolean,
  presentation: "transcript" | "preview",
  crop?: ImageCrop,
) {
  const key = `${presentation}:${crop?.x ?? 0}:${crop?.y ?? 0}:${crop?.width ?? 0}:${crop?.height ?? 0}`;
  const [snapshot, setSnapshot] = useState<{
    data: string;
    key: string;
    source: TerminalImageSource;
  }>();
  useEffect(() => {
    if (!enabled) {
      setSnapshot(undefined);
      return;
    }
    let live = true;
    void decodeTerminalImage(Buffer.from(data, "base64"), presentation, crop).then(
      (source) => {
        if (live) setSnapshot({ data, key, source });
      },
      () => {
        if (live) setSnapshot(undefined);
      },
    );
    return () => {
      live = false;
    };
  }, [data, enabled, key]);
  return enabled && snapshot?.data === data && snapshot.key === key ? snapshot.source : undefined;
}
