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
