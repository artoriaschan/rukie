import { createWebFetchTool } from "./web-fetch.ts";
import type { WebFetchOptions } from "../web-fetch/index.ts";
import type { OnInteractionStart } from "../interaction/index.ts";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
  type AgentHarnessTool,
  type AgentTool,
  type ExecutionToolContext,
  type Skill,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/pi-agent-core/harness/context";
import type { UserVisibleErrorData } from "@neant/shared";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { prepareFileToolPath } from "./path.ts";
import { Type, type TSchema, type Static } from "typebox";
import { createGlobTool } from "./glob.ts";
import { createGrepTool } from "./grep.ts";
import { createSkillTool } from "./skill.ts";
import { createQuestionTool, type OnQuestion } from "./question.ts";
import { createTodoTool } from "./todo.ts";
import type { TodoItem } from "../tool-state/index.ts";
export { createExitPlanModeTool } from "./plan-review.ts";
export type { PlanReviewRequest, PlanReviewResult, OnPlanReview } from "./plan-review.ts";
export type { Question, QuestionRequest, QuestionReply } from "./question.ts";
export { createEnterPlanModeTool } from "./enter-plan-mode.ts";

/** pi's built-ins use the harness context; Agent uses an AbortSignal. */
function adaptTool<T extends TSchema, D>(
  tool: AgentHarnessTool<ExecutionToolContext, T, D>,
  env: NodeExecutionEnv,
  homeDir?: string,
): AgentTool<T, D> {
  return {
    ...tool,
    ...(homeDir !== undefined && {
      prepareArguments(input: unknown) {
        const prepared = tool.prepareArguments?.(input) ?? input;
        if (
          typeof prepared !== "object" ||
          prepared === null ||
          !("path" in prepared) ||
          typeof prepared.path !== "string"
        )
          return prepared as Static<T>;
        return {
          ...prepared,
          path: prepareFileToolPath(prepared.path, tool.name === "read", env.cwd, homeDir),
        } as Static<T>;
      },
    }),
    execute(id, params, signal, onUpdate) {
      return tool.execute(
        id,
        homeDir !== undefined &&
          typeof params === "object" &&
          params !== null &&
          "path" in params &&
          typeof params.path === "string"
          ? // The URL preserves the selected filename through pi's second normalization.
            ({ ...params, path: pathToFileURL(resolve(env.cwd, params.path)).href } as Static<T>)
          : params,
        onUpdate ?? (() => {}),
        { env },
        {
          invocationId: id,
          operationId: id,
          turnId: id,
          // The four built-ins do not use durable replay memos in the Agent loop.
          async getMemo() {
            return undefined;
          },
          async setMemo() {
            throw new Error("Replay memos require AgentHarness.");
          },
        },
        signal ? withAbortSignal(signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT,
      );
    },
  };
}

/** pi flattens thrown errors; keep coded details for frontend display and replay. */
function preserveErrorDetails<T extends TSchema>(tool: AgentTool<T>): AgentTool<T> {
  return {
    ...tool,
    async execute(...args) {
      try {
        return await tool.execute(...args);
      } catch (error) {
        if (error instanceof Error && "code" in error && "params" in error) {
          const { code, params } = error as Error & UserVisibleErrorData;
          return {
            isError: true,
            content: [{ type: "text", text: error.message }],
            details: { code, params },
          };
        }
        throw error;
      }
    },
  };
}

/** Read-only tools for isolated model hook checks. */
export function createReadonlyTools(cwd: string, homeDir = homedir()): AgentTool[] {
  return [
    adaptTool(createReadTool(), new NodeExecutionEnv({ cwd }), homeDir),
    createGlobTool(cwd),
    preserveErrorDetails(createGrepTool(cwd)),
  ];
}

export function createBuiltinTools(
  cwd: string,
  getSkill: (name: string) => Skill | undefined,
  setTodo: (todos: TodoItem[]) => Promise<void>,
  onQuestion?: OnQuestion,
  homeDir = homedir(),
  onInteractionStart?: OnInteractionStart,
  webFetch?: WebFetchOptions,
): AgentTool[] {
  const env = new NodeExecutionEnv({ cwd });
  const bashTool = createBashTool();
  const bash = adaptTool<typeof bashTool.parameters, unknown>(bashTool, env);
  const timedBash: typeof bash = {
    ...bash,
    description: `${bash.description} Timeout defaults to 120 seconds.`,
    parameters: {
      ...bash.parameters,
      properties: {
        ...bash.parameters.properties,
        timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 120)." })),
      },
    },
    execute: (id, params, signal, update) =>
      bash.execute(id, { ...params, timeout: params.timeout ?? 120 }, signal, update),
  };
  return [
    adaptTool(createReadTool(), env, homeDir),
    adaptTool(createWriteTool(), env, homeDir),
    adaptTool(createEditTool(), env, homeDir),
    timedBash,
    createGlobTool(cwd),
    preserveErrorDetails(createGrepTool(cwd)),
    createSkillTool(getSkill),
    createTodoTool(setTodo),
    createWebFetchTool(webFetch),
    ...(onQuestion ? [createQuestionTool(onQuestion, onInteractionStart)] : []),
  ];
}
