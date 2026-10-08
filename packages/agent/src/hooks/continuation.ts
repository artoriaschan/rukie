import type { Context } from "@earendil-works/chord";
import { defineDoc, type ConversationId, type Harness, type Tx } from "@earendil-works/pi-durable";

const HookContinuationDoc = defineDoc<{ taskId: number | null; count: number }>({
  kind: "rukie.hook-continuation",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ taskId: null, count: 0 }),
});

/** Stop and SubagentStop share one persisted budget per native Run anchor; callers own event routing. */
export async function stopHookContinuation(
  harness: Harness,
  conversationId: ConversationId,
  anchor: number,
  event: "Stop" | "SubagentStop",
  context: Context,
) {
  const previous = await harness.snapshot(HookContinuationDoc, conversationId, context);
  const count = previous?.taskId === anchor ? previous.count : 0;
  const warning =
    count >= 8
      ? {
          event,
          hook: "continuation",
          message: `${event} hook reached the 8 continuation limit`,
          error: { code: "hook-continuation-limit" as const, params: { event, limit: "8" } },
        }
      : undefined;
  return {
    active: count > 0,
    warning,
    async advance(tx: Tx) {
      const state = await tx.doc(HookContinuationDoc, conversationId);
      state.taskId = anchor;
      state.count = count + 1;
    },
  };
}
