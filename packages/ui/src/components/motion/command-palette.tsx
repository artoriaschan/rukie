import { OVERLAY_LAYER } from "@/lib/overlay";
import { useComponentText } from "@/lib/i18n";
// beui.dev/components/blocks/command-palette

import { AnimatePresence, motion } from "motion/react";
import { type LucideIcon } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { EASE_OUT } from "@/lib/ease";
import { useOnOpen } from "@/lib/hooks/use-on-open";
import { useRowCursor } from "@/lib/hooks/use-row-cursor";
import { useTouchCapable } from "@/lib/hooks/use-touch-capable";
import { PresenceGate } from "@/lib/presence-gate";
import { useModalFocus } from "@/lib/hooks/use-modal-focus";
import { cn } from "@/lib/utils";
import { searchCommands } from "@/lib/command-search";
import { ScrollArea } from "@/components/ui/scroll-area";

export type CommandItem = {
  id: string;
  label: string;
  group?: string;
  keywords?: string[];
  icon?: LucideIcon;
  badge?: ReactNode;
  status?: ReactNode;
  section?: "actions";
  onSelect: () => void;
};

export interface CommandPaletteProps {
  items: CommandItem[];
  /** Opens with Cmd/Ctrl + this key. Default: "k" */
  shortcut?: string;
  placeholder?: string;
  emptyMessage?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Opened via a keyboard shortcut many times a day — entrance must read as
// immediate. A short tween avoids overshoot.
const PANEL_TRANSITION = {
  duration: 0.16,
  ease: EASE_OUT,
} as const;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
function readReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function CommandPalette({
  items,
  shortcut = "k",
  placeholder: placeholderProp,
  emptyMessage: emptyMessageProp,
  open: controlledOpen,
  onOpenChange,
}: CommandPaletteProps) {
  const componentText = useComponentText();
  const placeholder = placeholderProp ?? componentText("component.type-a-command-or-search");
  const emptyMessage = emptyMessageProp ?? componentText("component.no-results-found");

  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (v: boolean) => {
      if (!controlled) setInternalOpen(v);
      onOpenChange?.(v);
    },
    [controlled, onOpenChange],
  );

  const [query, setQuery] = useState("");
  // Portal target only exists client-side; render nothing during SSR/hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const uid = useId();
  // Read the current preference at render and subscribe while the palette is
  // mounted: Motion's hook snapshots it once and misses later OS changes.
  const reduce = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
  const canTouch = useTouchCapable();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, panelRef);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingSelection = useRef<CommandItem | null>(null);
  // A following dialog must start only after the modal focus cleanup restores
  // the opener. Otherwise its own restoration target could be an exiting row.
  useEffect(() => {
    if (open || !pendingSelection.current) return;
    const item = pendingSelection.current;
    pendingSelection.current = null;
    item.onSelect();
  }, [open]);
  const choose = (item: CommandItem) => {
    pendingSelection.current = item;
    setOpen(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === shortcut.toLowerCase()) {
        if (
          !open &&
          Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(
            (element) => !element.closest("[inert]"),
          )
        )
          return;
        e.preventDefault();
        setOpen(!open);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, shortcut, setOpen]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [open]);

  const filtered = useMemo(() => {
    // Search names and Project keywords, while retaining the caller's updated
    // order. Presentation group names are not searchable Session metadata.
    const matches = new Set(
      searchCommands(
        items.map((item) => ({ ...item, group: undefined })),
        query,
      ).map((item) => item.id),
    );
    return items.filter((item) => matches.has(item.id));
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    filtered.forEach((it) => {
      const g = it.group ?? componentText("component.results");
      const groupItems = map.get(g) ?? [];
      groupItems.push(it);
      map.set(g, groupItems);
    });
    return Array.from(map.entries());
  }, [filtered, componentText]);

  // Grouping reorders the list, so the rendered order is not the filtered
  // order whenever two groups interleave. Everything that has to agree on
  // "which row" — the highlight, the ids, Enter, the scroll — reads this one
  // array, so they cannot drift apart.
  const rows = useMemo(() => grouped.flatMap(([, list]) => list), [grouped]);

  const { activeIndex: active, moveTo, moveActive } = useRowCursor(rows, query);

  // Clearing the query would drop the cursor on its own, but only if it had
  // changed; `moveTo(null)` covers reopening on an already-empty query.
  useOnOpen(open, () => {
    setQuery("");
    moveTo(null);
  });

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = rows[active];
      if (it) choose(it);
    }
  };

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!mounted) return null;

  // Portaled to <body> so ancestors with transforms, filters, or fixed
  // positioning can't trap the overlay in their stacking context, and mounted
  // only while open. The chrome is two fixed siblings rather than one wrapper:
  // the backdrop spans the viewport edges but carries the scrim colour, and the
  // layer positioning the panel is inset off every edge. Both hang off
  // `PresenceGate`, so interaction releases in the same commit that starts the
  // exit rather than when it ends — `open` is already false for those frames.
  return createPortal(
    <AnimatePresence initial={false}>
      {open ? (
        <PresenceGate key="backdrop">
          {({ gate }) => (
            <motion.button
              type="button"
              aria-label={componentText("component.close-search-chats")}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{
                opacity: 0,
                transition: { duration: reduce ? 0 : 0.16, ease: EASE_OUT },
              }}
              transition={{ duration: reduce ? 0 : 0.16, ease: EASE_OUT }}
              {...gate}
              onClick={() => setOpen(false)}
              className={cn(
                OVERLAY_LAYER.modal,
                "pointer-events-auto cursor-pointer fixed inset-0 bg-foreground/20",
              )}
            />
          )}
        </PresenceGate>
      ) : null}

      {open ? (
        <PresenceGate key="panel-layer">
          {({ isPresent, gate }) => (
            // The layer itself never takes pointer events, so it carries
            // `inert` alone rather than the gate's pointer-events value.
            <div
              inert={!isPresent}
              className={cn(
                OVERLAY_LAYER.modal,
                "pointer-events-none fixed inset-4 flex items-center justify-center",
              )}
            >
              <motion.div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={placeholder}
                initial={{
                  opacity: 0,
                  scale: reduce ? 1 : 0.98,
                }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{
                  opacity: 0,
                  scale: reduce ? 1 : 0.98,
                  transition: { duration: reduce ? 0 : 0.16, ease: EASE_OUT },
                }}
                transition={reduce ? { duration: 0 } : PANEL_TRANSITION}
                {...gate}
                onKeyDown={onKeyDown}
                className="pointer-events-auto flex w-full max-w-[520px] max-h-full flex-col overflow-hidden rounded-[20px] border border-popover-border bg-popover shadow-md will-change-transform"
              >
                <div className="flex shrink-0 items-center px-4 py-1">
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    role="combobox"
                    // The field only exists while the palette is open.
                    aria-expanded="true"
                    aria-controls={`${uid}-list`}
                    aria-activedescendant={rows.length > 0 ? `${uid}-opt-${active}` : undefined}
                    aria-autocomplete="list"
                    className={cn(
                      "h-9 min-w-0 flex-1 cursor-text bg-transparent text-ui-base text-foreground placeholder:text-muted-foreground outline-none",
                      // The palette focuses this field the moment it opens, and iOS
                      // zooms the page in on a focused field under 16px: the fixed
                      // overlay is magnified off-center — clipped leading edge, half
                      // an icon column — and the zoom outlives the palette. 16px on
                      // touch keeps the page at scale 1; pointer devices keep 14px.
                      canTouch && "text-ui-lg",
                    )}
                  />
                </div>
                <div
                  ref={listRef}
                  id={`${uid}-list`}
                  role="listbox"
                  aria-label={componentText("component.results")}
                  className="min-h-0 flex flex-col pb-2"
                >
                  {rows.length === 0 ? (
                    <div className="p-8 text-center text-ui-base text-muted-foreground">
                      {emptyMessage}
                    </div>
                  ) : (
                    grouped.map(([group, list]) => (
                      <div
                        key={group}
                        role="group"
                        aria-label={group}
                        className="min-h-0 flex flex-col"
                      >
                        <div
                          aria-hidden
                          className="shrink-0 px-[14px] py-1 text-ui-caption text-muted-foreground"
                        >
                          {group}
                        </div>
                        <PaletteGroup list={list} group={group}>
                          {list.map((it) => {
                            // `rows` holds these very objects, in render order.
                            const idx = rows.indexOf(it);
                            const isActive = idx === active;
                            const Icon = it.icon;
                            return (
                              <button
                                key={it.id}
                                type="button"
                                id={`${uid}-opt-${idx}`}
                                role="option"
                                aria-selected={isActive}
                                data-index={idx}
                                onMouseEnter={() => moveTo(it.id)}
                                onFocus={() => moveTo(it.id)}
                                onClick={() => choose(it)}
                                className={cn(
                                  "relative isolate flex w-full min-w-0 cursor-pointer items-center min-h-[31px] gap-2 rounded-xl px-[10px] py-1 text-left text-ui-base outline-none hover:bg-menu-hover active:bg-menu-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
                                  isActive
                                    ? "bg-menu-hover text-foreground"
                                    : "text-muted-foreground",
                                )}
                              >
                                {Icon ? (
                                  <Icon className="relative z-10 h-4 w-4" />
                                ) : (
                                  <span className="relative z-10 size-3 shrink-0">{it.status}</span>
                                )}
                                <span className="relative z-10 min-w-0 flex-1 truncate">
                                  {it.label}
                                </span>
                                {it.badge ? (
                                  <span className="relative z-10 max-w-[108px] shrink-0 truncate text-right text-ui-caption text-muted-foreground">
                                    {it.badge}
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </PaletteGroup>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </PresenceGate>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function PaletteGroup({
  list,
  group,
  children,
}: {
  list: CommandItem[];
  group: string;
  children: ReactNode;
}) {
  if (list[0]?.section === "actions") return <div className="shrink-0 px-1">{children}</div>;
  return (
    <ScrollArea
      viewportLabel={group}
      className="mx-2 h-[min(279px,calc(100dvh-206px))] shrink min-h-0"
      viewportClassName="min-w-0 [contain:inline-size]"
    >
      {children}
    </ScrollArea>
  );
}
