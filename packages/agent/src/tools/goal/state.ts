import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { ToolStateDefinition } from "../../tool-state/index.ts";

export const goalSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    objective: Type.String({ minLength: 1 }),
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

export const goalState: ToolStateDefinition = {
  name: "goal",
  version: 1,
  parse(version, value) {
    if (version !== 1) throw new Error(`Unsupported goal version: ${version}`);
    if (value === null) return null;
    if (
      !Value.Check(goalSchema, value) ||
      !value.objective.trim() ||
      value.roundsStarted > value.maxRounds ||
      (value.phase === "blocked" ? !value.blockedReason?.trim() : value.blockedReason !== undefined)
    )
      throw new Error("Invalid Goal snapshot.");
    return value;
  },
  renderReminder(value) {
    if (!Value.Check(goalSchema, value) || value.phase === "complete") return undefined;
    return (
      `Current Goal:\nObjective: ${JSON.stringify(value.objective)}\nPhase: ${value.phase}\nround ${value.roundsStarted}/${value.maxRounds}` +
      (value.blockedReason ? `\nBlocked reason: ${value.blockedReason}` : "")
    );
  },
};
