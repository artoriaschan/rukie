import type { createConversation } from "./conversation";

type State = ReturnType<ReturnType<typeof createConversation>["getSnapshot"]>;
/** A continuation replaces the prior dedicated Subagent row; anchors retain original indices. */
export function completedEntryVisible(state: State, index: number): boolean {
  const entry = state.completed[index];
  return (
    entry?.type !== "subagent" ||
    (!!state.subagents[entry.agentId] &&
      state.completed.findLastIndex(
        (candidate) => candidate.type === "subagent" && candidate.agentId === entry.agentId,
      ) === index)
  );
}
