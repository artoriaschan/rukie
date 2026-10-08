import { createUserVisibleError, type UserVisibleErrorCode } from "@rukie/shared";
import { Value } from "typebox/value";
import { goalSchema, type GoalSnapshot, type GoalView } from "./state.ts";

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
  isArmed(): boolean;
  getSnapshot(): unknown;
  persist(value: GoalSnapshot | null, armed: boolean): Promise<void>;
  assertAvailable(idle: boolean): void;
  warn(): void;
}) {
  let writes = Promise.resolve();
  const view = (): GoalView | undefined => {
    const value = options.getSnapshot();
    return Value.Check(goalSchema, value) ? { ...value, armed: options.isArmed() } : undefined;
  };
  const error = (
    code: Exclude<Extract<UserVisibleErrorCode, `goal-${string}`>, `goal-tool-${string}`>,
    message: string,
  ) => createUserVisibleError(message, { code, params: {} });
  const change = (work: () => Promise<GoalSnapshot | null | undefined>) => {
    const operation = writes.then(work);
    writes = operation.then(
      () => {},
      () => {},
    );
    return operation.then(() => undefined);
  };
  const requireGoal = () => {
    const current = view();
    if (!current) throw error("goal-missing", "No Goal exists in this Session.");
    return current;
  };
  const persist = async (snapshot: GoalSnapshot | null, nextArmed = options.isArmed()) => {
    await options.persist(snapshot, nextArmed);
    return snapshot;
  };
  const controller = {
    view,
    settle() {
      return writes;
    },
    async create(objective: string, { maxRounds = 256 }: { maxRounds?: number } = {}, idle = true) {
      options.assertAvailable(idle);
      if (!objective.trim()) throw error("goal-objective-empty", "Goal objective cannot be empty.");
      if (!Number.isSafeInteger(maxRounds) || maxRounds < 1)
        throw error("goal-rounds-invalid", "Goal maxRounds must be a positive integer.");
      await change(async () => {
        options.assertAvailable(idle);
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
      return created;
    },
    async edit(objective: string, idle = true): Promise<GoalView> {
      options.assertAvailable(idle);
      if (!objective.trim()) throw error("goal-objective-empty", "Goal objective cannot be empty.");
      if (requireGoal().phase === "complete") return controller.create(objective, {}, idle);
      await change(async () => {
        options.assertAvailable(idle);
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
    async resume(idle = true, allowPaused = true): Promise<GoalView> {
      options.assertAvailable(idle);
      await change(async () => {
        options.assertAvailable(idle);
        const current = requireGoal();
        if (!allowPaused && current.phase === "paused")
          throw createUserVisibleError(
            "The model cannot resume a paused Goal; the user must resume it.",
            { code: "goal-tool-resume-paused", params: {} },
          );
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
      return resumed;
    },
    async clear(): Promise<void> {
      options.assertAvailable(false);
      await change(async () => {
        options.assertAvailable(false);
        if (view()) return persist(null, false);
      });
    },
    async finish(phase: "complete" | "blocked", blockedReason?: string): Promise<GoalView> {
      options.assertAvailable(false);
      await change(async () => {
        options.assertAvailable(false);
        const { armed: _armed, blockedReason: _reason, ...snapshot } = requireGoal();
        return persist(
          { ...snapshot, phase, ...(phase === "blocked" && { blockedReason }) },
          false,
        );
      });
      return view()!;
    },
  };
  return controller;
}

/** DSH tool-goal/src/wrapup.ts verbatim text; Rukie uses one text user message with source goal. */
export function renderWrapupContext(objective: string, blockedReason?: string): string {
  const heading = `Objective: ${JSON.stringify(objective)}\n`;
  const grounding =
    "Report only what earlier rounds and tool results in this session actually establish; " +
    "when a detail is not in the session, say so instead of inventing it. ";
  return blockedReason === undefined
    ? "<goal_complete>\n" +
        heading +
        "The goal is marked complete and this autonomous run is ending. Write the closing " +
        "message to the user now: state the outcome, summarize what was done and how it was " +
        "verified, and point to the concrete results (files, commits, or other artifacts). " +
        grounding +
        "Note anything the user should review or do next. Address the user directly. Do not " +
        "call any more tools in this run; further work waits for the user's next instruction.\n" +
        "</goal_complete>"
    : "<goal_blocked>\n" +
        heading +
        `Blocked: ${JSON.stringify(blockedReason)}\n` +
        "The goal is marked blocked and this autonomous run is ending. Write the closing " +
        "message to the user now: state what has been completed so far, describe the concrete " +
        "blocking condition and what you tried, and say exactly what you need from the user to " +
        "continue. " +
        grounding +
        "Address the user directly. Do not call any more tools in this run; further work " +
        "waits for the user's next instruction.\n" +
        "</goal_blocked>";
}
