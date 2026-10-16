import { Button } from "@/components/motion/button/base";
import { useComponentText, type ComponentTranslator } from "@/lib/i18n";
// beui.dev/components/agents/tool-result

import {
  Ban,
  Braces,
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  CircleHelp,
  Copy,
  LoaderCircle,
  RotateCcw,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AgentCode, type AgentCodeLanguage } from "@/components/agents/agent-code";
import { ActionSwapRollText } from "@/components/motion/action-swap-roll";
import { AgentDisclosure } from "@/components/agents/agent-disclosure";
import { cn } from "@/lib/utils";

export type ToolResultStatus = "running" | "success" | "error" | "cancelled" | "unknown";
export type ToolResultKind = "terminal" | "request" | "custom";

export interface ToolResultProps {
  tool: ReactNode;
  title: ReactNode;
  children: ReactNode;
  status?: ToolResultStatus;
  kind?: ToolResultKind;
  meta?: ReactNode;
  icon?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapseOnComplete?: boolean;
  maxHeight?: number | null;
  copyText?: string;
  onCopy?: () => void | Promise<void>;
  onRetry?: () => void;
  className?: string;
  contentClassName?: string;
}

export interface ToolResultOutputProps {
  children: string;
  language?: AgentCodeLanguage;
  className?: string;
}

function getStatusLabel(componentText: ComponentTranslator, status: ToolResultStatus) {
  if (status === "running") return componentText("component.running");
  if (status === "success") return componentText("component.completed");
  if (status === "error") return componentText("component.failed");
  if (status === "unknown") return componentText("component.unknown-outcome");
  return componentText("component.cancelled");
}

function getSwapKey(value: ReactNode, fallback: string) {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function getStatusClass(status: ToolResultStatus) {
  if (status === "running") {
    return "text-accent";
  }
  if (status === "success") {
    return "text-success";
  }
  if (status === "error") {
    return "text-danger";
  }
  return "text-muted-foreground";
}

function KindIcon({ kind }: { kind: ToolResultKind }) {
  if (kind === "terminal") return <SquareTerminal className="size-3" />;
  if (kind === "request") return <Braces className="size-3" />;
  return <Wrench className="size-3" />;
}

function StatusIcon({ status, reduce }: { status: ToolResultStatus; reduce: boolean }) {
  if (status === "running") {
    return <LoaderCircle className={cn("size-3", !reduce && "animate-spin")} />;
  }
  if (status === "success") return <CircleCheck className="size-3" />;
  if (status === "error") return <CircleX className="size-3" />;
  if (status === "unknown") return <CircleHelp className="size-3" />;
  return <Ban className="size-3" />;
}

function ToolResultAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      size="icon"
      variant="ghost"
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </Button>
  );
}

export function ToolResultOutput({
  children,
  language = "bash",
  className,
}: ToolResultOutputProps) {
  return (
    <AgentCode
      code={children}
      language={language}
      className={cn("whitespace-pre-wrap break-words text-foreground", className)}
    />
  );
}

export function ToolResult({
  tool,
  title,
  children,
  status = "running",
  kind = "custom",
  meta,
  icon,
  open,
  defaultOpen = true,
  onOpenChange,
  collapseOnComplete = true,
  maxHeight = 220,
  copyText,
  onCopy,
  onRetry,
  className,
  contentClassName,
}: ToolResultProps) {
  const componentText = useComponentText();

  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousStatus = useRef(status);
  const copyTimer = useRef<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const running = status === "running";
  const canCopy = Boolean(copyText || onCopy);
  const titleKey = getSwapKey(title, status);
  const metaKey = getSwapKey(meta, `${status}-meta`);
  const toolKey = getSwapKey(tool, `${status}-tool`);
  const statusLabel = getStatusLabel(componentText, status);

  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );

  useEffect(() => {
    if (open === undefined && previousStatus.current !== "running" && status === "running") {
      setOpen(true);
    }
    if (
      open === undefined &&
      previousStatus.current === "running" &&
      status !== "running" &&
      collapseOnComplete
    ) {
      setOpen(false);
    }
    previousStatus.current = status;
  }, [collapseOnComplete, setOpen, status, open]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !currentOpen || !running || maxHeight === null) return;

    const frame = requestAnimationFrame(() => {
      if (typeof viewport.scrollTo === "function") {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: reduce ? "auto" : "smooth",
        });
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  });

  const handleCopy = useCallback(async () => {
    if (onCopy) await onCopy();
    else if (copyText) await navigator.clipboard?.writeText(copyText);

    setCopied(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }, [copyText, onCopy]);

  return (
    <div data-state={status} aria-busy={running} className={cn("w-full text-ui-base", className)}>
      <Button
        size="contextual"
        variant="ghost"
        id={triggerId}
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className="group flex h-auto px-0 justify-start not-disabled:hover:bg-transparent min-h-7 w-full items-center gap-2 rounded-lg text-ui-control text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span
          aria-hidden="true"
          className="grid size-4 shrink-0 place-items-center text-muted-foreground"
        >
          {icon ?? <KindIcon kind={kind} />}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-muted-foreground">
            <ActionSwapRollText value={titleKey}>{title}</ActionSwapRollText>
          </span>
          {meta ? (
            <span className="max-w-[25%] truncate text-ui-control text-muted-foreground">
              <ActionSwapRollText value={metaKey}>{meta}</ActionSwapRollText>
            </span>
          ) : null}
          <span className="max-w-[25%] truncate text-ui-control text-muted-foreground">
            <ActionSwapRollText value={toolKey}>{tool}</ActionSwapRollText>
          </span>
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 text-ui-caption font-medium",
            getStatusClass(status),
          )}
        >
          <StatusIcon status={status} reduce={reduce} />
          <ActionSwapRollText value={status}>{statusLabel}</ActionSwapRollText>
        </span>
        <span
          aria-hidden="true"
          style={{ transform: `rotate(${currentOpen ? 180 : 0}deg)` }}
          className="shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground"
        >
          <ChevronDown className="size-3" />
        </span>
      </Button>

      <AgentDisclosure id={contentId} role="region" aria-labelledby={triggerId} open={currentOpen}>
        <div className="pl-4 pt-1">
          <div className="overflow-hidden rounded-xl bg-muted/80">
            <div
              ref={viewportRef}
              className={maxHeight === null ? undefined : "scrollbar-hide overflow-y-auto"}
              style={{ maxHeight: maxHeight ?? undefined }}
            >
              <div className={cn("p-3", contentClassName)}>{children}</div>
            </div>

            {canCopy || onRetry ? (
              <div className="flex items-center gap-0.5 px-2 pb-1">
                {canCopy ? (
                  <ToolResultAction
                    label={
                      copied
                        ? componentText("component.copied")
                        : componentText("component.copy-result")
                    }
                    onClick={handleCopy}
                  >
                    {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                  </ToolResultAction>
                ) : null}
                {onRetry ? (
                  <ToolResultAction label={componentText("component.run-again")} onClick={onRetry}>
                    <RotateCcw className="size-3" />
                  </ToolResultAction>
                ) : null}
                <span className="ml-auto text-ui-caption text-muted-foreground">
                  <ActionSwapRollText value={status}>{statusLabel}</ActionSwapRollText>
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </AgentDisclosure>
    </div>
  );
}
