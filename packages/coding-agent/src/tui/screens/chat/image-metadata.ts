import { inspectImage, type PromptImage } from "@rukie/agent";
import type { PresentedImage } from "../../../view/transcript/images";

/** Decode each immutable Session/composer image once while its source is retained. */
export function createImagePresentation() {
  const images = new WeakMap<PromptImage, PresentedImage>();
  return (image: PromptImage): PresentedImage => {
    const cached = images.get(image);
    if (cached) return cached;
    const bytes = Buffer.from(image.data, "base64");
    const presented = { ...image, metadata: { ...inspectImage(bytes), bytes: bytes.length } };
    images.set(image, presented);
    return presented;
  };
}
