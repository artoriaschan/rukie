import { defineDoc, type InboxState } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import type { PromptImage } from "../images/index.ts";

export interface QueuedInput {
  requestId: string;
  prompt: string;
  images: PromptImage[];
}

export type PendingInputFacts = { inputs: Record<string, Record<string, JsonValue>> };
export const PendingInputFactsDoc = defineDoc<PendingInputFacts>({
  kind: "rukie.pending-input-facts",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ inputs: {} }),
});

/** Project product identity and image names over the native queue, without maintaining another queue. */
export function queuedInputProjection(
  inbox: InboxState | undefined,
  facts: PendingInputFacts | undefined,
): QueuedInput[] {
  return (inbox?.items ?? []).flatMap((item) => {
    const metadata = facts?.inputs[String(item.id)];
    if (
      item.mode === "write" ||
      typeof metadata?.requestId !== "string" ||
      !metadata.requestId.startsWith("human:")
    )
      return [];
    const content =
      typeof item.content === "string"
        ? [{ type: "text" as const, text: item.content }]
        : item.content;
    let imageIndex = 0;
    return [
      {
        requestId: metadata.requestId,
        prompt: content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(""),
        images: content.flatMap((part) => {
          if (part.type !== "image") return [];
          const name = Array.isArray(metadata.imageNames)
            ? metadata.imageNames[imageIndex++]
            : undefined;
          return [
            {
              data: part.data,
              mimeType: part.mimeType,
              ...(typeof name === "string" ? { name } : {}),
            },
          ];
        }),
      },
    ];
  });
}
