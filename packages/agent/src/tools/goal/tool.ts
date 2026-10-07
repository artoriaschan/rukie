import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PresentedTool } from "../presentation.ts";
import { Value } from "typebox/value";
import { createUserVisibleError } from "@neant/shared";
import { Type } from "typebox";
import { preserveErrorDetails } from "../runtime.ts";
import { renderWrapupContext, type createGoalController } from "./controller.ts";

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

/** The Goal controller operations the model tools may call; Session supplies its lazy facade. */
export type GoalToolController = Pick<
  ReturnType<typeof createGoalController>,
  "view" | "create" | "edit" | "pause" | "resume" | "finish"
>;

/** Run-scoped authorization facts a Goal mutation reads before it changes state. */
export type GoalToolExecution = {
  directHuman(): boolean;
  goalRound(): boolean;
  wrapup(text: string): void;
};

/** Model controls share the controller's serialized mutations but operate inside the current Run. */
export function createGoalTools(
  goal: GoalToolController,
  execution: GoalToolExecution,
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
  const create: PresentedTool<typeof createParameters> = {
    name: "create_goal",
    label: "Create Goal",
    description:
      "Create a persisted Goal that keeps this Session working across automatic continuation rounds. Use it when the direct human request is a long-running objective, even if the user did not say goal; not for single-turn work. " +
      guidance,
    parameters: createParameters,
    presentCall: (args) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.create_goal",
      title: args.objective,
    }),
    presentResult: (_args, text, details) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.create_goal",
      text: goalSummary(details) ?? text,
    }),
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      requireHuman();
      await goal.create(args.objective, { maxRounds: args.max_goal_rounds }, false);
      return result();
    },
  };
  const update: PresentedTool<typeof updateParameters> = {
    name: "update_goal",
    label: "Update Goal",
    description:
      "Update the current Goal. complete and blocked are also allowed during its automatic continuation round. " +
      guidance,
    parameters: updateParameters,
    presentCall: (args) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.update_goal",
      title: args.action,
    }),
    presentResult: (_args, text, details) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.update_goal",
      text: goalSummary(details) ?? text,
    }),
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

const summaryFacts = Type.Object({ goal: Type.Object({ objective: Type.String() }) });
function goalSummary(details: unknown): string | undefined {
  return Value.Check(summaryFacts, details) ? details.goal.objective : undefined;
}
