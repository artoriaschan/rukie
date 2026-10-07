import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Branch, Entry } from "@earendil-works/pi-agent-core/harness/session";

/** Repair persisted calls on Resume or after a failed message save, without executing tools. */
export async function repairUnknownToolOutcomes(
  branch: Branch,
  entries: Entry[],
  context: Context,
): Promise<Entry[]> {
  // Compaction changes model context, but its prefix remains part of this
  // Transcript branch. Repair persisted calls there without reviving them.
  const messages = entries.flatMap((entry) =>
    entry.type === "message"
      ? [entry.message]
      : entry.type === "compaction"
        ? entry.retainedTail
        : [],
  );
  const results = new Set(
    messages.flatMap((message) => (message.role === "toolResult" ? [message.toolCallId] : [])),
  );
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const call of message.content) {
      if (call.type !== "toolCall" || results.has(call.id)) continue;
      await branch.appendMessage(
        {
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [
            {
              type: "text",
              text: "Tool outcome unknown: this call was saved, but no result was saved before Session reconciliation. This recovery placeholder is not a real Tool result and does not establish success, failure, or that the tool was not executed. It does not establish the absence of side effects. Verify the actual state before deciding whether to retry; the recovery process has not replayed the call.",
            },
          ],
          // Unknown is neither an execution error nor confirmed success.
          isError: false,
          details: { recovery: { type: "unknown-tool-outcome", version: 1 } },
          timestamp: Date.now(),
        },
        context,
      );
      results.add(call.id);
    }
  }
  return await branch.findEntries({ order: "oldestFirst" }, context);
}
