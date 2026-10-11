import { useEffect, useRef } from "react";
import type { PresentedPermissionRequest } from "../lib/transcript";
import type { QueuedInput } from "@rukie/agent";
import type { SubagentPresentation } from "../lib/transcript";
import { ApprovalCard } from "./agents/approval-card";
import { ToolApprovalCode } from "./agents/tool-approval";
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
    region.current?.querySelector<HTMLButtonElement>("[data-permission-primary]")?.focus();
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
    <div ref={region} className="w-full shrink-0">
      {first ? (
        <section
          key={first.identity.epoch}
          role="region"
          aria-label={t("conversation.permission")}
          className="py-2"
        >
          <ApprovalCard
            title={t("conversation.permission-title", { tool: first.toolName })}
            description={first.reason}
            approveLabel={t("conversation.permission-allow")}
            rejectLabel={t("conversation.permission-deny")}
            secondaryAction={
              first.sessionAllow ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!connected || pending !== null}
                  onClick={() => onReply(first, "allow-session")}
                >
                  {t("conversation.permission-session")}
                </Button>
              ) : null
            }
            disabled={!connected || pending !== null}
            status={pending === first.identity.epoch ? "submitting" : "pending"}
            onApprove={() => onReply(first, "allow")}
            onReject={() => onReply(first, "deny")}
          >
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
          </ApprovalCard>
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
          className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-2 text-ui-sm"
        >
          <div className="min-w-0 flex-1">
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
  onClose,
}: {
  toolStates: Readonly<Record<string, unknown>>;
  background: readonly SubagentPresentation[];
  onClose: () => void;
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
      className="absolute inset-x-0 top-0 z-20 max-h-full overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-sm md:inset-x-auto md:right-3 md:top-3 md:w-72"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-ui-base font-medium">{t("conversation.summary")}</h2>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label={t("conversation.close")}>
          ×
        </Button>
      </div>
      {todos.length ? (
        <TodoList
          items={todos}
          title={t("conversation.todos")}
          defaultOpen
          collapseOnComplete={false}
        />
      ) : null}
      {background.length ? (
        <section>
          <h3 className="my-3 text-ui-sm font-medium">{t("conversation.subagents")}</h3>
          {background.map((agent) => (
            <p key={agent.id} className="my-2 text-ui-sm">
              {agent.description} ·{" "}
              {t(
                agent.active
                  ? "conversation.running"
                  : agent.outcome === "aborted"
                    ? "conversation.aborted"
                    : agent.outcome === "error"
                      ? "conversation.failed"
                      : "conversation.complete",
              )}
            </p>
          ))}
        </section>
      ) : null}
      {!todos.length && !background.length ? (
        <p className="my-3 text-ui-sm text-muted-foreground">{t("conversation.empty")}</p>
      ) : null}
    </aside>
  );
}
