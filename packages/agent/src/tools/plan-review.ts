import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { requestInteraction, type OnInteractionStart } from "../interaction/index.ts";

export interface PlanReviewRequest {
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

const parameters = Type.Object({ plan: Type.String({ minLength: 1 }) });

export function createExitPlanModeTool(
  planMode: { getActive(): boolean; setMode(on: boolean): Promise<void> },
  onPlanReview: OnPlanReview,
  onInteractionStart?: OnInteractionStart,
): AgentTool<typeof parameters> {
  return {
    name: "exit_plan_mode",
    label: "Review plan",
    description: "Submit a markdown plan for user review. Only available in Plan Mode.",
    parameters,
    async execute(toolCallId, { plan }, signal = new AbortController().signal) {
      if (!planMode.getActive()) throw new Error("Not in plan mode.");
      if (!plan.trim()) throw new Error("Plan must not be empty.");
      const request: PlanReviewRequest = { toolCallId, plan, signal };
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
        ...(reply.kind === "takeover" && { terminate: true }),
      };
    },
  };
}
