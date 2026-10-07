import type { PromptImage, inspectImage } from "@rukie/agent";

/** Screen-provided facts keep image decoding outside reusable components. */
export type PresentedImage = PromptImage & {
  metadata: Partial<NonNullable<ReturnType<typeof inspectImage>>> & { bytes: number };
};
