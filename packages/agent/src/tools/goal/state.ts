import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { defineToolState, type ToolStateDefinition } from "../../tool-state/index.ts";

export const goalCompletionAudit =
  "Audit completion requirement by requirement and link each requirement to concrete evidence. Tests passing or a finished plan alone do not establish completion. If any requirement is uncertain, the Goal is not complete.";

export const goalSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    objective: Type.String(),
    attachments: Type.Integer({ minimum: 0 }),
    elapsedMs: Type.Number({ minimum: 0 }),
    activeSince: Type.Optional(Type.Number({ minimum: 0 })),
    phase: Type.Union([
      Type.Literal("active"),
      Type.Literal("paused"),
      Type.Literal("blocked"),
      Type.Literal("complete"),
    ]),
    roundsStarted: Type.Integer({ minimum: 0 }),
    maxRounds: Type.Integer({ minimum: 1 }),
    blockedReason: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type GoalSnapshot = Static<typeof goalSchema>;
export interface GoalView extends GoalSnapshot {
  armed: boolean;
}

export const goalState: ToolStateDefinition = defineToolState({
  history: "rewindable",
  fork: "asOf",
  name: "goal",
  version: 2,
  parse(version, value) {
    if (version !== 2) throw new Error(`Unsupported goal version: ${version}`);
    if (value === null) return null;
    if (
      !Value.Check(goalSchema, value) ||
      (!value.objective.trim() && value.attachments === 0) ||
      (value.activeSince !== undefined && value.phase !== "active") ||
      value.roundsStarted > value.maxRounds ||
      (value.phase === "blocked" ? !value.blockedReason?.trim() : value.blockedReason !== undefined)
    )
      throw new Error("Invalid Goal snapshot.");
    return value;
  },
  renderReminder(value) {
    if (!Value.Check(goalSchema, value) || value.phase === "complete") return undefined;
    return (
      `Current Goal:\n${renderGoalObjective(value)}\nPhase: ${value.phase}\nround ${value.roundsStarted}/${value.maxRounds}` +
      (value.blockedReason ? `\nBlocked reason: ${value.blockedReason}` : "") +
      `\n${goalCompletionAudit}`
    );
  },
});

/** Image bytes belong to the first human Goal message, never to Tool State. */
export function renderGoalObjective(goal: Pick<GoalSnapshot, "objective" | "attachments">): string {
  return goal.objective
    ? `Objective: ${JSON.stringify(goal.objective)}`
    : `Objective: Follow the target in the first Goal message's attachments (${goal.attachments} images).`;
}

/** Settle an active wall-clock segment; continuing work starts a fresh segment at this boundary. */
export function settleGoalTime(goal: GoalSnapshot, now: number, armed: boolean): GoalSnapshot {
  const { activeSince, ...snapshot } = goal;
  return {
    ...snapshot,
    elapsedMs: goal.elapsedMs + (activeSince === undefined ? 0 : Math.max(0, now - activeSince)),
    ...(armed ? { activeSince: now } : {}),
  };
}
