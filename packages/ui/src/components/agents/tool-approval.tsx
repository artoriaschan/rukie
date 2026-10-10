import { useComponentText, type ComponentTranslator } from "@/lib/i18n";
// beui.dev/components/agents/tool-approval

import { Check, ChevronDown, CircleAlert, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { AgentCode, type AgentCodeLanguage } from "@/components/agents/agent-code";
import { AgentDisclosure } from "@/components/agents/agent-disclosure";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";

export type ToolApprovalStatus =
  | "pending"
  | "approving"
  | "approved"
  | "denied"
  | "running"
  | "complete"
  | "error";

export interface ToolApprovalParameter {
  id: string;
  label: ReactNode;
  value: ReactNode;
}

export interface ToolApprovalCodeProps {
  code: string;
  language?: AgentCodeLanguage;
  className?: string;
}

export interface ToolApprovalProps {
  tool: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  parameters?: ToolApprovalParameter[];
  status?: ToolApprovalStatus;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onApprove?: () => void;
  onAlwaysAllow?: () => void;
  onDeny?: () => void;
  className?: string;
  disabled?: boolean;
  approveLabel?: ReactNode;
  sessionAllowLabel?: ReactNode;
  denyLabel?: ReactNode;
}

function getStatusCopy(componentText: ComponentTranslator, status: ToolApprovalStatus) {
  if (status === "approving") return componentText("component.approving");
  if (status === "approved") return componentText("component.approved");
  if (status === "denied") return componentText("component.denied");
  if (status === "running") return componentText("component.running");
  if (status === "complete") return componentText("component.completed");
  if (status === "error") return componentText("component.failed");
  return componentText("component.approval-required");
}

function getStatusBadgeClass(status: ToolApprovalStatus) {
  if (status === "pending") {
    return "border-warning/30 bg-warning/10 text-warning";
  }
  if (status === "approving" || status === "running") {
    return "border-accent/30 bg-accent/10 text-accent";
  }
  if (status === "approved" || status === "complete") {
    return "border-success/30 bg-success/10 text-success";
  }
  return "border-danger/30 bg-danger/10 text-danger";
}

export function ToolApprovalCode({ code, language = "bash", className }: ToolApprovalCodeProps) {
  return (
    <AgentCode
      code={code}
      language={language}
      className={cn(
        // Parameter values sit in a narrow grid column with nowhere to scroll
        // on touch, so they wrap instead of clipping (as ToolResultOutput does).
        "whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/30 px-2.5 py-2",
        className,
      )}
    />
  );
}

export function ToolApproval({
  tool,
  title: titleProp,
  description,
  parameters = [],
  status = "pending",
  open,
  defaultOpen = false,
  onOpenChange,
  onApprove,
  onAlwaysAllow,
  onDeny,
  className,
  disabled = false,
  approveLabel,
  sessionAllowLabel,
  denyLabel,
}: ToolApprovalProps) {
  const componentText = useComponentText();
  const title = titleProp ?? componentText("component.allow-this-tool-to-run");

  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const detailsId = `${baseId}-details`;
  const previousStatus = useRef(status);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );
  const busy = status === "approving" || status === "running";
  const pending = status === "pending";
  const error = status === "error";

  useEffect(() => {
    if (previousStatus.current === "pending" && status !== "pending") {
      setOpen(false);
    }
    previousStatus.current = status;
  }, [setOpen, status]);

  return (
    <div
      data-state={status}
      aria-busy={busy}
      className={cn(
        "w-full overflow-hidden rounded-2xl border border-border/60 bg-muted/20 text-ui-base",
        className,
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-border/60 bg-background text-muted-foreground",
            error && "text-destructive",
          )}
        >
          {busy ? (
            <LoaderCircle className={cn("size-4", !reduce && "animate-spin")} />
          ) : error ? (
            <CircleAlert className="size-4" />
          ) : status === "denied" ? (
            <X className="size-4" />
          ) : status === "approved" || status === "complete" ? (
            <Check className="size-4" />
          ) : (
            <ShieldCheck className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-foreground">{title}</div>
              <div className="mt-0.5 truncate font-mono text-ui-sm text-muted-foreground">
                {tool}
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-ui-caption font-medium transition-colors",
                getStatusBadgeClass(status),
              )}
            >
              {getStatusCopy(componentText, status)}
            </span>
          </div>
          {description ? (
            <p className="mt-2 leading-5 text-muted-foreground">{description}</p>
          ) : null}

          {parameters.length ? (
            <button
              type="button"
              aria-expanded={currentOpen}
              aria-controls={detailsId}
              onClick={() => setOpen(!currentOpen)}
              className="mt-2 inline-flex items-center gap-1 rounded-md text-ui-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {componentText("component.view-details")}
              <motion.span
                aria-hidden="true"
                animate={{ rotate: currentOpen ? 180 : 0 }}
                transition={reduce ? { duration: 0 } : SPRING_SWAP}
              >
                <ChevronDown className="size-3.5" />
              </motion.span>
            </button>
          ) : null}
        </div>
      </div>

      <AgentDisclosure id={detailsId} open={currentOpen}>
        <dl className="mx-4 mb-4 grid gap-2 rounded-xl border border-border/50 bg-background/70 p-3">
          {parameters.map((parameter) => (
            <div
              key={parameter.id}
              className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-3 text-ui-sm"
            >
              <dt className="text-muted-foreground">{parameter.label}</dt>
              <dd className="min-w-0 break-words font-mono text-foreground/85">
                {parameter.value}
              </dd>
            </div>
          ))}
        </dl>
      </AgentDisclosure>

      <AnimatePresence initial={false}>
        {pending ? (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT }}
            className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3"
          >
            <motion.button
              type="button"
              data-permission-primary
              disabled={disabled}
              onClick={onApprove}
              whileTap={reduce ? undefined : { scale: 0.97 }}
              transition={SPRING_PRESS}
              className="rounded-xl bg-foreground px-3 py-1.5 text-ui-sm font-medium text-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {approveLabel ?? componentText("component.allow-once")}
            </motion.button>
            {onAlwaysAllow ? (
              <motion.button
                type="button"
                disabled={disabled}
                onClick={onAlwaysAllow}
                whileTap={reduce ? undefined : { scale: 0.97 }}
                transition={SPRING_PRESS}
                className="rounded-xl border border-border/60 bg-background px-3 py-1.5 text-ui-sm font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                {sessionAllowLabel ?? componentText("component.always-allow")}
              </motion.button>
            ) : null}
            <button
              type="button"
              disabled={disabled}
              onClick={onDeny}
              className="rounded-xl px-3 py-1.5 text-ui-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {denyLabel ?? componentText("component.deny")}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
