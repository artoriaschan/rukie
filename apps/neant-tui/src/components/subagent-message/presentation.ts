import type { ThemeColor } from "@neant/tui";
import type { SubagentView } from "./subagent-message";

/** Settled/dashboard identity; the message card keeps its own animated glyph. */
export const SUBAGENT_APPEARANCE = {
  idle: { color: "subtle", glyph: "·" },
  running: { color: "warning", glyph: "🟡" },
  completed: { color: "success", glyph: "🟢" },
  failed: { color: "error", glyph: "🔴" },
  aborted: { color: "error", glyph: "🔴" },
} satisfies Record<SubagentView["status"], { color: ThemeColor; glyph: string }>;

/** Activity stays live; settled views prefer the durable reason for this Run. */
export function subagentStatusKey(row: SubagentView) {
  return row.status === "running" || (!row.runOutcome && row.status !== "idle")
    ? (`subagent.status.${row.status}` as const)
    : (`subagent.outcome.${row.runOutcome ?? "unknown"}` as const);
}
