import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { OnInteractionStart } from "../interaction/index.ts";
import { createBuiltinTools, type BuiltinToolsOptions } from "../tools/builtin.ts";
import {
  createGoalTools,
  type GoalToolController,
  type GoalToolExecution,
} from "../tools/goal/index.ts";
import {
  createEnterPlanModeTool,
  createExitPlanModeTool,
  type OnPlanReview,
  type PlanModeController,
} from "../tools/plan-mode/index.ts";
import {
  createSubagentTools as createSubagentCapabilityTools,
  discoverSubagentTypes,
} from "../tools/subagents/index.ts";

export interface BaseToolsInput {
  /** Child Sessions share Plan Mode but expose neither Plan Mode nor Goal tools. */
  isChild: boolean;
  builtin: BuiltinToolsOptions;
  planMode: {
    controller: PlanModeController;
    /** Without a review callback the Plan Mode tools stay hidden. */
    onPlanReview?: OnPlanReview;
    onInteractionStart?: OnInteractionStart;
  };
  goal: {
    /** Tool assembly receives the Goal controller through a lazy facade. */
    controller: GoalToolController;
    execution: GoalToolExecution;
  };
}

/** Built-in, Plan Mode and Goal tools, in the model-visible declaration order. */
export function createBaseTools(input: BaseToolsInput): ToolRegistration[] {
  return [
    ...createBuiltinTools(input.builtin),
    ...(input.isChild ? [] : createPlanModeTools(input.planMode)),
    ...(input.isChild ? [] : createGoalTools(input.goal.controller, input.goal.execution)),
  ];
}

function createPlanModeTools(input: BaseToolsInput["planMode"]): ToolRegistration[] {
  if (!input.onPlanReview) return [];
  return [
    createEnterPlanModeTool(input.controller),
    createExitPlanModeTool(input.controller, input.onPlanReview, input.onInteractionStart),
  ];
}

/** The four Subagent tools; child Sessions cannot delegate. */
export function createSubagentTools(input: {
  isChild: boolean;
  controller: Parameters<typeof createSubagentCapabilityTools>[0];
}): ToolRegistration[] {
  if (input.isChild) return [];
  const tools = createSubagentCapabilityTools(input.controller);
  return [tools.delegate, tools.fork, tools.send, tools.list];
}

/** Discover subagent types from the current tool names and update the controller. */
export async function refreshSubagentTypes(input: {
  cwd: string;
  homeDir: string;
  trusted: boolean;
  tools: readonly ToolRegistration[];
  controller: Parameters<typeof createSubagentCapabilityTools>[0];
  /** The startup seed passes nothing; a Run refresh reports diagnostics once per Run. */
  report?(discovery: Awaited<ReturnType<typeof discoverSubagentTypes>>): void | Promise<void>;
}): Promise<void> {
  const discovered = await discoverSubagentTypes(
    input.cwd,
    input.homeDir,
    input.tools.map((tool) => tool.name),
    { trusted: input.trusted },
  );
  input.controller.setTypes(discovered.types);
  await input.report?.(discovered);
}
