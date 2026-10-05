import { createUserVisibleError, type UserVisibleErrorCode } from "@neant/shared";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { ToolStateDefinition } from "../tool-state/index.ts";

const goalSchema = Type.Object(
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

type GoalSnapshot = Static<typeof goalSchema>;
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

/** DSH goal-round-driver/src/prompt.ts; removed "read the current goal" (no get_goal tool). */
export function renderGoalRoundPrompt(goal: GoalView): string {
  return (
    "<goal_round>\n" +
    `Objective: ${JSON.stringify(goal.objective)}\n` +
    `Round: ${goal.roundsStarted + 1}/${goal.maxRounds}\n\n` +
    "Continue working toward the objective in this same session. Treat the current workspace, " +
    "tool results, and durable session state as authoritative; inspect them instead of assuming " +
    "earlier narration is still current. Make concrete progress and verify the result. Before " +
    "claiming completion, gather evidence that the whole objective is achieved, " +
    "and mark it complete. If work remains, leave the goal active for the next round. Follow " +
    "the configured goal-tool policy before reporting a blocker.\n" +
    "</goal_round>"
  );
}

/** Goal mutations serialize independently of event observers, which may call back into Session. */
export function createGoalController(options: {
  getSnapshot(): unknown;
  persist(value: GoalSnapshot | null): Promise<void>;
  changed(value: GoalSnapshot | null): void | Promise<void>;
  assertAvailable(idle: boolean): void;
  warn(): void;
  schedule(): void;
}) {
  let armed = false;
  let writes = Promise.resolve();
  const view = (): GoalView | undefined => {
    const value = options.getSnapshot();
    return Value.Check(goalSchema, value) ? { ...value, armed } : undefined;
  };
  const error = (code: Extract<UserVisibleErrorCode, `goal-${string}`>, message: string) =>
    createUserVisibleError(message, { code, params: {} });
  const change = (work: () => Promise<GoalSnapshot | null | undefined>) => {
    const operation = writes.then(work);
    writes = operation.then(
      () => {},
      () => {},
    );
    return operation.then(async (snapshot) => {
      if (snapshot !== undefined) await options.changed(snapshot);
    });
  };
  const requireGoal = () => {
    const current = view();
    if (!current) throw error("goal-missing", "No Goal exists in this Session.");
    return current;
  };
  const persist = async (snapshot: GoalSnapshot | null, nextArmed = armed) => {
    const previous = armed;
    armed = nextArmed;
    try {
      await options.persist(snapshot);
    } catch (cause) {
      armed = previous;
      throw cause;
    }
    return snapshot;
  };
  const controller = {
    view,
    disarm() {
      armed = false;
    },
    settle() {
      return writes;
    },
    async create(objective: string, { maxRounds = 256 }: { maxRounds?: number } = {}) {
      options.assertAvailable(true);
      if (!objective.trim()) throw error("goal-objective-empty", "Goal objective cannot be empty.");
      if (!Number.isSafeInteger(maxRounds) || maxRounds < 1)
        throw error("goal-rounds-invalid", "Goal maxRounds must be a positive integer.");
      await change(async () => {
        options.assertAvailable(true);
        if (view() && view()!.phase !== "complete")
          throw error("goal-exists", "An unfinished Goal already exists. Use edit or clear first.");
        return persist(
          {
            id: crypto.randomUUID(),
            objective: objective.trim(),
            phase: "active",
            roundsStarted: 0,
            maxRounds,
          },
          true,
        );
      });
      options.warn();
      const created = view()!;
      options.schedule();
      return created;
    },
    async edit(objective: string): Promise<GoalView> {
      options.assertAvailable(true);
      if (!objective.trim()) throw error("goal-objective-empty", "Goal objective cannot be empty.");
      if (requireGoal().phase === "complete") return controller.create(objective);
      await change(async () => {
        options.assertAvailable(true);
        const { armed: _armed, ...snapshot } = requireGoal();
        return persist({ ...snapshot, objective: objective.trim() });
      });
      return view()!;
    },
    async pause(): Promise<GoalView> {
      options.assertAvailable(false);
      await change(async () => {
        options.assertAvailable(false);
        const { armed: _armed, ...snapshot } = requireGoal();
        if (snapshot.phase !== "active")
          throw error("goal-pause-invalid", "Only an active Goal can be paused.");
        return persist({ ...snapshot, phase: "paused" }, false);
      });
      return view()!;
    },
    async resume(): Promise<GoalView> {
      options.assertAvailable(true);
      await change(async () => {
        options.assertAvailable(true);
        const current = requireGoal();
        if (current.phase === "complete")
          throw error("goal-complete", "A complete Goal cannot be resumed. Create a new Goal.");
        if (current.armed) throw error("goal-already-armed", "Goal continuation is already armed.");
        if (current.roundsStarted >= current.maxRounds)
          throw error(
            "goal-round-limit",
            "Goal has reached its round limit. Edit or create a new Goal.",
          );
        const { armed: _armed, blockedReason: _reason, ...snapshot } = current;
        return persist({ ...snapshot, phase: "active" }, true);
      });
      options.warn();
      const resumed = view()!;
      options.schedule();
      return resumed;
    },
    async clear(): Promise<void> {
      options.assertAvailable(false);
      await change(async () => {
        options.assertAvailable(false);
        if (view()) return persist(null, false);
      });
    },
    async startRound() {
      await change(async () => {
        const current = view();
        if (!current || current.phase !== "active" || !armed) return;
        const { armed: _armed, ...snapshot } = current;
        if (current.roundsStarted >= current.maxRounds) {
          return persist(
            {
              ...snapshot,
              phase: "blocked",
              blockedReason: `Goal reached its ${current.maxRounds} round limit. Start a new Goal to continue.`,
            },
            false,
          );
        } else {
          return persist({ ...snapshot, roundsStarted: current.roundsStarted + 1 });
        }
      });
    },
  };
  return controller;
}
