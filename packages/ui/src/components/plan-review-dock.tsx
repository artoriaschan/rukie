import type { WirePlanReviewRequest, WirePlanReviewReply } from "@rukie/shared";
import { ApprovalCard } from "./agents/approval-card";
import { AnimatedBadge } from "./motion/animated-badge";
import { useAppText } from "../lib/i18n";
import { planTitle } from "../lib/plans";

export function PlanReviewDock({
  request,
  connected,
  pending,
  shortcutsEnabled,
  onReply,
}: {
  request: WirePlanReviewRequest;
  connected: boolean;
  pending: string | null;
  shortcutsEnabled: boolean;
  onReply: (request: WirePlanReviewRequest, reply: WirePlanReviewReply) => void;
}) {
  const t = useAppText();
  return (
    <ApprovalCard
      variant="interaction"
      regionLabel={t("plan.review-required")}
      disabled={!connected || pending !== null}
      status={pending === request.identity.epoch ? "submitting" : "pending"}
      shortcutsEnabled={shortcutsEnabled}
      source={
        request.origin ? (
          <AnimatedBadge
            showIcon={false}
            className="max-w-1/2 shrink whitespace-normal break-words"
          >
            {request.origin.description || request.origin.agentId}
          </AnimatedBadge>
        ) : undefined
      }
      questions={[
        {
          id: "plan",
          title: t("plan.review-title"),
          description: planTitle(request.plan),
          customPlaceholder: t("plan.feedback"),
          options: [
            {
              value: "approve",
              label: t("plan.approve"),
              description: t("plan.approve-description"),
            },
            { value: "revise", label: t("plan.revise"), description: t("plan.revise-description") },
          ],
        },
      ]}
      onDismiss={() => onReply(request, { kind: "takeover" })}
      onSubmit={(answers) => {
        const answer = answers.plan;
        onReply(
          request,
          answer?.custom?.trim()
            ? { kind: "revise", feedback: answer.custom }
            : answer?.selected[0] === "approve"
              ? { kind: "approve" }
              : { kind: "revise", feedback: "" },
        );
      }}
    />
  );
}
