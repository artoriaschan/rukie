import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import { normalizeContext, type Api, type Model } from "@earendil-works/pi-ai";
import { createUserVisibleError, type HookHandler, type HookEvent } from "@neant/shared";

import { createReadonlyTools } from "../tools/builtin.ts";
import { executeBounded } from "./bounded.ts";

type ModelHook = Extract<HookHandler, { type: "prompt" | "agent" }>;
export interface HookModelDependencies {
  getModel(selected?: string): Promise<Model<Api>>;
  streamFn: StreamFn;
}

const POLICY =
  'Evaluate the configured hook rule against the supplied input. Return exactly one JSON object, no prose or Markdown: {"ok":boolean,"reason"?:string}.';

/** Isolated review requests never enter the owning Session's messages or transcript. */
export async function executeModelHook(
  handler: ModelHook,
  input: Record<string, unknown>,
  options: {
    event: HookEvent;
    signal: AbortSignal;
    model: HookModelDependencies;
    cwd: string;
    homeDir?: string;
  },
) {
  const timeout = handler.timeout ?? (handler.type === "agent" ? 60 : 30);
  return executeBounded(
    async (signal) => {
      try {
        signal.throwIfAborted();
        const model = await options.model.getModel(handler.model);
        signal.throwIfAborted();
        const text = handler.prompt.replaceAll("$ARGUMENTS", () => JSON.stringify(input));
        const run = async () => {
          if (handler.type === "prompt") {
            return (
              await options.model.streamFn(
                model,
                normalizeContext({
                  systemPrompt: POLICY,
                  messages: [
                    { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
                  ],
                }),
                { temperature: 0, signal },
              )
            ).result();
          }
          const agent = new Agent({
            streamFn: options.model.streamFn,
            initialState: {
              model,
              systemPrompt: POLICY,
              tools: createReadonlyTools(options.cwd, options.homeDir),
              messages: [],
            },
          });
          const abortAgent = () => agent.abort();
          signal.addEventListener("abort", abortAgent, { once: true });
          try {
            signal.throwIfAborted();
            await agent.prompt(text);
            const response = agent.state.messages.at(-1);
            if (response?.role !== "assistant")
              throw new Error("Model hook produced no assistant result");
            return response;
          } finally {
            signal.removeEventListener("abort", abortAgent);
          }
        };
        const response = await run();
        signal.throwIfAborted();
        if (response.stopReason !== "stop")
          throw new Error(`Model hook stopped: ${response.stopReason}`);
        const blocks = response.content.filter((block) => block.type !== "thinking");
        if (blocks.length !== 1 || blocks[0]?.type !== "text")
          throw new Error("Expected one JSON text block");
        let value: unknown;
        try {
          value = JSON.parse(blocks[0].text);
        } catch {
          throw new Error("Expected JSON model hook output");
        }
        if (typeof value !== "object" || value === null || Array.isArray(value))
          throw new Error("Expected a model hook result object");
        const result = value as Record<string, unknown>;
        if (
          typeof result.ok !== "boolean" ||
          (result.reason !== undefined && typeof result.reason !== "string")
        )
          throw new Error("Expected { ok: boolean, reason?: string }");
        const reason =
          typeof result.reason === "string" ? result.reason : "Model hook rejected the action";
        const output = result.ok
          ? {}
          : options.event === "PreToolUse"
            ? {
                hookSpecificOutput: {
                  permissionDecision: "deny",
                  permissionDecisionReason: reason,
                },
              }
            : options.event === "PermissionRequest"
              ? {
                  hookSpecificOutput: { decision: { behavior: "deny", message: reason } },
                }
              : ["UserPromptSubmit", "Stop", "SubagentStop", "PreCompact", "PostToolUse"].includes(
                    options.event,
                  )
                ? { decision: "block", reason }
                : {};
        return { stdout: JSON.stringify(output), stderr: "", exitCode: 0 };
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        throw createUserVisibleError(
          `Model hook failed: ${error instanceof Error ? error.message : String(error)}`,
          {
            code: "hook-model-failed",
            params: { cause: error instanceof Error ? error.message : String(error) },
          },
        );
      }
    },
    options.signal,
    timeout,
  );
}
