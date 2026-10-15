import { useEffect, useRef } from "react";
import { Bot, Lightbulb } from "lucide-react";
import type { PlanSubmission } from "../lib/plans";
import type { PresentedPermissionRequest } from "../lib/transcript";
import type { QueuedInput } from "@rukie/agent";
import type { SubagentPresentation } from "../lib/transcript";
import { ToolApproval, ToolApprovalCode } from "./agents/tool-approval";
import { TodoList, type TodoItem } from "./agents/todo-list";
import { Button } from "./motion/button/base";
import { useAppText } from "../lib/i18n";
export function PermissionDock({
  requests,
  connected,
  pending,
  shortcutsEnabled,
  onReply,
}: {
  requests: PresentedPermissionRequest[];
  connected: boolean;
  pending: string | null;
  shortcutsEnabled: boolean;
  onReply: (request: PresentedPermissionRequest, reply: "allow" | "deny" | "allow-session") => void;
}) {
  const t = useAppText();
  const first = requests[0];
  const region = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  useEffect(() => {
    const start = () => {
        composing.current = true;
      },
      end = () => {
        composing.current = false;
      };
    window.addEventListener("compositionstart", start, true);
    window.addEventListener("compositionend", end, true);
    return () => {
      window.removeEventListener("compositionstart", start, true);
      window.removeEventListener("compositionend", end, true);
    };
  }, []);
  const epoch = first?.identity.epoch;
  useEffect(() => {
    if (!epoch || !connected || !shortcutsEnabled) return;
    const modal = document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]');
    if (modal) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (composing.current) return;
    // Focus the boundary so the initial action keeps its resting appearance.
    // Tab enters the actions normally; Enter/A/Escape remain region shortcuts.
    region.current?.focus({ preventScroll: true });
    return () => {
      if (
        document.activeElement === document.body ||
        region.current?.contains(document.activeElement)
      )
        previous?.focus();
    };
  }, [epoch, connected, shortcutsEnabled]);
  useEffect(() => {
    if (!first || !connected || pending || !shortcutsEnabled) return;
    const key = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches("input,textarea,[contenteditable=true]") ||
          target.closest('[role="dialog"],[role="menu"]'))
      )
        return;
      // Native buttons own Enter, so focusing Deny cannot activate Allow.
      if (event.key === "Enter" && target instanceof HTMLElement && target.closest("button"))
        return;
      const reply =
        event.key === "Escape"
          ? "deny"
          : event.key.toLowerCase() === "a"
            ? "allow-session"
            : event.key === "Enter"
              ? "allow"
              : undefined;
      if (reply) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onReply(first, reply);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [first, connected, pending, shortcutsEnabled, onReply]);
  return (
    <div ref={region} tabIndex={-1} className="w-full shrink-0 outline-none">
      {first ? (
        <section
          key={first.identity.epoch}
          role="region"
          aria-label={t("conversation.permission")}
          className="py-2"
        >
          <ToolApproval
            tool={first.toolName}
            description={first.reason}
            parameters={[
              {
                id: "arguments",
                label: first.toolName,
                value: (
                  <div className="max-h-40 overflow-y-auto">
                    <ToolApprovalCode
                      code={
                        first.callView?.card === "terminal"
                          ? first.callView.command
                          : (JSON.stringify(first.args, null, 2) ?? "")
                      }
                      language={first.callView?.card === "terminal" ? "bash" : "json"}
                    />
                  </div>
                ),
              },
            ]}
            approveLabel={t("conversation.permission-allow")}
            sessionAllowLabel={t("conversation.permission-session")}
            denyLabel={t("conversation.permission-deny")}
            disabled={!connected || pending !== null}
            status={pending === first.identity.epoch ? "approving" : "pending"}
            onApprove={() => onReply(first, "allow")}
            onAlwaysAllow={first.sessionAllow ? () => onReply(first, "allow-session") : undefined}
            onDeny={() => onReply(first, "deny")}
          />
        </section>
      ) : null}
    </div>
  );
}
export function QueuedInputs({
  items,
  disabled,
  onSteer,
  onWithdraw,
}: {
  items: readonly QueuedInput[];
  disabled: boolean;
  onSteer: (id: string) => void;
  onWithdraw: (id: string) => void;
}) {
  const t = useAppText();
  if (!items.length) return null;
  return (
    <section
      aria-label={t("conversation.queued")}
      className="mx-auto max-h-40 w-full max-w-3xl shrink-0 overflow-y-auto px-5"
    >
      {items.map((input) => (
        <div
          key={input.requestId}
          className="flex flex-wrap items-start gap-2 rounded-xl border border-border bg-muted/30 p-2 text-ui-sm"
        >
          <div className="min-w-0 flex-1 basis-40">
            <p className="whitespace-pre-wrap break-words">{input.prompt}</p>
            {input.images.map((image, index) => (
              <span key={index} className="font-mono text-muted-foreground">
                {image.name ?? t("app.images")}{" "}
              </span>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onSteer(input.requestId)}
          >
            {t("conversation.steer")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onWithdraw(input.requestId)}
          >
            {t("conversation.withdraw")}
          </Button>
        </div>
      ))}
    </section>
  );
}
export function Summary({
  toolStates,
  background,
  plan,
  onOpenPlan,
}: {
  toolStates: Readonly<Record<string, unknown>>;
  background: readonly SubagentPresentation[];
  plan?: PlanSubmission;
  onOpenPlan?: (plan: PlanSubmission) => void;
}) {
  const t = useAppText();
  const raw = toolStates.todo;
  const todos: TodoItem[] = Array.isArray(raw)
    ? raw.flatMap((item, index) => {
        if (
          typeof item !== "object" ||
          item === null ||
          typeof item.content !== "string" ||
          !["pending", "in_progress", "completed"].includes(String(item.status))
        )
          return [];
        return [
          {
            id: String(index),
            title: item.content,
            status:
              item.status === "in_progress"
                ? "in-progress"
                : item.status === "completed"
                  ? "completed"
                  : "pending",
          },
        ];
      })
    : [];
  return (
    <aside
      aria-label={t("conversation.summary")}
      className="conversation-summary absolute right-4 top-3 z-20 flex max-h-[calc(100%-24px)] w-[300px] max-w-[calc(100%-32px)] flex-col gap-3 overflow-y-auto"
    >
      {todos.length ? (
        <TodoList items={todos} title={t("conversation.todos")} presentation="summary" />
      ) : null}
      {background.length ? (
        <section aria-label={t("conversation.subagents")} className="conversation-summary-card">
          <h3 className="conversation-summary-title">{t("conversation.subagents")}</h3>
          <ul className="flex flex-col gap-1">
            {background.map((agent) => (
              <li key={agent.id} className="conversation-summary-row">
                <span aria-hidden="true" className="grid size-3.5 shrink-0 place-items-center">
                  <Bot className="size-3 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1 truncate" title={agent.description}>
                  {agent.description}
                </span>
                <span className="shrink-0 text-ui-sm text-muted-foreground">
                  {t(
                    agent.active
                      ? "conversation.running"
                      : agent.outcome === "aborted"
                        ? "conversation.aborted"
                        : agent.outcome === "error"
                          ? "conversation.failed"
                          : "conversation.complete",
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {plan ? (
        <section aria-label={t("conversation.plan")} className="conversation-summary-card">
          <h3 className="conversation-summary-title">{t("conversation.plan")}</h3>
          <Button
            variant="ghost"
            className="conversation-summary-row w-full justify-start text-foreground focus-visible:ring-inset focus-visible:ring-offset-0"
            onClick={() => onOpenPlan?.(plan)}
            title={plan.title}
          >
            <span aria-hidden="true" className="grid size-3.5 shrink-0 place-items-center">
              <Lightbulb className="size-3 text-muted-foreground" />
            </span>
            <span className="min-w-0 flex-1 truncate text-left">{plan.title}</span>
          </Button>
        </section>
      ) : null}
    </aside>
  );
}
