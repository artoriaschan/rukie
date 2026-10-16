import { Button } from "@/components/motion/button/base";
import { useComponentText } from "@/lib/i18n";

import { BookOpenText, ChevronDown, ExternalLink, Globe2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useCallback, useId, useState } from "react";
import { AgentDisclosure } from "@/components/agents/agent-disclosure";
import { EASE_OUT } from "@/lib/ease";
import { useFavicon } from "@/lib/hooks/use-favicon";
import { cn } from "@/lib/utils";

export interface CitationItem {
  id: string;
  title: ReactNode;
  domain?: ReactNode;
  url?: string;
}

export interface CitationsProps {
  citations: CitationItem[];
  title?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  idPrefix?: string;
  className?: string;
}

export interface CitationProps {
  citationId: string;
  index: number;
  /** Must match the related Citations idPrefix. */
  idPrefix: string;
  className?: string;
}

export interface CitationListProps {
  citations: CitationItem[];
  idPrefix?: string;
  className?: string;
}

export interface CitationStackProps {
  citations: CitationItem[];
  limit?: number;
  className?: string;
}

function citationTargetId(prefix: string, citationId: string) {
  return `${prefix}-${citationId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function Citation({ citationId, index, idPrefix, className }: CitationProps) {
  const componentText = useComponentText();
  return (
    <a
      href={`#${citationTargetId(idPrefix, citationId)}`}
      aria-label={componentText("component.view-citation", { index })}
      className={cn(
        "mx-0.5 inline-flex min-w-4 -translate-y-0.5 items-center justify-center rounded-md bg-muted/60 px-1 py-0.5 text-ui-xs font-semibold leading-none text-muted-foreground no-underline outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {index}
    </a>
  );
}

export function CitationFavicon({ url, className }: { url?: string; className?: string }) {
  const favicon = useFavicon(url);

  return (
    <span
      aria-hidden="true"
      className={cn("grid size-5 shrink-0 place-items-center text-muted-foreground", className)}
    >
      {favicon.src ? (
        // biome-ignore lint/performance/noImgElement: Dynamic cross-site favicons keep this framework-agnostic registry component portable.
        <img
          ref={favicon.ref}
          src={favicon.src}
          alt=""
          width={16}
          height={16}
          referrerPolicy="no-referrer"
          className="size-4 rounded-sm object-contain"
        />
      ) : (
        <Globe2 className="size-3" />
      )}
    </span>
  );
}

export function CitationStack({ citations, limit = 3, className }: CitationStackProps) {
  return (
    <span aria-hidden="true" className={cn("flex -space-x-1.5", className)}>
      {citations.slice(0, limit).map((citation) => (
        <CitationFavicon
          key={citation.id}
          url={citation.url}
          className="size-6 rounded-full bg-background ring-2 ring-background"
        />
      ))}
    </span>
  );
}

function CitationRow({
  citation,
  index,
  idPrefix,
}: {
  citation: CitationItem;
  index: number;
  idPrefix: string;
}) {
  const content = (
    <>
      <CitationFavicon url={citation.url} />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="truncate text-ui-base font-medium text-foreground group-hover/citation:text-foreground">
          {citation.title}
        </span>
        {citation.domain ? (
          <span className="min-w-0 truncate text-ui-sm text-muted-foreground">
            {citation.domain}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="grid size-5 place-items-center rounded-md bg-foreground/[0.05] text-ui-xs font-semibold tabular-nums text-muted-foreground">
          {index}
        </span>
        {citation.url ? (
          <ExternalLink className="size-3 text-muted-foreground/40 group-hover/citation:text-muted-foreground" />
        ) : null}
      </span>
    </>
  );
  const className =
    "group/citation flex items-center gap-2 rounded-md px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const id = citationTargetId(idPrefix, citation.id);

  return citation.url ? (
    <a id={id} href={citation.url} target="_blank" rel="noreferrer noopener" className={className}>
      {content}
    </a>
  ) : (
    <div id={id} className={className}>
      {content}
    </div>
  );
}

export function CitationList({ citations, idPrefix, className }: CitationListProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const resolvedPrefix = idPrefix ?? `citation-list-${baseId.replace(/:/g, "")}`;

  return (
    <div className={cn("grid gap-0.5", className)}>
      <AnimatePresence mode="popLayout">
        {citations.map((citation, index) => (
          <motion.div
            layout={false}
            key={citation.id}
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
            transition={
              reduce
                ? { duration: 0 }
                : {
                    opacity: { duration: 0.18, ease: EASE_OUT },
                    y: { duration: 0.16, ease: EASE_OUT },
                    layout: { duration: 0.16, ease: EASE_OUT },
                  }
            }
          >
            <CitationRow citation={citation} index={index + 1} idPrefix={resolvedPrefix} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Citations({
  citations,
  title: titleProp,
  open,
  defaultOpen = false,
  onOpenChange,
  idPrefix,
  className,
}: CitationsProps) {
  const componentText = useComponentText();
  const title = titleProp ?? componentText("component.sources");

  const baseId = useId();
  const contentId = `${baseId}-content`;
  const resolvedPrefix = idPrefix ?? `citation-${baseId.replace(/:/g, "")}`;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );

  return (
    <div className={cn("w-full text-ui-base", className)}>
      <Button
        size="contextual"
        variant="ghost"
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className="group -ml-1 flex justify-start not-disabled:hover:bg-transparent text-ui-base min-h-7 items-center gap-2 rounded-lg px-1 text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BookOpenText className="size-3" />
        <span className="font-medium">{title}</span>
        <span className="rounded-md bg-muted px-2 py-0.5 text-ui-xs font-semibold tabular-nums">
          {citations.length}
        </span>
        <span
          aria-hidden="true"
          style={{ transform: `rotate(${currentOpen ? 180 : 0}deg)` }}
          className="text-muted-foreground"
        >
          <ChevronDown className="size-3" />
        </span>
      </Button>

      <AgentDisclosure id={contentId} open={currentOpen}>
        <CitationList citations={citations} idPrefix={resolvedPrefix} className="mt-1" />
      </AgentDisclosure>
    </div>
  );
}
