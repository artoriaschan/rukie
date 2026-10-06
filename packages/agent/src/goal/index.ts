import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createUserVisibleError, type UserVisibleErrorCode } from "@neant/shared";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { preserveErrorDetails } from "../tools/runtime.ts";
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
      options.schedule();
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

/** Guidance adapted from DSH tool-goal: no get_goal, revision/CAS or blocked-round threshold. */
const guidance =
  "create_goal may infer goal intent from a direct human request in any language. " +
  "After Session Resume or fork, an active Goal is disarmed: when a human asks to continue " +
  "or resume in any wording or language, use update_goal action resume to rearm it. " +
  "Create, edit, pause and resume require direct human input in the current Run. " +
  "The model cannot resume a paused Goal; the user must resume it. " +
  "Mark complete only when the objective is actually achieved and verified. Mark blocked only " +
  "when a concrete condition prevents progress, and report that condition in blocked_reason; " +
  "difficulty, uncertainty, or useful remaining work is not blocked.";

const createParameters = Type.Object(
  {
    objective: Type.String({ minLength: 1 }),
    max_goal_rounds: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
const updateParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("edit"),
      Type.Literal("pause"),
      Type.Literal("resume"),
      Type.Literal("complete"),
      Type.Literal("blocked"),
    ]),
    objective: Type.Optional(Type.String()),
    blocked_reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

function argumentError(
  code: "goal-tool-invalid-argument" | "goal-tool-required-argument",
  field: string,
  action: string,
) {
  return createUserVisibleError(
    `${field} ${code === "goal-tool-invalid-argument" ? "is valid only" : "is required"} with action ${action}.`,
    { code, params: { field, action } },
  );
}

/** Model controls share the controller's serialized mutations but operate inside the current Run. */
export function createGoalTools(
  goal: Pick<
    ReturnType<typeof createGoalController>,
    "view" | "create" | "edit" | "pause" | "resume" | "finish"
  >,
  execution: { directHuman(): boolean; goalRound(): boolean; wrapup(text: string): void },
): AgentTool[] {
  const requireHuman = () => {
    if (!execution.directHuman())
      throw createUserVisibleError("Goal control requires direct human input in the current Run.", {
        code: "goal-tool-human-required",
        params: {},
      });
  };
  const result = () => {
    const current = goal.view();
    const value = {
      goal: current
        ? {
            objective: current.objective,
            phase: current.phase,
            roundsStarted: current.roundsStarted,
            maxRounds: current.maxRounds,
            ...(current.blockedReason !== undefined && { blockedReason: current.blockedReason }),
          }
        : null,
      armed: current?.armed ?? false,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value };
  };
  const create: AgentTool<typeof createParameters> = {
    name: "create_goal",
    label: "Create Goal",
    description:
      "Create a persisted Goal that keeps this Session working across automatic continuation rounds. Use it when the direct human request is a long-running objective, even if the user did not say goal; not for single-turn work. " +
      guidance,
    parameters: createParameters,
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      requireHuman();
      await goal.create(args.objective, { maxRounds: args.max_goal_rounds }, false);
      return result();
    },
  };
  const update: AgentTool<typeof updateParameters> = {
    name: "update_goal",
    label: "Update Goal",
    description:
      "Update the current Goal. complete and blocked are also allowed during its automatic continuation round. " +
      guidance,
    parameters: updateParameters,
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      if (args.action === "edit" || args.action === "pause" || args.action === "resume")
        requireHuman();
      else if (!execution.directHuman() && !execution.goalRound())
        throw createUserVisibleError(
          "Goal completion requires direct human input or the current Goal round.",
          { code: "goal-tool-completion-authority", params: {} },
        );
      if (args.objective !== undefined && args.action !== "edit")
        throw argumentError("goal-tool-invalid-argument", "objective", "edit");
      if (args.blocked_reason !== undefined && args.action !== "blocked")
        throw argumentError("goal-tool-invalid-argument", "blocked_reason", "blocked");
      if (args.action === "edit") {
        if (!args.objective?.trim())
          throw argumentError("goal-tool-required-argument", "objective", "edit");
        await goal.edit(args.objective, false);
      } else if (args.action === "pause") await goal.pause();
      else if (args.action === "resume") {
        await goal.resume(false, false);
      } else {
        if (args.action === "blocked" && !args.blocked_reason?.trim())
          throw argumentError("goal-tool-required-argument", "blocked_reason", "blocked");
        const finished = await goal.finish(args.action, args.blocked_reason?.trim());
        if (execution.goalRound())
          execution.wrapup(renderWrapupContext(finished.objective, finished.blockedReason));
      }
      return result();
    },
  };
  return [preserveErrorDetails(create), preserveErrorDetails(update)];
}

/** DSH tool-goal/src/wrapup.ts verbatim text; Neant uses one text user message with source goal. */
function renderWrapupContext(objective: string, blockedReason?: string): string {
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
