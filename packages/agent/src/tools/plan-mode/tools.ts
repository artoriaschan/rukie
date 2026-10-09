import type { PresentedTool } from "../support/presentation.ts";
import type { PreflightTool } from "../support/preflight.ts";
import { Type } from "typebox";
import {
  requestInteraction,
  type OnInteractionStart,
  type InteractionIdentity,
} from "../../interaction/index.ts";

export interface PlanReviewRequest {
  identity: InteractionIdentity;
  plan: string;
  toolCallId: string;
  signal: AbortSignal;
  origin?: { agentId: string; description: string };
}
export type PlanReviewResult =
  | { kind: "approve" }
  | { kind: "revise"; feedback: string }
  | { kind: "takeover" };
export type OnPlanReview = (
  request: PlanReviewRequest,
  signal: AbortSignal,
) => Promise<PlanReviewResult>;

const enterParameters = Type.Object({});
const reviewParameters = Type.Object({ plan: Type.String({ minLength: 1 }) });

export function createEnterPlanModeTool(plan: {
  getActive(): boolean;
  setMode(on: boolean): Promise<void>;
}): PresentedTool<typeof enterParameters> {
  return {
    name: "enter_plan_mode",
    presentCall: (args) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.enter_plan_mode",
      rawInput: args,
    }),
    presentResult: (_args, text) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.enter_plan_mode",
      text,
    }),
    description:
      "Request permission to enter Plan Mode before exploring and planning a larger task.",
    parameters: enterParameters,
    async execute(_params, _api, context) {
      const signal = context.abortSignal ?? new AbortController().signal;
      signal?.throwIfAborted();
      if (plan.getActive()) throw new Error("already in plan mode");
      await plan.setMode(true);
      return {
        content: [
          {
            type: "text",
            text: "Entered Plan Mode. Explore the code and context first, then submit a markdown plan with exit_plan_mode for user review.",
          },
        ],
        details: {},
      };
    },
  };
}

export function createExitPlanModeTool(
  planMode: { getActive(): boolean; setMode(on: boolean): Promise<void> },
  onPlanReview: OnPlanReview,
  onInteractionStart?: OnInteractionStart,
): PresentedTool<typeof reviewParameters> & PreflightTool<typeof reviewParameters> {
  const replies = new Map<
    number,
    { epoch: string; signal: AbortSignal; reply?: PlanReviewResult }
  >();
  return {
    name: "exit_plan_mode",
    presentCall: (args) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.exit_plan_mode",
      rawInput: args,
    }),
    presentResult: (_args, text) => ({
      card: "generic",
      kind: "task",
      displayKey: "tool.exit_plan_mode",
      text,
    }),
    description: "Submit a markdown plan for user review. Only available in Plan Mode.",
    parameters: reviewParameters,
    async preflight({ plan }, api, context, toolCallId, identity) {
      const signal = context.abortSignal ?? new AbortController().signal;
      const taskId = Number(api.taskId);
      const slot: { epoch: string; signal: AbortSignal; reply?: PlanReviewResult } = {
        epoch: identity.epoch,
        signal,
      };
      replies.set(taskId, slot);
      signal.addEventListener(
        "abort",
        () => {
          if (replies.get(taskId)?.epoch === slot.epoch) replies.delete(taskId);
        },
        { once: true },
      );
      if (!planMode.getActive()) throw new Error("Not in plan mode.");
      if (!plan.trim()) throw new Error("Plan must not be empty.");
      const request: PlanReviewRequest = { toolCallId, plan, signal, identity };
      const reply = await requestInteraction<PlanReviewRequest, PlanReviewResult | undefined>(
        request,
        (request) => onPlanReview(request, signal),
        undefined,
        {
          notify: onInteractionStart,
          notification: {
            notification_type: "plan_review",
            title: "Plan review required",
            message: plan,
          },
        },
      );
      signal.throwIfAborted();
      if (!reply) throw new Error("Plan review cancelled.");
      if (replies.get(taskId)?.epoch !== identity.epoch)
        throw new Error("Interaction callback ownership changed.");
      slot.reply = reply;
    },
    async execute(_args, api, context) {
      context.abortSignal?.throwIfAborted();
      const slot = replies.get(Number(api.taskId));
      replies.delete(Number(api.taskId));
      if (!slot || slot.signal !== context.abortSignal || slot.signal.aborted)
        throw new Error("Interaction callback ownership changed.");
      const reply = slot.reply;
      if (!reply) throw new Error("Plan Review has no current frontend reply.");
      if (!planMode.getActive()) throw new Error("Not in plan mode.");
      if (reply.kind === "approve") await planMode.setMode(false);
      const text =
        reply.kind === "approve"
          ? "The plan is approved. Begin execution."
          : reply.kind === "revise"
            ? `The user requested continued planning.${reply.feedback ? ` Feedback: ${reply.feedback}` : ""} Revise the plan and submit it again.`
            : "The user wants to take over. Stop and wait for their next message.";
      return {
        content: [{ type: "text", text }],
        details: reply,
        isError: reply.kind !== "approve",
        ...(reply.kind === "takeover" && { control: { terminate: true } }),
      };
    },
  };
}
