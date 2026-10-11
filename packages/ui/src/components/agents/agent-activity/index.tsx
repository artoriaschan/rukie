import { useComponentText, type ComponentTranslator } from "@/lib/i18n";
// beui.dev/components/agents/agent-activity

import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ThinkingShimmer } from "@/components/agents/loading-states/thinking-shimmer";
import { AgentDisclosure } from "@/components/agents/agent-disclosure";
import { EASE_OUT, SPRING_LAYOUT, SPRING_SWAP } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { ActivityRow } from "./activity-row";
import type { AgentActivityContentType, AgentActivityItem, AgentActivityProps } from "./types";

export type {
  AgentActivityContentType,
  AgentActivityItem,
  AgentActivityProps,
  AgentActivitySearch,
  AgentActivityStatus,
  AgentActivityStep,
  AgentActivityText,
  AgentActivityTool,
  AgentActivityTrace,
  AgentSearchResult,
  AgentStepStatus,
  AgentTraceKind,
} from "./types";

function formatDuration(duration: number) {
  const seconds = Math.max(0, Math.round(duration));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function useControllableOpen({
  open,
  defaultOpen,
  onOpenChange,
}: {
  open?: boolean;
  defaultOpen: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = open !== undefined;
  const currentOpen = open ?? internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  return [currentOpen, setOpen] as const;
}

function getContentType(items: AgentActivityItem[]): AgentActivityContentType {
  const first = items[0]?.type;
  return first && items.every((item) => item.type === first) ? first : "mixed";
}

function getActiveLabel(componentText: ComponentTranslator, type: AgentActivityContentType) {
  if (type === "search") return componentText("component.searching-the-web");
  if (type === "tool") return componentText("component.running-tools");
  if (type === "trace") return componentText("component.working-through-the-run");
  if (type === "mixed") return componentText("component.working-through-it");
  return componentText("component.thinking");
}

function getSummary(
  componentText: ComponentTranslator,
  type: AgentActivityContentType,
  items: AgentActivityItem[],
  duration: number,
): ReactNode {
  if (type === "step" || type === "text") {
    return (
      <>
        {componentText("component.thought-for")}{" "}
        <span className="tabular-nums">{formatDuration(duration)}</span>
      </>
    );
  }
  if (type === "search") return componentText("component.searched-the-web");
  if (type === "tool") {
    return componentText("component.tool-count", { count: items.length });
  }
  if (type === "trace") {
    const messages = items.filter(
      (item) => item.type === "trace" && (item.kind === "thinking" || item.kind === "message"),
    ).length;
    const tools = items.length - messages;
    return componentText("component.trace-count", { tools, messages });
  }
  return componentText("component.step-count", { count: items.length });
}

export function AgentActivity({
  items,
  renderContent,
  contentType: initialContentType,
  status = "working",
  duration = 0,
  open,
  defaultOpen = false,
  onOpenChange,
  collapseOnComplete = true,
  collapsibleWhileWorking = false,
  activeLabel,
  summary,
  renderWorkingStatus,
  renderCompletedStatus,
  maxHeight = 208,
  showStatusDivider = false,
  className,
  contentClassName,
}: AgentActivityProps) {
  const componentText = useComponentText();

  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const contentId = `${baseId}-content`;
  const contentRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousStatus = useRef(status);
  const [contentHeight, setContentHeight] = useState(0);
  const [currentOpen, setOpen] = useControllableOpen({
    open,
    defaultOpen,
    onOpenChange,
  });
  const working = status === "working";
  const expanded = (working && !collapsibleWhileWorking) || currentOpen;
  const contentType = items.length ? getContentType(items) : (initialContentType ?? "mixed");
  const capped = maxHeight !== null && contentHeight > maxHeight;
  const viewportHeight =
    maxHeight === null
      ? contentHeight
      : working
        ? Math.max(0, maxHeight)
        : Math.min(contentHeight, Math.max(0, maxHeight));
  const streamOffset =
    working && maxHeight !== null ? Math.min(0, viewportHeight - contentHeight) : 0;

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    const measure = () => setContentHeight(node.offsetHeight);
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (previousStatus.current === "working" && status === "complete" && collapseOnComplete) {
      setOpen(false);
    }
    previousStatus.current = status;
  }, [collapseOnComplete, setOpen, status]);

  const toggle = () => {
    const next = !currentOpen;
    setOpen(next);
    if (next) requestAnimationFrame(() => viewportRef.current?.scrollTo({ top: 0 }));
  };

  const liveLabel = activeLabel ?? getActiveLabel(componentText, contentType);
  const completedSummary = summary ?? getSummary(componentText, contentType, items, duration);
  const maskImage = capped
    ? working
      ? "linear-gradient(to bottom, transparent, black 12px)"
      : "linear-gradient(to bottom, transparent, black 12px, black calc(100% - 12px), transparent)"
    : undefined;

  return (
    <div
      data-state={working ? "working" : expanded ? "open" : "closed"}
      data-content={contentType}
      aria-busy={working}
      className={cn("w-full text-ui-base", className)}
    >
      {working && !collapsibleWhileWorking ? (
        <div
          id={triggerId}
          role="status"
          className="flex h-7 min-w-0 items-center text-muted-foreground"
        >
          {renderWorkingStatus ? (
            renderWorkingStatus({ label: liveLabel, duration })
          ) : (
            <ThinkingShimmer>{liveLabel}</ThinkingShimmer>
          )}
        </div>
      ) : (
        <button
          id={triggerId}
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={toggle}
          className="group flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md text-left font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="min-w-0 truncate">
            {working ? (
              renderWorkingStatus ? (
                renderWorkingStatus({ label: liveLabel, duration })
              ) : (
                <ThinkingShimmer>{liveLabel}</ThinkingShimmer>
              )
            ) : renderCompletedStatus ? (
              renderCompletedStatus({ summary: completedSummary, duration })
            ) : (
              completedSummary
            )}
          </span>
          <motion.span
            aria-hidden="true"
            animate={{ rotate: expanded ? 0 : -90 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="inline-flex shrink-0 text-muted-foreground/70 group-hover:text-foreground"
          >
            <ChevronDown className="size-3.5" />
          </motion.span>
        </button>
      )}

      {showStatusDivider ? <hr className="mt-2 border-border" /> : null}

      {renderContent ? (
        renderContent({ expanded, contentId, triggerId })
      ) : (
        <AgentDisclosure
          id={contentId}
          role="region"
          aria-labelledby={triggerId}
          open={expanded}
          openHeight={maxHeight === null ? "auto" : viewportHeight}
        >
          <div
            ref={viewportRef}
            className={cn(
              "scrollbar-hide pr-1",
              capped && expanded && !working ? "overflow-y-auto" : "overflow-y-hidden",
            )}
            style={{
              height: maxHeight === null ? undefined : viewportHeight,
              maskImage,
              WebkitMaskImage: maskImage,
            }}
          >
            <motion.div
              ref={contentRef}
              role="list"
              initial={false}
              animate={{ y: streamOffset }}
              transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
              className={cn("space-y-0.5 py-2", contentClassName)}
            >
              <AnimatePresence mode="popLayout">
                {items.map((item) => (
                  <motion.div
                    layout="position"
                    key={item.id}
                    role="listitem"
                    initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
                    transition={
                      reduce
                        ? { duration: 0 }
                        : {
                            opacity: { duration: 0.18, ease: EASE_OUT },
                            y: SPRING_LAYOUT,
                            layout: SPRING_LAYOUT,
                          }
                    }
                  >
                    <ActivityRow item={item} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          </div>
        </AgentDisclosure>
      )}
    </div>
  );
}
