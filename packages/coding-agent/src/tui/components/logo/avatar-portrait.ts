import { readFile } from "node:fs/promises";
import { useEffect, useState } from "react";

interface Portrait {
  data: string;
  sourceWidth: number;
  sourceHeight: number;
}

let cached: Promise<Portrait | undefined> | undefined;

/** Load the bundled PNG once, only after graphics support is confirmed. */
function loadPortrait() {
  cached ??= readFile(new URL("../../../../../../brand/rukie-avatar.png", import.meta.url))
    .then((bytes): Portrait | undefined => {
      if (
        bytes.length < 24 ||
        bytes.length > 32 * 1024 * 1024 ||
        bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        bytes.subarray(12, 16).toString("ascii") !== "IHDR"
      )
        return undefined;
      const sourceWidth = bytes.readUInt32BE(16);
      const sourceHeight = bytes.readUInt32BE(20);
      if (!sourceWidth || !sourceHeight || sourceWidth * sourceHeight > 64 * 1024 * 1024)
        return undefined;
      return { data: bytes.toString("base64"), sourceWidth, sourceHeight };
    })
    .catch(() => undefined);
  return cached;
}

/** Missing assets retain character art; a late load cannot repaint an unmounted header. */
export function useAvatarPortrait(enabled: boolean) {
  const [portrait, setPortrait] = useState<Portrait>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadPortrait().then((next) => {
      if (live && next) setPortrait(next);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return enabled ? portrait : undefined;
}
