import { useComponentText, type ComponentTranslator } from "@/lib/i18n";
// beui.dev/components/agents/approval-card

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  LoaderCircle,
  MessageSquareText,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, useId } from "react";
import { AgentDisclosure } from "@/components/agents/agent-disclosure";
import { ActionSwapRollText } from "@/components/motion/action-swap-roll";
import { Button } from "@/components/motion/button";
import { Checkbox } from "@/components/motion/checkbox";
import { Input } from "@/components/motion/input";
import { RadioGroup, RadioGroupItem } from "@/components/motion/radio";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import type {
  ApprovalCardAnswer,
  ApprovalCardAnswers,
  ApprovalCardProps,
  ApprovalCardQuestion,
  ApprovalCardStatus,
} from "./types";

export type {
  ApprovalCardAnswer,
  ApprovalCardAnswers,
  ApprovalCardOption,
  ApprovalCardProps,
  ApprovalCardQuestion,
  ApprovalCardStatus,
} from "./types";

const EMPTY_ANSWER: ApprovalCardAnswer = { selected: [], custom: "" };

function getStatusLabel(componentText: ComponentTranslator, status: ApprovalCardStatus) {
  if (status === "submitting") return componentText("component.submitting");
  if (status === "approved") return componentText("component.approved");
  if (status === "rejected") return componentText("component.rejected");
  if (status === "changes-requested") return componentText("component.changes-requested");
  if (status === "answered") return componentText("component.response-submitted");
  return componentText("component.input-required");
}

function getStatusClass(status: ApprovalCardStatus) {
  if (status === "approved" || status === "answered") {
    return "text-success";
  }
  if (status === "rejected") return "text-danger";
  if (status === "changes-requested") {
    return "text-warning";
  }
  return "text-muted-foreground";
}

function getStatusBadgeClass(status: ApprovalCardStatus) {
  if (status === "pending") {
    return "border-interaction-confirmation-foreground/30 bg-interaction-confirmation-surface text-interaction-confirmation-foreground";
  }
  if (status === "changes-requested") {
    return "border-warning/30 bg-warning/10 text-warning";
  }
  if (status === "submitting") {
    return "border-accent/30 bg-accent/10 text-accent";
  }
  if (status === "approved" || status === "answered") {
    return "border-success/30 bg-success/10 text-success";
  }
  return "border-danger/30 bg-danger/10 text-danger";
}

function isAnswered(answer: ApprovalCardAnswer) {
  return answer.selected.length > 0 || Boolean(answer.custom?.trim());
}

function QuestionOptions({
  question,
  answer,
  disabled,
  onChange,
  onSingleSelect,
}: {
  question: ApprovalCardQuestion;
  answer: ApprovalCardAnswer;
  disabled: boolean;
  onChange: (answer: ApprovalCardAnswer) => void;
  onSingleSelect?: () => void;
}) {
  const componentText = useComponentText();

  const custom = answer.custom ?? "";
  const groupLabelId = useId();

  return (
    <div className="mt-3">
      {question.options?.length ? (
        question.multiple ? (
          <div className="grid gap-0.5">
            {question.options.map((option) => (
              <Checkbox
                key={option.value}
                checked={answer.selected.includes(option.value)}
                disabled={disabled || option.disabled}
                label={option.label}
                onCheckedChange={(checked) =>
                  onChange({
                    ...answer,
                    selected: checked
                      ? [...answer.selected, option.value]
                      : answer.selected.filter((value) => value !== option.value),
                  })
                }
                className="min-h-7 rounded-md px-2 py-1"
              />
            ))}
          </div>
        ) : (
          <RadioGroup
            aria-labelledby={groupLabelId}
            value={answer.selected[0] ?? ""}
            onValueChange={(value) => {
              onChange({ selected: [value], custom: "" });
              onSingleSelect?.();
            }}
            className="gap-0.5"
          >
            <span id={groupLabelId} className="sr-only">
              {question.title}
            </span>
            {question.options.map((option) => (
              <RadioGroupItem
                key={option.value}
                value={option.value}
                label={option.label}
                disabled={disabled || option.disabled}
                className="min-h-7 rounded-md px-2 py-1"
              />
            ))}
          </RadioGroup>
        )
      ) : null}

      {question.allowCustom ? (
        <Input
          value={custom}
          disabled={disabled}
          placeholder={
            question.customPlaceholder ?? componentText("component.add-another-response")
          }
          onChange={(value) =>
            onChange({
              selected: question.multiple ? answer.selected : [],
              custom: value,
            })
          }
          className={cn("p-0.5", question.options?.length && "mt-1.5")}
          classNames={{
            field: "min-h-8 rounded-md border-0 bg-background/70 focus-within:bg-background",
            input: "px-3 text-ui-base",
          }}
        />
      ) : null}
    </div>
  );
}

function ProgressDots({ current, ids }: { current: number; ids: string[] }) {
  const componentText = useComponentText();

  return (
    <span className="flex gap-2">
      <span className="sr-only">
        {componentText("component.question-count", { current: current + 1, total: ids.length })}
      </span>
      {ids.map((id, index) => (
        <motion.span
          key={id}
          aria-hidden="true"
          initial={{
            scale: index === current ? 1 : 0.75,
            opacity: index <= current ? 1 : 0.35,
          }}
          animate={{
            scale: index === current ? 1 : 0.75,
            opacity: index <= current ? 1 : 0.35,
          }}
          transition={{ duration: 0.16, ease: EASE_OUT }}
          className="size-1.5 rounded-full bg-foreground"
        />
      ))}
    </span>
  );
}

export function ApprovalCard({
  disabled = false,
  rejectLabel,
  secondaryAction,
  title: titleProp,
  description,
  children,
  questions = [],
  status = "pending",
  answers,
  defaultAnswers = {},
  onAnswersChange,
  step,
  defaultStep = 0,
  onStepChange,
  onSubmit,
  onApprove,
  onReject,
  onRequestChanges,
  onDismiss,
  approveLabel: approveLabelProp,
  submitLabel: submitLabelProp,
  result,
  className,
}: ApprovalCardProps) {
  const componentText = useComponentText();
  const title = titleProp ?? componentText("component.approval-required");
  const approveLabel = approveLabelProp ?? componentText("component.approve");
  const submitLabel = submitLabelProp ?? componentText("component.submit-response");

  const reduce = useReducedMotion() ?? false;
  const [internalAnswers, setInternalAnswers] = useState<ApprovalCardAnswers>(defaultAnswers);
  const [internalStep, setInternalStep] = useState(defaultStep);
  const autoAdvanceTimer = useRef<number | undefined>(undefined);
  const currentAnswers = answers ?? internalAnswers;
  const currentStep = Math.min(
    Math.max(0, step ?? internalStep),
    Math.max(0, questions.length - 1),
  );
  const question = questions[currentStep];
  const questionMode = questions.length > 0;
  const multipleQuestions = questions.length > 1;
  const pending = status === "pending";
  const busy = status === "submitting";
  const interactive = pending || busy;
  const currentAnswer = question ? (currentAnswers[question.id] ?? EMPTY_ANSWER) : EMPTY_ANSWER;
  const displayTitle = question?.title ?? title;
  const titleKey = question?.id ?? String(status);
  const statusLabel = getStatusLabel(componentText, status);

  const clearAutoAdvance = useCallback(() => {
    if (autoAdvanceTimer.current === undefined) return;
    window.clearTimeout(autoAdvanceTimer.current);
    autoAdvanceTimer.current = undefined;
  }, []);

  useEffect(() => clearAutoAdvance, [clearAutoAdvance]);

  const setAnswers = useCallback(
    (next: ApprovalCardAnswers) => {
      if (answers === undefined) setInternalAnswers(next);
      onAnswersChange?.(next);
    },
    [answers, onAnswersChange],
  );

  const setStep = (next: number) => {
    clearAutoAdvance();
    if (step === undefined) setInternalStep(next);
    onStepChange?.(next);
  };

  const updateCurrentAnswer = (next: ApprovalCardAnswer) => {
    if (!question) return;
    setAnswers({ ...currentAnswers, [question.id]: next });
  };

  const continueQuestion = () => {
    if (currentStep < questions.length - 1) {
      setStep(currentStep + 1);
      return;
    }
    onSubmit?.(currentAnswers);
  };

  const queueAutoAdvance = () => {
    if (
      !question ||
      question.multiple ||
      question.autoAdvance === false ||
      currentStep >= questions.length - 1 ||
      busy ||
      disabled
    ) {
      return;
    }

    clearAutoAdvance();
    autoAdvanceTimer.current = window.setTimeout(() => {
      setStep(currentStep + 1);
    }, 240);
  };

  return (
    <div
      data-state={status}
      aria-busy={busy}
      className={cn("w-full overflow-hidden rounded-xl bg-muted p-4 text-ui-base", className)}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "grid size-5 shrink-0 place-items-center text-muted-foreground",
            getStatusClass(status),
          )}
        >
          {busy ? (
            <LoaderCircle className={cn("size-4", !reduce && "animate-spin")} />
          ) : interactive ? (
            questionMode ? (
              <CircleHelp className="size-4" />
            ) : (
              <MessageSquareText className="size-4" />
            )
          ) : status === "rejected" ? (
            <X className="size-4" />
          ) : (
            <Check className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-3">
            <h3 className="min-w-0 flex-1 text-ui-base font-medium text-foreground">
              <ActionSwapRollText value={titleKey}>{displayTitle}</ActionSwapRollText>
            </h3>
            {questionMode && interactive ? (
              multipleQuestions ? (
                <span className="shrink-0 text-ui-sm tabular-nums text-muted-foreground">
                  {currentStep + 1}/{questions.length}
                </span>
              ) : null
            ) : (
              <span
                className={cn(
                  "shrink-0 rounded-md border px-2 py-0.5 text-ui-xs font-medium transition-colors",
                  getStatusBadgeClass(status),
                )}
              >
                {statusLabel}
              </span>
            )}
            {onDismiss ? (
              <button
                type="button"
                aria-label={componentText("component.dismiss")}
                disabled={busy || disabled}
                onClick={onDismiss}
                className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          <AgentDisclosure open={interactive}>
            {questionMode && question ? (
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={question.id}
                  initial={reduce ? { opacity: 1 } : { opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, x: -6 }}
                  transition={{ duration: reduce ? 0 : 0.2, ease: EASE_OUT }}
                >
                  {question.description ? (
                    <p className="mt-1 text-muted-foreground">{question.description}</p>
                  ) : null}
                  <QuestionOptions
                    question={question}
                    answer={currentAnswer}
                    disabled={busy || disabled}
                    onChange={updateCurrentAnswer}
                    onSingleSelect={queueAutoAdvance}
                  />
                </motion.div>
              </AnimatePresence>
            ) : (
              <div>
                {description ? <p className="mt-1 text-muted-foreground">{description}</p> : null}
                {children ? <div className="mt-3">{children}</div> : null}
              </div>
            )}

            {questionMode ? (
              <div className="mt-4 flex items-center gap-2">
                {multipleQuestions ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={componentText("component.previous-question")}
                      disabled={busy || disabled || currentStep === 0}
                      onClick={() => setStep(currentStep - 1)}
                      className="rounded-lg"
                    >
                      <ArrowLeft className="size-4" />
                    </Button>
                    <ProgressDots current={currentStep} ids={questions.map((item) => item.id)} />
                  </>
                ) : null}
                <Button
                  size={currentStep === questions.length - 1 ? "sm" : "icon"}
                  aria-label={
                    currentStep === questions.length - 1
                      ? componentText("component.submit-response")
                      : componentText("component.next-question")
                  }
                  disabled={busy || disabled || !isAnswered(currentAnswer)}
                  onClick={continueQuestion}
                  className="ml-auto rounded-lg"
                >
                  {busy ? (
                    <LoaderCircle className={cn("size-4", !reduce && "animate-spin")} />
                  ) : currentStep === questions.length - 1 ? (
                    <>
                      {submitLabel}
                      <ArrowRight className="size-3.5" />
                    </>
                  ) : (
                    <ArrowRight className="size-4" />
                  )}
                </Button>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  data-permission-primary
                  size="sm"
                  disabled={busy || disabled}
                  onClick={onApprove}
                  className="rounded-lg"
                >
                  {approveLabel}
                </Button>
                {secondaryAction}
                {onRequestChanges ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || disabled}
                    onClick={onRequestChanges}
                    className="rounded-lg"
                  >
                    {componentText("component.request-changes")}
                  </Button>
                ) : null}
                {onReject ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || disabled}
                    onClick={onReject}
                    className="rounded-lg text-muted-foreground hover:text-danger"
                  >
                    {rejectLabel ?? componentText("component.reject")}
                  </Button>
                ) : null}
              </div>
            )}
          </AgentDisclosure>

          {!interactive ? (
            <p className="mt-1 text-ui-base text-muted-foreground">{result ?? statusLabel}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
