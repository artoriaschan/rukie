import type { PresentedTool } from "../presentation.ts";
import { Type } from "typebox";
import { requestInteraction, type OnInteractionStart } from "../../interaction/index.ts";

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
    label: "Enter Plan Mode",
    description:
      "Request permission to enter Plan Mode before exploring and planning a larger task.",
    parameters: enterParameters,
    async execute(_toolCallId, _params, signal) {
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
): PresentedTool<typeof reviewParameters> {
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
    label: "Review plan",
    description: "Submit a markdown plan for user review. Only available in Plan Mode.",
    parameters: reviewParameters,
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
