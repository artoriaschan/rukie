import type { Context } from "@earendil-works/chord";
import type { Storage, ConversationId, EntryRecord, Cursor } from "@earendil-works/pi-durable";

/** Fork-aware chronological Transcript, including entries before compaction. */
export async function readTranscript(
  storage: Storage,
  conversationId: ConversationId,
  context: Context,
) {
  const entries: EntryRecord[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await storage.scanEntries({ conversationId }, 256, cursor, context);
    entries.push(...page.items);
    cursor = page.next;
  } while (cursor);
  return entries.reverse();
}

export const readRunSummaries = (entries: readonly EntryRecord[]) =>
  entries.flatMap((entry) => {
    const value = entry.data;
    return entry.kind === "rukie.run-summary" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.afterMessage === "number" &&
      typeof value.durationMs === "number" &&
      typeof value.endedAt === "number" &&
      typeof value.success === "boolean"
      ? [
          {
            afterMessage: value.afterMessage,
            durationMs: value.durationMs,
            endedAt: value.endedAt,
            success: value.success,
          },
        ]
      : [];
  });
