import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
  type AgentHarnessTool,
  type AgentTool,
  type ExecutionToolContext,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/pi-agent-core/harness/context";
import { Type, type TSchema } from "typebox";
import { createGlobTool } from "./glob.ts";
import { createGrepTool } from "./grep.ts";

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

export function createBuiltinTools(cwd: string): AgentTool[] {
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
    createGrepTool(cwd),
  ];
}
