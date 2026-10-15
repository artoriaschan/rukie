import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Pencil, X } from "lucide-react";
import { Button } from "../../motion/button/base";
import { Checkbox } from "../../motion/checkbox";
import { Input } from "../../motion/input";
import { useAppText } from "../../../lib/i18n";
import { cn } from "../../../lib/utils";
import type { ApprovalCardAnswers, ApprovalCardProps } from "./types";

/** C43 presentation of the installed beUI Approval Card. */
export function InteractionApprovalCard({
  questions = [],
  onSubmit,
  onDismiss,
  disabled,
  status,
  source,
  regionLabel,
  shortcutsEnabled = true,
  className,
}: ApprovalCardProps) {
  const t = useAppText();
  const optionId = useId();
  const region = useRef<HTMLElement>(null);
  const composing = useRef(false);
  const [answers, setAnswers] = useState<ApprovalCardAnswers>({});
  const [cursor, setCursor] = useState(-1);
  const [step, setStep] = useState(0);
  const question = questions[step];
  const answer = answers[question?.id ?? ""] ?? { selected: [] };
  const busy = disabled || status === "submitting";
  useEffect(() => {
    if (
      busy ||
      !shortcutsEnabled ||
      document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')
    )
      return;
    region.current?.focus({ preventScroll: true });
  }, [busy, shortcutsEnabled]);
  if (!question) return null;
  const update = (next: typeof answer) => setAnswers({ ...answers, [question.id]: next });
  const answered = answer.selected.length > 0 || Boolean(answer.custom?.trim());
  const navigate = (next: number) => {
    setStep(next);
    setCursor(-1);
    region.current?.focus({ preventScroll: true });
  };
  const submit = (next = answer) => {
    const all = { ...answers, [question.id]: next };
    setAnswers(all);
    if (step < questions.length - 1) navigate(step + 1);
    else onSubmit?.(all);
  };
  const choose = (index: number) => {
    const option = question.options?.[index];
    if (!option || option.disabled || busy) return;
    const next = {
      ...answer,
      ...(question.multiple ? {} : { custom: undefined }),
      selected: question.multiple
        ? answer.selected.includes(option.value)
          ? answer.selected.filter((value) => value !== option.value)
          : [...answer.selected, option.value]
        : [option.value],
    };
    if (question.multiple) update(next);
    else submit(next);
  };
  return (
    <section
      ref={region}
      tabIndex={-1}
      role="region"
      aria-label={regionLabel}
      aria-busy={status === "submitting"}
      className={cn(
        "flex w-full max-w-[752px] flex-col gap-0.5 rounded-2xl bg-input-surface px-2 pb-2.5 pt-3.5 text-ui-base outline-none",
        className,
      )}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onKeyDownCapture={(event) => {
        if (
          busy ||
          !shortcutsEnabled ||
          composing.current ||
          event.nativeEvent.isComposing ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.defaultPrevented ||
          document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')
        )
          return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onDismiss?.();
          return;
        }
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          (target.matches("input,textarea,[contenteditable=true]") ||
            target.closest('[role="dialog"],[role="menu"]'))
        )
          return;
        if (
          event.key === "Enter" &&
          question.multiple &&
          target instanceof HTMLElement &&
          target.closest('[role="checkbox"]')
        ) {
          if (answered) submit();
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.key === "Enter" && target instanceof HTMLElement && target.closest("button"))
          return;
        if (/^[1-4]$/.test(event.key) && Number(event.key) <= (question.options?.length ?? 0)) {
          const index = Number(event.key) - 1;
          setCursor(index);
          const option = question.options?.[index];
          if (option && !option.disabled) {
            if (question.multiple) choose(index);
            else
              update({
                ...answer,
                ...(answer.custom ? { custom: undefined } : {}),
                selected: [option.value],
              });
          }
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const enabled = (question.options ?? []).flatMap((option, index) =>
            option.disabled ? [] : [index],
          );
          if (!enabled.length) return;
          const position = enabled.indexOf(cursor);
          const next =
            enabled[
              position < 0
                ? event.key === "ArrowDown"
                  ? 0
                  : enabled.length - 1
                : (position + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) %
                  enabled.length
            ]!;
          setCursor(next);
          const option = question.options?.[next];
          if (question.multiple)
            region.current
              ?.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')
              [next]?.focus({ preventScroll: true });
          else if (option)
            update({
              ...answer,
              ...(answer.custom ? { custom: undefined } : {}),
              selected: [option.value],
            });
        } else if (event.key === "Enter" && answered) submit();
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <header className="flex items-start gap-2 pb-2 pl-3 pr-2">
        {source}
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-ui-lg leading-[1.5] font-medium">{question.title}</h2>
          {question.description ? (
            <p className="mt-1 break-words text-ui-sm text-muted-foreground">
              {question.description}
            </p>
          ) : null}
        </div>
        {questions.length > 1 ? (
          <span className="shrink-0 text-ui-sm text-muted-foreground">
            {step + 1} / {questions.length}
          </span>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          disabled={busy}
          aria-label={t("interaction.close")}
          onClick={onDismiss}
        >
          <X />
        </Button>
      </header>
      <div
        role="group"
        aria-label={typeof question.title === "string" ? question.title : regionLabel}
        className="flex flex-col gap-0.5"
      >
        {question.options?.map((option, index) =>
          question.multiple ? (
            <div
              key={option.value}
              onFocus={() => setCursor(index)}
              className={cn(
                "group flex min-h-12 items-center gap-3 rounded-xl px-3 py-1.5 not-has-[:disabled]:hover:bg-hover focus-within:bg-hover",
                cursor === index && "bg-hover",
              )}
            >
              <Checkbox
                id={`${optionId}-${index}`}
                checked={answer.selected.includes(option.value)}
                disabled={busy || option.disabled}
                aria-label={option.label}
                onCheckedChange={() => choose(index)}
              />
              <label
                htmlFor={`${optionId}-${index}`}
                className={cn(
                  "flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 break-words",
                  busy || option.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                )}
              >
                <span className="block leading-5">{option.label}</span>
                {option.description ? (
                  <span className="text-ui-sm leading-5 text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </label>
              <ArrowRight
                aria-hidden="true"
                className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              />
            </div>
          ) : (
            <Button
              key={option.value}
              variant="ghost"
              disabled={busy || option.disabled}
              onClick={() => choose(index)}
              aria-pressed={answer.selected.includes(option.value)}
              className={cn(
                "group h-auto min-h-12 w-full justify-start gap-3 rounded-xl px-3 py-1.5 text-left hover:bg-hover focus-visible:bg-hover",
                cursor === index && "bg-hover",
              )}
            >
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-ui-sm text-muted-foreground"
              >
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 whitespace-normal break-words">
                <span className="block leading-5">{option.label}</span>
                {option.description ? (
                  <span className="text-ui-sm leading-5 font-normal text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
              <ArrowRight
                aria-hidden="true"
                className={cn(
                  "shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                  cursor === index && "opacity-100",
                )}
              />
            </Button>
          ),
        )}
      </div>
      <div data-interaction-custom className="flex min-h-[52px] items-center gap-3 px-3">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
        >
          <Pencil className="size-3" />
        </span>
        <Input
          aria-label={question.customPlaceholder ?? t("question.custom")}
          placeholder={question.customPlaceholder ?? t("question.custom")}
          value={answer.custom ?? ""}
          disabled={busy}
          onChange={(custom) => update({ ...answer, custom })}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.nativeEvent.isComposing &&
              !composing.current &&
              answer.custom?.trim() &&
              !busy &&
              shortcutsEnabled &&
              !document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')
            ) {
              event.preventDefault();
              submit();
            }
          }}
          className="min-w-0 flex-1"
          classNames={{
            field:
              "border-transparent bg-transparent hover:border-transparent data-[state=focused]:bg-transparent",
            input: "px-0",
          }}
        />
        <Button
          variant={question.multiple || answer.custom?.trim() ? "primary" : "ghost"}
          className="h-8 rounded-full border border-border px-3"
          disabled={busy || (question.multiple && !answered)}
          onClick={() =>
            question.multiple || answer.custom?.trim() ? submit(answer) : onDismiss?.()
          }
        >
          {t(
            question.multiple || answer.custom?.trim() ? "interaction.submit" : "interaction.skip",
          )}
        </Button>
      </div>
      {questions.length > 1 ? (
        <nav aria-label={t("question.navigation")} className="mt-2 flex justify-between gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || step === 0}
            onClick={() => navigate(step - 1)}
            aria-label={t("question.previous")}
          >
            <ArrowLeft />
            {t("question.previous")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !answered || step === questions.length - 1}
            onClick={() => navigate(step + 1)}
            aria-label={t("question.next")}
          >
            {t("question.next")}
            <ArrowRight />
          </Button>
        </nav>
      ) : null}
    </section>
  );
}
