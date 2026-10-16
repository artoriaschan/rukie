import { useTraceReaderState } from "../lib/trace-reader";
import { latestPlan, planSubmissions, type PlanSubmission } from "../lib/plans";
import { PlanPane } from "../components/plan-pane";
import { PlanReviewDock } from "../components/plan-review-dock";
import { QuestionDock } from "../components/question-dock";
import { Value } from "typebox/value";
import { Type } from "typebox";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PermissionDecision } from "../lib/transcript";
import type { ConversationProps } from "./index";
import { WireError, type ClientCommand } from "../client";
import { TranscriptScrollbar } from "../components/transcript-scrollbar";
import { Transcript } from "../components/transcript";
import { PermissionDock, QueuedInputs, Summary } from "../components/conversation-dock";
import { useAppText } from "../lib/i18n";
import { useErrorText } from "./error";
import type { QueuedInput } from "@rukie/agent";
function queued(value: unknown): value is QueuedInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "requestId" in value &&
    typeof value.requestId === "string" &&
    "prompt" in value &&
    typeof value.prompt === "string" &&
    "images" in value &&
    Array.isArray(value.images) &&
    value.images.every(
      (image) =>
        typeof image === "object" &&
        image !== null &&
        typeof image.data === "string" &&
        typeof image.mimeType === "string" &&
        (image.name === undefined || typeof image.name === "string"),
    )
  );
}
export function AppConversation({
  footer,
  sessionId,
  view,
  connected,
  summaryOpen,
  onCloseSummary,
  request,
  onDraft,
  onImages,
  onInteractionResolved,
}: ConversationProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const traceReader = useTraceReaderState();
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const hadApproval = useRef(false);
  const approvalCount = Object.keys(view.interactions).length;
  useEffect(() => {
    if (
      hadApproval.current &&
      approvalCount === 0 &&
      document.activeElement === document.body &&
      !document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')
    )
      panel?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
    hadApproval.current = approvalCount > 0;
  }, [approvalCount, panel]);
  const t = useAppText();
  const errorText = useErrorText();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const state = view.transcript;
  const frame = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(true);
  const [planTabs, setPlanTabs] = useState<string[]>([]);
  const [activePlan, setActivePlan] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const submissions = state ? planSubmissions(state) : [];
  const plans = planTabs.flatMap((id) => {
    const plan = submissions.find((item) => item.id === id);
    return plan ? [plan] : [];
  });
  const paneOpen = plans.length > 0;
  useLayoutEffect(() => {
    if (summaryOpen && paneOpen && narrow) {
      setPlanTabs([]);
      setActivePlan("");
    }
  }, [summaryOpen, paneOpen, narrow]);
  const selectedPlan = plans.some((plan) => plan.id === activePlan)
    ? activePlan
    : (plans[0]?.id ?? "");
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const update = () => setNarrow(element.clientWidth < 960);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, []);
  const openPlan = (plan: PlanSubmission) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPlanTabs((previous) => (previous.includes(plan.id) ? previous : [...previous, plan.id]));
    setActivePlan(plan.id);
    setFocusRequest((previous) => previous + 1);
    onCloseSummary();
  };
  const closePane = () => {
    setPlanTabs([]);
    setActivePlan("");
    requestAnimationFrame(() => {
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      else panel?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
    });
  };
  const closePlan = (id: string) => {
    const remaining = plans.filter((plan) => plan.id !== id);
    if (!remaining.length) {
      closePane();
      return;
    }
    setPlanTabs(remaining.map((plan) => plan.id));
    if (selectedPlan === id)
      setActivePlan(
        remaining[
          Math.min(
            plans.findIndex((plan) => plan.id === id),
            remaining.length - 1,
          )
        ]!.id,
      );
    setFocusRequest((previous) => previous + 1);
  };
  const replyInteraction = async (
    command: Extract<ClientCommand, { type: "interaction.reply" }>,
    decision?: PermissionDecision,
  ) => {
    const epoch = command.identity.epoch;
    if (!connected || pending) return;
    setPending(epoch);
    setError("");
    try {
      await request(command);
      onInteractionResolved(epoch, decision);
    } catch (reason) {
      if (reason instanceof WireError && reason.code === "interaction_stale")
        onInteractionResolved(epoch);
      else setError(errorText(reason));
    } finally {
      setPending(null);
    }
  };
  const firstInteraction = Object.values(view.interactions)[0];
  const queue = async (type: "steer_now" | "withdraw", requestId: string) => {
    if (!connected || pending) return;
    setPending(requestId);
    setError("");
    try {
      const result = await request({ type, sessionId, requestId });
      if (
        type === "withdraw" &&
        typeof result === "object" &&
        result !== null &&
        "input" in result &&
        queued(result.input)
      ) {
        const input = result.input;
        onDraft((previous) => [input.prompt, previous].filter(Boolean).join("\n\n"));
        onImages((previous) => [...input.images, ...previous]);
      }
    } catch (reason) {
      if (!(reason instanceof WireError && reason.code === "not_queued"))
        setError(errorText(reason));
    } finally {
      setPending(null);
    }
  };
  return (
    <div
      ref={frame}
      className="conversation-frames"
      data-plan-open={paneOpen}
      data-plan-overlay={paneOpen && narrow}
    >
      <div
        ref={setPanel}
        data-conversation-frame
        inert={paneOpen && narrow}
        className="conversation-frame relative flex min-h-0 min-w-0 flex-1 flex-col"
      >
        {state ? (
          <div
            className={summaryOpen ? "flex min-h-0 flex-1 md:pr-[332px]" : "flex min-h-0 flex-1"}
          >
            <Transcript
              reader={traceReader}
              viewportRef={viewport}
              navigationContainer={panel}
              state={state}
              onExpandPlan={openPlan}
              decisions={Object.values(view.permissionDecisions ?? {})}
              waiting={Object.keys(view.interactions).length > 0}
              readOutput={async (outputRef, offset) => {
                const result = await request({
                  type: "tool_output.read",
                  sessionId,
                  outputRef,
                  offset,
                  maxBytes: 65536,
                });
                const schema = Type.Object({
                  stdout: Type.String(),
                  stderr: Type.String(),
                  nextOffset: Type.Integer({ minimum: 0 }),
                  dropped: Type.Boolean(),
                });
                if (!Value.Check(schema, result)) throw new Error("Invalid output response");
                return result;
              }}
            />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="px-5 text-ui-sm text-danger">
            {t("app.error", { message: error })}
          </p>
        ) : null}
        {summaryOpen && state ? (
          <Summary
            toolStates={state.toolStates}
            background={state.background}
            plan={latestPlan(state)}
            onOpenPlan={openPlan}
          />
        ) : null}
        {state ? (
          <QueuedInputs
            items={state.queued}
            disabled={!connected || pending !== null}
            onSteer={(id) => {
              void queue("steer_now", id);
            }}
            onWithdraw={(id) => {
              void queue("withdraw", id);
            }}
          />
        ) : null}
        {footer(
          firstInteraction?.kind === "question" ? (
            <QuestionDock
              key={firstInteraction.identity.epoch}
              request={firstInteraction}
              connected={connected}
              pending={pending}
              shortcutsEnabled={!summaryOpen && !paneOpen}
              onReply={(question, answer) => {
                void replyInteraction({
                  type: "interaction.reply",
                  kind: "question",
                  identity: question.identity,
                  reply: answer,
                });
              }}
            />
          ) : firstInteraction?.kind === "plan_review" ? (
            <PlanReviewDock
              key={firstInteraction.identity.epoch}
              request={firstInteraction}
              connected={connected}
              pending={pending}
              shortcutsEnabled={!summaryOpen && !paneOpen}
              onReply={(plan, answer) => {
                void replyInteraction({
                  type: "interaction.reply",
                  kind: "plan_review",
                  identity: plan.identity,
                  reply: answer,
                });
              }}
            />
          ) : firstInteraction ? (
            <PermissionDock
              requests={[firstInteraction]}
              connected={connected}
              pending={pending}
              shortcutsEnabled={!summaryOpen && !paneOpen}
              onReply={(permission, answer) => {
                void replyInteraction(
                  {
                    type: "interaction.reply",
                    kind: "permission",
                    identity: permission.identity,
                    reply: answer,
                  },
                  { reply: answer, request: permission },
                );
              }}
            />
          ) : undefined,
          firstInteraction?.kind === "question" || firstInteraction?.kind === "plan_review",
        )}
        {state ? <TranscriptScrollbar viewport={viewport} /> : null}
      </div>
      {paneOpen ? (
        <PlanPane
          plans={plans}
          active={selectedPlan}
          focusRequest={focusRequest}
          onSelect={setActivePlan}
          onCloseTab={closePlan}
          onClose={closePane}
        />
      ) : null}
    </div>
  );
}
