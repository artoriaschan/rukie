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
import { Type, type TSchema } from "typebox";
import { createGlobTool } from "./glob.ts";
import { createGrepTool } from "./grep.ts";
import { createSkillTool } from "./skill.ts";

/** pi's built-ins use the harness context; Agent uses an AbortSignal. */
function adaptTool<T extends TSchema, D>(
  tool: AgentHarnessTool<ExecutionToolContext, T, D>,
  env: NodeExecutionEnv,
): AgentTool<T, D> {
  return {
    ...tool,
    execute(id, params, signal, onUpdate) {
      return tool.execute(
        id,
        params,
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

export function createBuiltinTools(
  cwd: string,
  getSkill: (name: string) => Skill | undefined,
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
    adaptTool(createReadTool(), env),
    adaptTool(createWriteTool(), env),
    adaptTool(createEditTool(), env),
    timedBash,
    createGlobTool(cwd),
    preserveErrorDetails(createGrepTool(cwd)),
    createSkillTool(getSkill),
  ];
}
