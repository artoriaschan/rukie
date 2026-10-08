import type { Context } from "@earendil-works/chord";
import type {
  HookApi,
  ToolExecutionApi,
  ToolRegistration,
  ToolHooks,
  JsonObject,
} from "@earendil-works/pi-durable";
import {
  type Api,
  type Model,
  type ToolCall,
  type Message,
  type Models,
} from "@earendil-works/pi-ai";
import { presentCall } from "../tools/presentation.ts";
import type { CustomSessionEvent, PermissionMode, ToolCallView } from "@rukie/shared";
import { evaluatePermissionRules, parsePermissionRules, type PermissionRule } from "./rules.ts";
export { parsePermissionRules, evaluatePermissionRules } from "./rules.ts";
export { resolvePermissionPath } from "./path.ts";
import { sessionAllowRule, type SessionAllow, type SessionAllowRule } from "./session-rules.ts";
export type { SessionAllowRule } from "./session-rules.ts";
import {
  requestInteraction,
  createInteractionIdentity,
  type InteractionIdentity,
  type OnInteractionStart,
} from "../interaction/index.ts";
import { reviewPermission, type ReviewResult } from "./review.ts";
import type {
  PreToolUseResult,
  PermissionRequestResult,
  PermissionDeniedResult,
} from "../hooks/index.ts";
import { Value } from "typebox/value";

export interface PermissionAskRequest {
  identity: InteractionIdentity;
  toolCallId: string;
  toolName: string;
  /** Validated arguments for this tool call. */
  args: unknown;
  /** Owner-defined call presentation is available before execution starts. */
  callView?: ToolCallView;
  /** Mode captured when this call entered the permission gate. */
  mode: PermissionMode;
  reason?: string;
  sessionAllow: SessionAllow;
  origin?: { agentId: string; description: string };
  /** Aborted when cancelled or covered by a new session rule; dismiss the pending question. */
  signal: AbortSignal;
}

/** Internal read-only stage after authorization and before tool execution. */
export type OnToolCallAllowed = (call: {
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
}) => void | Promise<void>;

type PermissionDecision = "allow" | "deny" | "ask";

interface PermissionOptions {
  mode: PermissionMode;
  toolName: string;
}

/** Pure policy; frontends decide how to handle `ask`. */
function decidePermission({ mode, toolName }: PermissionOptions): PermissionDecision | "review" {
  if (
    mode === "full-access" ||
    [
      "ToolSearch",
      "read",
      "glob",
      "grep",
      "skill",
      "ask_user_question",
      "exit_plan_mode",
      "todo_write",
      "create_goal",
      "update_goal",
      "subagent",
      "subagent_fork",
      "send_message",
      "list_agents",
      "job_output",
      "job_list",
      "job_kill",
    ].includes(toolName)
  )
    return "allow";
  if (toolName === "enter_plan_mode") return "ask";
  return mode === "auto-review" ? "review" : "ask";
}

type PermissionStageDecision =
  | { decision: "allow" }
  | {
      decision: "deny";
      reason: string;
      by: "rule" | "user" | "review" | "hook";
      rule?: string;
      hook?: string;
      terminate?: true;
    }
  | {
      decision: "ask";
      reason?: string;
      by?: "rule" | "review" | "hook";
      rule?: string;
      hook?: string;
    };

interface PermissionGateOptions {
  cwd: string;
  homeDir: string;
  rules: readonly PermissionRule[];
  sessionAllowRules?: SessionAllowRule[];
  sessionGrantListeners?: Set<() => void>;
  getMode(): PermissionMode;
  getTools(): readonly ToolRegistration[];
  getMessages(): Promise<readonly Message[]>;
  getProjectInstructions(): string[];
  getReviewModel(): Model<Api> | (() => Promise<Model<Api>>);
  models: Models;
  onPermissionAsk?: (request: PermissionAskRequest) => Promise<"allow" | "deny" | "allow-session">;
  onToolCallAllowed?: OnToolCallAllowed;
  onEvent(event: CustomSessionEvent): void | Promise<void>;
  onInteractionStart?: OnInteractionStart;
  preToolUse?(call: ToolCallContext, signal: AbortSignal): Promise<PreToolUseResult>;
  permissionRequest?(
    call: ToolCallContext,
    suggestions: unknown[],
    signal: AbortSignal,
  ): Promise<PermissionRequestResult>;
  permissionDenied?(
    call: ToolCallContext,
    denial: Extract<PermissionStageDecision, { decision: "deny" }>,
    signal: AbortSignal,
  ): Promise<PermissionDeniedResult>;
  setMode?(mode: PermissionMode): void;
  onHookWarning?(field: string, hook?: string): void | Promise<void>;
  isRunStopped?(): boolean;
  /** Only Session-generated authentication tools get the interaction-tool default. */
  isMcpAuthTool?(name: string): boolean;
  stopRun?(reason?: string): void;
}

export interface ToolCallContext {
  toolCall: ToolCall;
  args: Record<string, unknown>;
}
type PermissionCall = ToolCallContext & {
  mode: PermissionMode;
  signal: AbortSignal;
  identify(): Promise<InteractionIdentity>;
};

/** Owns fixed permission stages and review lifetime; Session supplies current context. */
export function createPermissionGate(options: PermissionGateOptions) {
  const sessionRules = options.sessionAllowRules ?? [];
  const sessionGrantListeners = options.sessionGrantListeners ?? new Set<() => void>();
  // The native tool task passes this same Context through beforeTool and execute.
  // Recovery receives a fresh invocation context; a grant is consumed once and never persisted.
  const invocationGrants = new WeakMap<Context, Map<number, string>>();
  const activeReviews = new Set<Promise<ReviewResult>>();
  const denialReason = ({ mode, toolCall }: PermissionCall) =>
    mode === "auto-review"
      ? `User denied this tool call: ${toolCall.name}`
      : `Tool not authorized: ${toolCall.name}`;

  function evaluateRuleStage(toolName: string, args: unknown): PermissionStageDecision | undefined {
    const match = evaluatePermissionRules({
      rules: [...options.rules, ...sessionRules],
      toolName,
      args,
      cwd: options.cwd,
      homeDir: options.homeDir,
    });
    if (!match) return undefined;
    if (match.decision === "allow") return { decision: "allow" };
    return {
      decision: match.decision,
      rule: match.rule,
      by: "rule",
      reason: `${match.decision === "deny" ? "Denied by permission rule" : "Permission rule"}: ${match.rule}`,
    };
  }

  function rewriteInput(
    call: ToolCallContext,
    updatedInput: Record<string, unknown>,
    hook?: string,
  ): Extract<PermissionStageDecision, { decision: "deny" }> | undefined {
    try {
      const tool = options.getTools().find((tool) => tool.name === call.toolCall.name)!;
      // A hook's replacement uses the same preparation as a model call so
      // permissions, allowed-stage observers and execution share one target.
      const prepared = tool.prepareArguments?.(updatedInput) ?? updatedInput;
      const [invalid] = Value.Errors(tool.parameters, prepared);
      if (invalid) throw new Error(`${invalid.instancePath || "/"} ${invalid.message}`);
      if (typeof prepared !== "object" || prepared === null || Array.isArray(prepared))
        throw new Error("Tool arguments must be an object");
      for (const key of Object.keys(call.args)) delete call.args[key];
      Object.assign(call.args, prepared);
    } catch (error) {
      return {
        decision: "deny",
        by: "hook",
        hook,
        reason: `Denied by hook: invalid updatedInput: ${(error as Error).message}`,
      };
    }
  }

  async function evaluateModeStage(context: PermissionCall): Promise<PermissionStageDecision> {
    const { toolCall, args, mode, signal } = context;
    const decision = options.isMcpAuthTool?.(toolCall.name)
      ? "allow"
      : decidePermission({ toolName: toolCall.name, mode });
    if (decision !== "review") {
      if (decision === "deny") return { decision, reason: denialReason(context), by: "user" };
      return { decision };
    }
    const tool = options.getTools().find((item) => item.name === toolCall.name);
    if (!tool)
      return { decision: "deny", reason: `Tool unavailable: ${toolCall.name}`, by: "review" };
    const review = (async () => {
      await options.onEvent({
        type: "permission_review",
        phase: "start",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      });
      const messages = await options.getMessages();
      const result = await reviewPermission({
        cwd: options.cwd,
        projectInstructions: options.getProjectInstructions(),
        messages: messages.filter(
          (message) =>
            message.role !== "assistant" ||
            !message.content.some((block) => block.type === "toolCall" && block.id === toolCall.id),
        ),
        tool,
        args,
        model: options.getReviewModel(),
        models: options.models,
        signal,
      });
      await options.onEvent({
        type: "permission_review",
        phase: "end",
        toolCallId: toolCall.id,
        ...result,
      });
      return result;
    })();
    activeReviews.add(review);
    void review.finally(() => activeReviews.delete(review)).catch(() => {});
    const result = await review;
    if (result.decision === "deny")
      return { decision: "deny", reason: denialReason(context), by: "review" };
    return result.decision === "ask" ? { ...result, by: "review" } : result;
  }

  async function updatePermissions(updates: unknown[] | undefined, hook?: string) {
    for (const [index, value] of (updates ?? []).entries()) {
      const ignored = () =>
        options.onHookWarning?.(`hookSpecificOutput.decision.updatedPermissions[${index}]`, hook);
      if (
        typeof value !== "object" ||
        value === null ||
        !("destination" in value) ||
        value.destination !== "session" ||
        !("type" in value)
      ) {
        await ignored();
        continue;
      }
      if (
        value.type === "setMode" &&
        "mode" in value &&
        typeof value.mode === "string" &&
        ["ask", "auto-review", "full-access"].includes(value.mode)
      ) {
        options.setMode?.(value.mode as PermissionMode);
      } else if (
        value.type === "addRules" &&
        "behavior" in value &&
        value.behavior === "allow" &&
        "rules" in value &&
        Array.isArray(value.rules)
      ) {
        try {
          const textRules = value.rules.map((rule: unknown) => {
            if (typeof rule === "string") return rule;
            if (
              typeof rule === "object" &&
              rule !== null &&
              "toolName" in rule &&
              typeof rule.toolName === "string" &&
              (!("ruleContent" in rule) || typeof rule.ruleContent === "string")
            )
              return "ruleContent" in rule && rule.ruleContent
                ? `${rule.toolName}(${rule.ruleContent})`
                : rule.toolName;
            throw new Error("Invalid permission rule");
          });
          const parsed = parsePermissionRules({ allow: textRules });
          sessionRules.push(...parsed.map((rule) => ({ ...rule, decision: "allow" as const })));
          for (const notify of sessionGrantListeners) notify();
        } catch {
          await ignored();
        }
      } else await ignored();
    }
  }

  async function evaluateInteractionStage(
    context: PermissionCall,
    decision: Extract<PermissionStageDecision, { decision: "ask" }>,
  ): Promise<Exclude<PermissionStageDecision, { decision: "ask" }>> {
    const { toolCall, args, mode, signal } = context;
    let grant = sessionAllowRule(toolCall.name, args, options.cwd, options.homeDir);
    const hook = await options.permissionRequest?.(
      context,
      [
        {
          type: "addRules",
          destination: "session",
          behavior: "allow",
          rules: [grant.description.rule],
        },
      ],
      signal,
    );
    if (hook?.continue === false) {
      options.stopRun?.(hook.stopReason);
      return {
        decision: "deny",
        by: "hook",
        hook: hook.hook,
        terminate: true,
        reason: hook.stopReason ?? "Stopped by hook",
      };
    }
    if (hook?.decision?.behavior === "deny") {
      if (hook.decision.interrupt) options.stopRun?.(hook.decision.message);
      return {
        decision: "deny",
        by: "hook",
        hook: hook.hook,
        ...(hook.decision.interrupt && { terminate: true as const }),
        reason: hook.decision.message ?? "Denied by hook",
      };
    }
    if (hook?.decision?.behavior === "allow") {
      if (hook.decision.updatedInput !== undefined) {
        const invalid = rewriteInput(context, hook.decision.updatedInput, hook.hook);
        if (invalid) return invalid;
      }
      await updatePermissions(hook.decision.updatedPermissions, hook.hook);
      const requestedRule = evaluateRuleStage(toolCall.name, args);
      if (requestedRule?.decision === "deny") return requestedRule;
      if (requestedRule?.decision === "ask") decision = requestedRule;
      else return { decision: "allow" };
    }
    grant = sessionAllowRule(toolCall.name, args, options.cwd, options.homeDir);
    const respond = options.onPermissionAsk;
    if (!respond) {
      return {
        decision: "deny",
        reason:
          decision.by === "rule"
            ? `Denied by permission rule: ${decision.rule}`
            : denialReason(context),
        by: decision.by ?? "user",
        ...(decision.rule !== undefined && { rule: decision.rule }),
        ...(decision.hook !== undefined && { hook: decision.hook }),
      };
    }
    const identity = await context.identify();
    // Memo persistence may yield while a sibling grants this command. Recheck before
    // installing the withdrawal listener; thereafter reply and withdrawal race together.
    if (decision.by !== "hook" && evaluateRuleStage(toolCall.name, args)?.decision === "allow")
      return { decision: "allow" };
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
    const covered = Promise.withResolvers<"allow">();
    const onSessionGrant = () => {
      // Hook ask requires an explicit answer for this call, even after a sibling's grant.
      if (decision.by === "hook") return;
      if (signal.aborted || evaluateRuleStage(toolCall.name, args)?.decision !== "allow") return;
      // Resolve permission before withdrawing the frontend, whose abort reply is deny.
      covered.resolve("allow");
      controller.abort();
    };
    sessionGrantListeners.add(onSessionGrant);
    let reply: "allow" | "deny" | "allow-session";
    try {
      reply = await Promise.race([
        requestInteraction(
          {
            identity,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args,
            callView: presentCall(
              options.getTools().find((tool) => tool.name === toolCall.name),
              args,
            ),
            mode,
            sessionAllow: grant.description,
            ...(decision.reason !== undefined && { reason: decision.reason }),
            signal: controller.signal,
          },
          respond,
          "deny",
          {
            notify: options.onInteractionStart,
            notification: {
              notification_type: "permission_prompt",
              title: "Permission required",
              message: `Permission required to use ${toolCall.name}`,
            },
          },
        ),
        covered.promise,
      ]);
      if (signal.aborted) reply = "deny";
      if (reply === "allow-session") {
        sessionRules.push(grant.rule);
        for (const notify of sessionGrantListeners) if (notify !== onSessionGrant) notify();
      }
    } finally {
      sessionGrantListeners.delete(onSessionGrant);
      signal.removeEventListener("abort", abort);
    }
    return reply === "allow" || reply === "allow-session"
      ? { decision: "allow" }
      : { decision: "deny", reason: denialReason(context), by: "user" };
  }

  const authorize = async (
    call: ToolCallContext,
    invocation: Context,
    api: HookApi | ToolExecutionApi,
  ) => {
    const context = {
      ...call,
      mode: options.getMode(),
      signal: invocation.abortSignal ?? new AbortController().signal,
      identify: () => createInteractionIdentity(api, "permission", invocation),
    };
    if (options.isRunStopped?.())
      return { block: true, terminate: true, reason: "Stopped by hook" };
    // deny stops immediately; allow skips Mode; ask skips Mode (including Review).
    // Ordinary tools then enter Interaction; owner-scoped job tools skip approval.
    // Only no opinion falls through to Mode.
    const hook = await options.preToolUse?.(call, context.signal);
    if (hook?.continue === false) {
      options.stopRun?.(hook.stopReason);
      return { block: true, terminate: true, reason: hook.stopReason ?? "Stopped by hook" };
    }
    let hookDecision: PermissionStageDecision | undefined;
    if (hook?.updatedInput !== undefined)
      hookDecision = rewriteInput(call, hook.updatedInput, hook.hook);
    if (!hookDecision && hook?.permissionDecision)
      hookDecision =
        hook.permissionDecision === "deny"
          ? {
              decision: "deny",
              by: "hook",
              hook: hook.hook,
              reason: `Denied by hook: ${hook.permissionDecisionReason || "Tool call denied"}`,
            }
          : hook.permissionDecision === "ask"
            ? {
                decision: "ask",
                by: "hook",
                hook: hook.hook,
                reason: hook.permissionDecisionReason,
              }
            : { decision: "allow" };
    const rule =
      hookDecision?.decision === "deny"
        ? undefined
        : evaluateRuleStage(call.toolCall.name, call.args);
    let decision =
      hookDecision?.decision === "deny"
        ? hookDecision
        : rule?.decision === "deny" || rule?.decision === "ask"
          ? rule
          : hookDecision?.decision === "ask"
            ? hookDecision
            : (hookDecision ?? rule ?? (await evaluateModeStage(context)));
    if (decision.decision === "ask") {
      // Owner-scoped job tools retain rule/hook denials and input validation,
      // but never enter approval hooks or frontend interactions.
      decision = ["job_output", "job_list", "job_kill"].includes(call.toolCall.name)
        ? { decision: "allow" }
        : await evaluateInteractionStage(context, decision);
    }
    if (decision.decision === "allow") {
      if (options.onToolCallAllowed) {
        context.signal.throwIfAborted();
        // A private copy prevents observers from changing the validated execution input.
        await options.onToolCallAllowed({
          toolName: call.toolCall.name,
          args: structuredClone(call.args) as Readonly<Record<string, unknown>>,
        });
      }
      return undefined;
    }
    await options.onEvent({
      type: "permission_denied",
      toolCallId: call.toolCall.id,
      toolName: call.toolCall.name,
      by: decision.by,
      ...(decision.rule !== undefined && { rule: decision.rule }),
      ...(decision.hook !== undefined && { hook: decision.hook }),
      ...(decision.by === "hook" && { reason: decision.reason }),
    });
    const denied = await options.permissionDenied?.(call, decision, context.signal);
    if (denied?.continue === false) options.stopRun?.(denied.stopReason);
    return {
      block: true,
      ...((decision.terminate || denied?.continue === false) && { terminate: true }),
      reason:
        decision.by === "review" && denied?.retry
          ? `${decision.reason} You may adjust the tool input and retry.`
          : decision.reason,
    };
  };

  return {
    beforeTool: (async (call, api, context) => {
      // Native arguments are JSON; structuredClone gives this gate an owned mutable tree.
      const facts = { toolCall: call, args: structuredClone(call.arguments) as JsonObject };
      const decision = await authorize(facts, context, api);
      if (decision?.block) return { block: decision.reason };
      let grants = invocationGrants.get(context);
      if (!grants) invocationGrants.set(context, (grants = new Map()));
      grants.set(api.taskId, JSON.stringify(facts.args));
      return { arguments: facts.args };
    }) satisfies ToolHooks["beforeTool"],
    async authorizeExecute(
      call: ToolCall,
      args: Record<string, unknown>,
      api: HookApi | ToolExecutionApi,
      context: Context,
    ) {
      const tool = options.getTools().find((candidate) => candidate.name === call.name);
      if (!tool) throw new Error(`Tool unavailable: ${call.name}`);
      // Native recovery reuses committed intent without running preparation again.
      // A changed tool definition must still reject input outside its current schema.
      const [invalid] = Value.Errors(tool.parameters, args);
      if (invalid)
        throw new Error(
          `Invalid recovered tool input: ${invalid.instancePath || "/"} ${invalid.message}`,
        );
      const grants = invocationGrants.get(context);
      const granted = grants?.get(api.taskId);
      grants?.delete(api.taskId);
      if (granted === JSON.stringify(args)) return;
      const original = JSON.stringify(args);
      const decision = await authorize({ toolCall: call, args }, context, api);
      if (decision?.block) throw new Error(decision.reason);
      if (original !== JSON.stringify(args))
        throw new Error("Recovered tool input was changed by a hook; submit a new tool call.");
    },
    async settleReviews() {
      await Promise.allSettled(activeReviews);
    },
  };
}
export { createPermissionBatch } from "./batch.ts";
