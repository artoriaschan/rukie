import { withHookTranscript } from "../../hooks/transcript.ts";
import type { Context, JsonValue } from "@earendil-works/chord";
import type { ToolCall } from "@earendil-works/pi-ai";
import type { ToolHooks, ToolRegistration, EntryRecord } from "@earendil-works/pi-durable";
import { createPermissionGate, type createPermissionBatch } from "../../permissions/index.ts";
import { createHooks, type CommonHookResult, type HookInput } from "../../hooks/index.ts";
import { createJobs } from "../../tools/jobs/index.ts";
import { createFileTracking } from "../../file-tracking/index.ts";
import { preflightTool } from "../../tools/support/preflight.ts";

type GateOptions = Parameters<typeof createPermissionGate>[0];
type HookRuntime = ReturnType<typeof createHooks>;
type Policy = {
  permission: Omit<
    GateOptions,
    "preToolUse" | "permissionRequest" | "permissionDenied" | "isRunStopped" | "stopRun"
  >;
  hooks: HookRuntime;
  input(extra?: Record<string, unknown>): HookInput;
  apply(result: CommonHookResult, source: string, context?: Context): Promise<void>;
  batch: ReturnType<typeof createPermissionBatch>;
};

export interface ConversationRuntime {
  stopped: boolean;
  stopReason: string | undefined;
  stop(reason?: string): void;
  reset(): void;
  createHooks(input: Parameters<typeof createHooks>[0]): HookRuntime;
  createJobs(input: Parameters<typeof createJobs>[0]): ReturnType<typeof createJobs>;
  createFileTracking(
    ...args: Parameters<typeof createFileTracking>
  ): ReturnType<typeof createFileTracking>;
  hookTranscript(input: {
    path(): string;
    history(): Promise<EntryRecord[]>;
    enabled: boolean;
  }): HookRuntime;
  disposeHooks(): void;
  clearJobs(): Promise<void>;
  disposeJobs(silent?: boolean): Promise<void>;
  configurePolicy(input: Policy): ReturnType<typeof createPermissionGate>;
  wrapTools(tools: readonly ToolRegistration[]): ToolRegistration[];
  beforeTool: ToolHooks["beforeTool"];
  afterTool: ToolHooks["afterTool"];
}

/** A Conversation owns policy state and host resources; Session supplies durable admission adapters. */
export function createConversationRuntime(options: {
  origin?: { agentId: string; description: string };
  lifetime: AbortSignal;
  isClosed(): boolean;
}): ConversationRuntime {
  let stopped = false;
  let stopReason: string | undefined;
  let policy: Policy | undefined;
  let gate: ReturnType<typeof createPermissionGate> | undefined;
  let jobs: ReturnType<typeof createJobs> | undefined;
  let tracking: ReturnType<typeof createFileTracking> | undefined;
  let hooks: HookRuntime | undefined;
  let transcriptAttached = false;
  const durations = new Map<string, number>();
  const inputs = new Map<string, Record<string, unknown>>();
  const stop = (reason?: string) => {
    stopped = true;
    stopReason = reason ?? "Stopped by hook.";
  };
  function requirePolicy() {
    if (!policy || !gate) throw new Error("Conversation policy is not configured.");
    return { policy, gate };
  }
  async function runToolHook(
    event: "PreToolUse" | "PermissionRequest" | "PermissionDenied",
    call: Parameters<NonNullable<GateOptions["preToolUse"]>>[0],
    extra: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    const { policy } = requirePolicy();
    return policy.hooks.run(
      event,
      policy.input({
        tool_name: call.toolCall.name,
        tool_input: call.args,
        tool_use_id: call.toolCall.id,
        ...extra,
      }),
      { signal, matchQuery: call.toolCall.name },
    );
  }
  return {
    get stopped() {
      return stopped;
    },
    set stopped(value: boolean) {
      stopped = value;
    },
    get stopReason() {
      return stopReason;
    },
    set stopReason(value: string | undefined) {
      stopReason = value;
    },
    stop,
    reset() {
      stopped = false;
      stopReason = undefined;
    },
    createHooks(input: Parameters<typeof createHooks>[0]) {
      return (hooks ??= createHooks(input));
    },
    createJobs(input: Parameters<typeof createJobs>[0]) {
      return (jobs ??= createJobs(input));
    },
    createFileTracking(...args: Parameters<typeof createFileTracking>) {
      return (tracking ??= createFileTracking(...args));
    },
    hookTranscript(input) {
      if (!hooks) throw new Error("Conversation hooks are not configured.");
      if (!transcriptAttached) {
        hooks = withHookTranscript(
          hooks,
          input.path,
          input.history,
          input.enabled,
          () => !options.isClosed(),
        );
        transcriptAttached = true;
      }
      return hooks;
    },
    disposeHooks() {
      hooks?.dispose();
    },
    async clearJobs() {
      await jobs?.clear(true);
    },
    async disposeJobs(silent = false) {
      await jobs?.dispose(silent);
    },
    configurePolicy(input: Policy) {
      policy = input;
      gate = createPermissionGate({
        ...input.permission,
        onPermissionAsk:
          input.permission.onPermissionAsk && options.origin
            ? (request) => input.permission.onPermissionAsk!({ ...request, origin: options.origin })
            : input.permission.onPermissionAsk,
        isRunStopped: () => stopped,
        stopRun: stop,
        preToolUse: async (call, signal) => {
          const result = await runToolHook("PreToolUse", call, {}, signal);
          await input.apply(result, "hook:PreToolUse");
          return result;
        },
        permissionRequest: (call, suggestions, signal) =>
          runToolHook("PermissionRequest", call, { permission_suggestions: suggestions }, signal),
        permissionDenied: async (call, denial, signal) => {
          const result = await runToolHook(
            "PermissionDenied",
            call,
            { by: denial.by, reason: denial.reason, ...(denial.rule ? { rule: denial.rule } : {}) },
            signal,
          );
          await input.apply(result, "hook:PermissionDenied");
          return result;
        },
      });
      return gate;
    },
    wrapTools(tools: readonly ToolRegistration[]): ToolRegistration[] {
      return tools.map((tool) => ({
        ...tool,
        async execute(args, api, context) {
          const { policy, gate } = requirePolicy();
          const call: ToolCall = {
            type: "toolCall",
            id: api.callId,
            name: tool.name,
            arguments: args as Record<string, JsonValue>,
          };
          await gate.authorizeExecute(call, args as Record<string, unknown>, api, context);
          inputs.set(api.callId, args as Record<string, unknown>);
          const started = performance.now();
          try {
            return await tool.execute(args, api, context);
          } finally {
            durations.set(api.callId, performance.now() - started);
            if (context.abortSignal?.aborted && !options.isClosed()) {
              const result = await policy.hooks.run(
                "PostToolUseFailure",
                policy.input({
                  tool_name: tool.name,
                  tool_input: args,
                  tool_use_id: api.callId,
                  error: String(context.abortSignal.reason ?? "Tool interrupted"),
                  is_interrupt: true,
                  duration_ms: durations.get(api.callId),
                }),
                { signal: options.lifetime, matchQuery: tool.name },
              );
              if (!options.isClosed()) await policy.apply(result, "hook:PostToolUseFailure");
            }
          }
        },
      }));
    },
    beforeTool: (async (call, api, context) => {
      const { policy, gate } = requirePolicy();
      const decision = await policy.batch.wrap(gate.beforeTool, () =>
        stopped ? (stopReason ?? "Stopped by hook.") : undefined,
      )(call, api, context);
      if (decision?.block === undefined)
        await preflightTool(
          policy.permission.getTools().find((tool) => tool.name === call.name),
          decision?.arguments ?? call.arguments,
          api,
          context,
          call.id,
        );
      return decision;
    }) satisfies ToolHooks["beforeTool"],
    afterTool: (async (call, result, _api, context) => {
      const { policy } = requirePolicy();
      const changed = await policy.hooks.run(
        result.isError ? "PostToolUseFailure" : "PostToolUse",
        policy.input({
          tool_name: call.name,
          tool_input: inputs.get(call.id) ?? call.arguments,
          tool_response: { content: result.content, details: result.details },
          ...(result.isError
            ? {
                error: (result.content ?? [])
                  .flatMap((part) => (part.type === "text" ? [part.text] : []))
                  .join(""),
                is_interrupt: context.abortSignal?.aborted ?? false,
              }
            : {}),
          tool_use_id: call.id,
          duration_ms: durations.get(call.id) ?? 0,
        }),
        { signal: context.abortSignal, matchQuery: call.name },
      );
      await policy.apply(changed, "hook:PostToolUse", context);
      inputs.delete(call.id);
      durations.delete(call.id);
      if ("decision" in changed && changed.decision === "block" && changed.reason)
        return {
          ...result,
          content: [
            ...(result.content ?? []),
            {
              type: "text" as const,
              text: `<system-reminder>\n${changed.reason}\n</system-reminder>`,
            },
          ],
        };
      return "updatedToolOutput" in changed && changed.updatedToolOutput
        ? { ...result, content: changed.updatedToolOutput }
        : result;
    }) satisfies ToolHooks["afterTool"],
  };
}
