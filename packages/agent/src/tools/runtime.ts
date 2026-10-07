import {
  type AgentHarnessTool,
  type AgentTool,
  type ExecutionToolContext,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/pi-agent-core/harness/context";
import type { UserVisibleErrorData } from "@neant/shared";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type TSchema, type Static } from "typebox";
import { detectReadImageMimeType, validateImageBytes } from "../images/index.ts";
import { prepareFileToolPath } from "./path.ts";

/** Validate the original read bytes before pi encodes them, without a second file read. */
export function createImageReadEnv(cwd: string): NodeExecutionEnv {
  return new ImageReadEnv({ cwd });
}

/** pi's file reads return a non-exported `Result`, so the subclass stays private. */
class ImageReadEnv extends NodeExecutionEnv {
  override async readBinaryFile(...args: Parameters<NodeExecutionEnv["readBinaryFile"]>) {
    const result = await super.readBinaryFile(...args);
    if (result.ok && detectReadImageMimeType(result.value)) validateImageBytes(result.value);
    return result;
  }
}

/** pi's built-ins use the harness context; Agent uses an AbortSignal. */
export function adaptTool<T extends TSchema, D>(
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
export function preserveErrorDetails<T extends TSchema>(tool: AgentTool<T>): AgentTool<T> {
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
