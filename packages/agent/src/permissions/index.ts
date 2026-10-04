import type { Agent, AgentOptions, StreamFn } from "@earendil-works/pi-agent-core";
import {
  validateToolArguments,
  type Api,
  type Model,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import type { CustomSessionEvent, PermissionMode } from "@neant/shared";
import { evaluatePermissionRules, type PermissionRule } from "./rules.ts";
export { parsePermissionRules, evaluatePermissionRules } from "./rules.ts";
export { resolvePermissionPath } from "./path.ts";
import { sessionAllowRule, type SessionAllow, type SessionAllowRule } from "./session-rules.ts";
export type { SessionAllowRule } from "./session-rules.ts";
import { requestInteraction } from "../interaction/index.ts";
import { reviewPermission, type ReviewResult } from "../review/index.ts";

export interface PermissionAskRequest {
  toolCallId: string;
  toolName: string;
  /** Validated arguments for this tool call. */
  args: unknown;
  /** Mode captured when this call entered the permission gate. */
  mode: PermissionMode;
  reason?: string;
  sessionAllow: SessionAllow;
  origin?: { agentId: string; description: string };
  /** Aborted when cancelled or covered by a new session rule; dismiss the pending question. */
  signal: AbortSignal;
}

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
      "read",
      "glob",
      "grep",
      "skill",
      "ask_user_question",
      "exit_plan_mode",
      "todo_write",
      "subagent",
      "subagent_fork",
      "send_message",
      "list_agents",
    ].includes(toolName)
  )
    return "allow";
  if (toolName === "enter_plan_mode") return "ask";
  return mode === "auto-review" ? "review" : "ask";
}

type PermissionStageDecision =
  | { decision: "allow" }
  | { decision: "deny"; reason: string; by: "rule" | "user" | "review"; rule?: string }
  | { decision: "ask"; reason?: string; by?: "rule" | "review"; rule?: string };

interface PermissionGateOptions {
  cwd: string;
  homeDir: string;
  rules: readonly PermissionRule[];
  sessionAllowRules?: SessionAllowRule[];
  sessionGrantListeners?: Set<() => void>;
  getMode(): PermissionMode;
  getAgentState(): Pick<Agent["state"], "tools" | "messages">;
  getProjectInstructions(): string[];
  getReviewModel(): Model<Api> | (() => Promise<Model<Api>>);
  streamFn: StreamFn;
  onPermissionAsk?: (request: PermissionAskRequest) => Promise<"allow" | "deny" | "allow-session">;
  onEvent(event: CustomSessionEvent): void | Promise<void>;
}

type ToolCallContext = Parameters<NonNullable<AgentOptions["beforeToolCall"]>>[0];
type PermissionCall = ToolCallContext & { mode: PermissionMode; signal: AbortSignal };

/** Owns fixed permission stages and review lifetime; Session supplies current context. */
export function createPermissionGate(options: PermissionGateOptions) {
  const sessionRules = options.sessionAllowRules ?? [];
  const sessionGrantListeners = options.sessionGrantListeners ?? new Set<() => void>();
  const reviewBatches = new WeakMap<AssistantMessage, Map<string, Promise<ReviewResult>>>();
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

  async function evaluateModeStage(context: PermissionCall): Promise<PermissionStageDecision> {
    const { toolCall, args, assistantMessage, mode, signal } = context;
    const decision = decidePermission({
      toolName: toolCall.name,
      mode,
    });
    if (decision !== "review") {
      if (decision === "deny") return { decision, reason: denialReason(context), by: "user" };
      return { decision };
    }
    let batch = reviewBatches.get(assistantMessage);
    if (!batch) {
      batch = new Map();
      reviewBatches.set(assistantMessage, batch);
    }
    // pi prepares parallel calls sequentially. Start independent reviews here,
    // while each actual hook still reads the current Permission Mode.
    for (const call of assistantMessage.content) {
      if (call.type !== "toolCall" || batch.has(call.id)) continue;
      if (decidePermission({ mode, toolName: call.name }) !== "review") continue;
      const tool = options.getAgentState().tools.find((item) => item.name === call.name);
      if (!tool) continue;
      let validated: unknown;
      try {
        validated =
          call.id === toolCall.id
            ? args
            : validateToolArguments(tool, {
                ...call,
                arguments: (tool.prepareArguments?.(call.arguments) ??
                  call.arguments) as typeof call.arguments,
              });
      } catch {
        // pi returns validation errors without executing or reviewing this call.
        continue;
      }
      if (evaluateRuleStage(call.name, validated) !== undefined) continue;
      const review = (async () => {
        await options.onEvent({
          type: "permission_review",
          phase: "start",
          toolCallId: call.id,
          toolName: call.name,
        });
        const result = await reviewPermission({
          cwd: options.cwd,
          projectInstructions: options.getProjectInstructions(),
          messages: options
            .getAgentState()
            .messages.filter((message) => message !== assistantMessage),
          tool,
          args: validated,
          model: options.getReviewModel(),
          streamFn: options.streamFn,
          signal,
        });
        await options.onEvent({
          type: "permission_review",
          phase: "end",
          toolCallId: call.id,
          ...result,
        });
        return result;
      })();
      batch.set(call.id, review);
      activeReviews.add(review);
      void review.finally(() => activeReviews.delete(review)).catch(() => {});
    }
    const review = await batch.get(toolCall.id)!;
    if (review.decision === "deny")
      return { decision: "deny", reason: denialReason(context), by: "review" };
    return review.decision === "ask" ? { ...review, by: "review" } : review;
  }

  async function evaluateInteractionStage(
    context: PermissionCall,
    decision: Extract<PermissionStageDecision, { decision: "ask" }>,
  ): Promise<Exclude<PermissionStageDecision, { decision: "ask" }>> {
    const { toolCall, args, mode, signal } = context;
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
      };
    }
    const grant = sessionAllowRule(toolCall.name, args, options.cwd, options.homeDir);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
    const covered = Promise.withResolvers<"allow">();
    const onSessionGrant = () => {
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
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args,
            mode,
            sessionAllow: grant.description,
            ...(decision.reason !== undefined && { reason: decision.reason }),
            signal: controller.signal,
          },
          respond,
          "deny",
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

  const beforeToolCall: NonNullable<AgentOptions["beforeToolCall"]> = async (call, signal) => {
    const context = {
      ...call,
      mode: options.getMode(),
      signal: signal ?? new AbortController().signal,
    };
    // deny stops immediately; allow skips Mode; ask skips Mode (including Review)
    // and goes straight to Interaction. Only no opinion falls through to Mode.
    let decision =
      evaluateRuleStage(call.toolCall.name, call.args) ?? (await evaluateModeStage(context));
    if (decision.decision === "ask") decision = await evaluateInteractionStage(context, decision);
    if (decision.decision === "allow") return undefined;
    await options.onEvent({
      type: "permission_denied",
      toolCallId: call.toolCall.id,
      toolName: call.toolCall.name,
      by: decision.by,
      ...(decision.rule !== undefined && { rule: decision.rule }),
    });
    return { block: true, reason: decision.reason };
  };

  return {
    beforeToolCall,
    async settleReviews() {
      await Promise.allSettled(activeReviews);
    },
  };
}
