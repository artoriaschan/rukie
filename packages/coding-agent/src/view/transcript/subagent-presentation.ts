import type { SubagentView } from "../conversation/subagents";

/** Settled/dashboard identity; the message card keeps its own animated glyph. */
export const SUBAGENT_APPEARANCE = {
  idle: { color: "subtle", glyph: "·" },
  running: { color: "warning", glyph: "🟡" },
  completed: { color: "success", glyph: "🟢" },
  failed: { color: "error", glyph: "🔴" },
  aborted: { color: "error", glyph: "🔴" },
} as const satisfies Record<SubagentView["status"], { color: string; glyph: string }>;

/** Activity stays live; settled views prefer the durable reason for this Run. */
export function subagentStatusKey(row: SubagentView) {
  return row.status === "running" || (!row.runOutcome && row.status !== "idle")
    ? (`subagent.status.${row.status}` as const)
    : (`subagent.outcome.${row.runOutcome ?? "unknown"}` as const);
}

/** Missing historical metrics remain absent; only actual active Runs tick. */
export function subagentElapsed(row: SubagentView) {
  return row.status === "running" && row.startedAt !== undefined
    ? Math.max(0, Date.now() - row.startedAt)
    : row.durationMs;
}

export function subagentAppearance(row: SubagentView) {
  if (row.status === "running" || !row.runOutcome) return SUBAGENT_APPEARANCE[row.status];
  if (row.runOutcome === "completed") return SUBAGENT_APPEARANCE.completed;
  if (row.runOutcome === "error" || row.runOutcome === "aborted") return SUBAGENT_APPEARANCE.failed;
  return {
    color: row.runOutcome === "unknown" || row.runOutcome === "interrupted" ? "subtle" : "warning",
    glyph: row.runOutcome === "unknown" || row.runOutcome === "interrupted" ? "⚪" : "🟡",
  } as const;
}
