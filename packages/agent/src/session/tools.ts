import type { AgentTool } from "@earendil-works/pi-agent-core";
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

/**
 * Per-Session selection of model tools. Session owns the identity, tool-name and inherited
 * MCP facts; the assembly applies them without keeping a second copy of that state.
 */
export interface ToolGate {
  allowsTool(tool: AgentTool): boolean;
  measureTool(tool: AgentTool): AgentTool;
}

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
    /** The Goal controller is created after the Agent, so callers pass its lazy facade. */
    controller: GoalToolController;
    execution: GoalToolExecution;
  };
}

/** Built-in, Plan Mode and Goal tools, in the model-visible declaration order. */
export function createBaseTools(input: BaseToolsInput): AgentTool[] {
  return [
    ...createBuiltinTools(input.builtin),
    ...(input.isChild ? [] : createPlanModeTools(input.planMode)),
    ...(input.isChild ? [] : createGoalTools(input.goal.controller, input.goal.execution)),
  ];
}

function createPlanModeTools(input: BaseToolsInput["planMode"]): AgentTool[] {
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
}): AgentTool[] {
  if (input.isChild) return [];
  const tools = createSubagentCapabilityTools(input.controller);
  return [tools.delegate, tools.fork, tools.send, tools.list];
}

/** Discover subagent types from the current tool names and update the controller. */
export async function refreshSubagentTypes(input: {
  cwd: string;
  homeDir: string;
  trusted: boolean;
  tools: readonly AgentTool[];
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

/** Apply the Session gate to a tool set, then wrap each tool for duration measurement. */
export function selectTools(tools: readonly AgentTool[], gate: ToolGate): AgentTool[] {
  return tools.filter((tool) => gate.allowsTool(tool)).map((tool) => gate.measureTool(tool));
}

/** A Turn starts from the Run's non-MCP tools and appends the MCP tools current at that Turn. */
export function createTurnTools(input: {
  nonMcpTools: readonly AgentTool[];
  mcpTools: readonly AgentTool[];
  gate: ToolGate;
}): AgentTool[] {
  return [
    ...input.nonMcpTools,
    ...input.mcpTools
      .filter((tool) => input.gate.allowsTool(tool))
      .map((tool) => input.gate.measureTool(tool)),
  ];
}
