import type { ToolRegistration, Conversation, EntryRecord } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import {
  getCurrentTools,
  toToolDeclaration,
  type Api,
  type Model,
  type Tool,
} from "@earendil-works/pi-ai";
import { declarationsEqual } from "@earendil-works/pi-ai/utils/transcript";
import { planToolSearchLoadout, createToolSearchTool } from "../tools/tool-search/index.ts";
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

interface BaseToolsInput {
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
function createBaseTools(input: BaseToolsInput): ToolRegistration[] {
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
function createSubagentTools(input: {
  isChild: boolean;
  controller: Parameters<typeof createSubagentCapabilityTools>[0];
}): ToolRegistration[] {
  if (input.isChild) return [];
  const tools = createSubagentCapabilityTools(input.controller);
  return [tools.delegate, tools.fork, tools.send, tools.list];
}

/** Discover subagent types from the current tool names and update the controller. */
async function refreshSubagentTypes(input: {
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

const CHILD_EXCLUDED = new Set([
  "subagent",
  "subagent_fork",
  "send_message",
  "list_agents",
  "create_goal",
  "update_goal",
  "enter_plan_mode",
  "exit_plan_mode",
]);

type SharedLoadoutInput = {
  conversation(): Conversation;
  history(): Promise<readonly EntryRecord[]>;
  context: Context;
  model(): Pick<Model<Api>, "contextWindow">;
  mode?: "auto" | "on" | "off";
  mcp(): readonly ToolRegistration[];
  wrap(tools: readonly ToolRegistration[]): ToolRegistration[];
};
type RootLoadoutInput = SharedLoadoutInput & {
  kind: "root";
  base(): BaseToolsInput;
  controller: Parameters<typeof createSubagentCapabilityTools>[0];
  discovery: Omit<Parameters<typeof refreshSubagentTypes>[0], "tools" | "controller">;
  refreshSkills(): Promise<void>;
  install(
    tools: readonly ToolRegistration[],
    planned: readonly ToolRegistration[],
    context: Context,
  ): Promise<void>;
};
type ChildLoadoutInput = SharedLoadoutInput & {
  kind: "child";
  builtin(): BuiltinToolsOptions;
  allowed?: readonly string[];
};

/** Owns the current registration inventory; offered declarations are reconstructed from Transcript each time. */
export function createToolLoadout(input: RootLoadoutInput | ChildLoadoutInput) {
  let registrations: ToolRegistration[] = [];
  const allowed = (tool: ToolRegistration) =>
    input.kind === "root" ||
    (!CHILD_EXCLUDED.has(tool.name) && (!input.allowed || input.allowed.includes(tool.name)));
  async function current(context = input.context) {
    const view = await input.conversation().context(context);
    // A compaction head can lack its baseline before native preparation. Use complete branch history.
    return getCurrentTools(
      view.messages.some((message) => message.role === "system")
        ? view.messages
        : (await input.history()).flatMap((entry) => entry.model ?? []),
    );
  }
  async function refresh(reportDiscovery = false) {
    if (input.kind === "root") await input.refreshSkills();
    const base =
      input.kind === "root" ? createBaseTools(input.base()) : createBuiltinTools(input.builtin());
    const search = createToolSearchTool({
      catalog: () => input.mcp().filter(allowed),
      visibleNames: async () => (await current()).map((tool) => tool.name),
    });
    if (input.kind === "root")
      await refreshSubagentTypes({
        ...input.discovery,
        tools: [...base, ...input.mcp(), search].filter((tool) => !CHILD_EXCLUDED.has(tool.name)),
        controller: input.controller,
        report: reportDiscovery ? input.discovery.report : undefined,
      });
    registrations = input.wrap(
      [
        ...base,
        ...(input.kind === "root"
          ? createSubagentTools({ isChild: false, controller: input.controller })
          : []),
        ...input.mcp(),
        search,
      ].filter(allowed),
    );
  }
  async function plan(fresh = false, context = input.context) {
    return planToolSearchLoadout({
      tools: registrations,
      currentTools: fresh ? [] : await current(context),
      model: input.model(),
      mode: input.mode,
    });
  }
  return {
    get registrations() {
      return registrations;
    },
    refresh,
    plan,
    async rebuild(reportDiscovery = false, context = input.context) {
      await refresh(reportDiscovery);
      if (input.kind === "root")
        await input.install(registrations, (await plan(false, context)).tools, context);
    },
    hasMcpDrift() {
      const available = new Set(
        input
          .mcp()
          .filter(allowed)
          .map((tool) => tool.name),
      );
      const published = registrations
        .filter((tool) => tool.name.startsWith("mcp__"))
        .map((tool) => tool.name);
      return available.size !== published.length || published.some((name) => !available.has(name));
    },
    /** Publish late discovery after native preparation, before request messages are reconstructed. */
    async publish(context = input.context) {
      const offered = await current(context);
      const desired = (await plan(false, context)).tools.map(toToolDeclaration);
      const { toolsRemoved, toolsAdded } = planToolDeclarationChanges(offered, desired);
      if (toolsRemoved.length || toolsAdded.length)
        await input.conversation().commit(
          (tx) =>
            tx.appendEntry(input.conversation().id, {
              kind: "rukie.mcp-loadout",
              model: [
                {
                  role: "system",
                  content: "",
                  timestamp: Date.now(),
                  ...(toolsRemoved.length ? { toolsRemoved } : {}),
                  ...(toolsAdded.length ? { toolsAdded } : {}),
                },
              ],
            }),
          context,
        );
    },
  };
}

/** Match native Transcript replay: surviving declarations retain position and additions append. */
export function planToolDeclarationChanges(offered: readonly Tool[], desired: readonly Tool[]) {
  const wanted = new Map(desired.map((tool) => [tool.name, tool]));
  const kept = offered.filter((tool) => {
    const next = wanted.get(tool.name);
    return next !== undefined && declarationsEqual(tool, next);
  });
  const names = new Set(kept.map((tool) => tool.name));
  const added = desired.filter((tool) => !names.has(tool.name));
  const replace = [...kept, ...added].some((tool, index) => tool.name !== desired[index]?.name);
  const toolsRemoved = (replace ? offered : offered.filter((tool) => !names.has(tool.name))).map(
    (tool) => ({ name: tool.name }),
  );
  const toolsAdded = replace ? [...desired] : added;
  return { toolsRemoved, toolsAdded };
}
