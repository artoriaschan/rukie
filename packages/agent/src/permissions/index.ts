import type { Agent, AgentOptions, StreamFn } from "@earendil-works/pi-agent-core";
import {
  validateToolArguments,
  type Api,
  type Model,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import type { CustomSessionEvent, PermissionMode } from "@neant/shared";
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
  /** Aborted when the Run is cancelled; frontends can dismiss their pending question. */
  signal: AbortSignal;
}

type PermissionDecision = "allow" | "deny" | "ask";

interface PermissionOptions {
  mode: PermissionMode;
  toolName: string;
  allowTools?: readonly string[];
}

/** Pure policy; frontends decide how to handle `ask`. */
function decidePermission({
  mode,
  toolName,
  allowTools,
}: PermissionOptions): PermissionDecision | "review" {
  if (
    mode === "full-access" ||
    ["read", "glob", "grep", "skill", "ask_user_question", "todo_write"].includes(toolName)
  )
    return "allow";
  if (allowTools?.some((pattern) => new Bun.Glob(pattern).match(toolName))) return "allow";
  return mode === "auto-review" ? "review" : "ask";
}

type PermissionStageDecision =
  | { decision: "allow" }
  | { decision: "deny"; reason: string }
  | { decision: "ask"; reason?: string };

// Permission Rule matching is filled in by the next ticket. No registration API:
// stages have a fixed order, and an explicit rule bypasses Permission Mode.
function evaluateRuleStage(): PermissionStageDecision | undefined {
  return undefined;
}

interface PermissionGateOptions {
  cwd: string;
  getMode(): PermissionMode;
  getAllowTools(): readonly string[];
  getAgentState(): Pick<Agent["state"], "tools" | "messages">;
  getProjectInstructions(): string[];
  getReviewModel(): Model<Api> | (() => Promise<Model<Api>>);
  streamFn: StreamFn;
  onPermissionAsk?: (request: PermissionAskRequest) => Promise<"allow" | "deny">;
  onEvent(event: CustomSessionEvent): void | Promise<void>;
}

type ToolCallContext = Parameters<NonNullable<AgentOptions["beforeToolCall"]>>[0];
type PermissionCall = ToolCallContext & { mode: PermissionMode; signal: AbortSignal };

/** Owns fixed permission stages and review lifetime; Session supplies current context. */
export function createPermissionGate(options: PermissionGateOptions) {
  const reviewBatches = new WeakMap<AssistantMessage, Map<string, Promise<ReviewResult>>>();
  const activeReviews = new Set<Promise<ReviewResult>>();
  const denialReason = ({ mode, toolCall }: PermissionCall) =>
    mode === "auto-review"
      ? `User denied this tool call: ${toolCall.name}`
      : `Tool not authorized: ${toolCall.name}`;

  async function evaluateModeStage(context: PermissionCall): Promise<PermissionStageDecision> {
    const { toolCall, args, assistantMessage, mode, signal } = context;
    const decision = decidePermission({
      toolName: toolCall.name,
      allowTools: options.getAllowTools(),
      mode,
    });
    if (decision !== "review") {
      if (decision === "deny") return { decision, reason: denialReason(context) };
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
      if (evaluateRuleStage() !== undefined) continue;
      if (
        decidePermission({ mode, toolName: call.name, allowTools: options.getAllowTools() }) !==
        "review"
      )
        continue;
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
    if (review.decision === "deny") return { decision: "deny", reason: denialReason(context) };
    return review;
  }

  async function evaluateInteractionStage(
    context: PermissionCall,
    decision: Extract<PermissionStageDecision, { decision: "ask" }>,
  ): Promise<Exclude<PermissionStageDecision, { decision: "ask" }>> {
    const { toolCall, args, mode, signal } = context;
    const reply = options.onPermissionAsk
      ? await requestInteraction(
          {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args,
            mode,
            ...(decision.reason !== undefined && { reason: decision.reason }),
            signal,
          },
          options.onPermissionAsk,
          "deny",
        )
      : "deny";
    return reply === "allow"
      ? { decision: "allow" }
      : { decision: "deny", reason: denialReason(context) };
  }

  const beforeToolCall: NonNullable<AgentOptions["beforeToolCall"]> = async (call, signal) => {
    const context = {
      ...call,
      mode: options.getMode(),
      signal: signal ?? new AbortController().signal,
    };
    // deny stops immediately; allow skips Mode; ask skips Mode (including Review)
    // and goes straight to Interaction. Only no opinion falls through to Mode.
    let decision = evaluateRuleStage() ?? (await evaluateModeStage(context));
    if (decision.decision === "ask") decision = await evaluateInteractionStage(context, decision);
    if (decision.decision === "allow") return undefined;
    await options.onEvent({
      type: "permission_denied",
      toolCallId: call.toolCall.id,
      toolName: call.toolCall.name,
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
