import type { WireQuestionReply, WireQuestionRequest } from "@rukie/shared";
import { ApprovalCard } from "./agents/approval-card";
import { AnimatedBadge } from "./motion/animated-badge";
import { useAppText } from "../lib/i18n";
export function QuestionDock({
  request,
  connected,
  pending,
  shortcutsEnabled,
  onReply,
}: {
  request: WireQuestionRequest;
  connected: boolean;
  pending: string | null;
  shortcutsEnabled: boolean;
  onReply: (request: WireQuestionRequest, reply: WireQuestionReply) => void;
}) {
  const t = useAppText();
  return (
    <ApprovalCard
      variant="interaction"
      regionLabel={t("question.required")}
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
      questions={request.questions.map((question, index) => ({
        id: String(index),
        title: question.question,
        multiple: question.multiSelect,
        options: question.options.map((option) => ({ ...option, value: option.label })),
      }))}
      onDismiss={() => onReply(request, "declined")}
      onSubmit={(answers) =>
        onReply(request, {
          answers: request.questions.map((_, index) => answers[String(index)] ?? { selected: [] }),
        })
      }
    />
  );
}
