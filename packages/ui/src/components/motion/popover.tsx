import { OVERLAY_LAYER } from "@/lib/overlay";
import { useComponentText } from "@/lib/i18n";
// beui.dev/components/motion/popover

import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
  type HTMLAttributes,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePopoverPortalPosition } from "@/components/motion/popover-position";
import { useDismiss } from "@/lib/hooks/use-dismiss";
import { type HoverGesture, useHoverGesture } from "@/lib/hooks/use-hover-gesture";
import { useTapGesture } from "@/lib/hooks/use-tap-gesture";
import { cn } from "@/lib/utils";

type Side = "top" | "bottom" | "right";
type Align = "start" | "center" | "end";
type TriggerMode = "click" | "hover" | "manual";

const HOVER_CLOSE_DELAY = 120;

// `onPointerEnter`/`onPointerLeave` rather than the mouse pair: a tap fires
// compatibility mouseenter/mouseleave that carry no pointerType at all, and
// they are what made the panel flicker open and shut under a finger. The
// gesture pairs the two, so the panel a pen tap opened is not closed again by
// the boundary event that ends the same tap.
function makeHoverHandlers(hover: HoverGesture, enter: () => void, leave: () => void) {
  return {
    onPointerEnter: (event: React.PointerEvent) => {
      if (hover.enter(event)) enter();
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (hover.leave(event)) leave();
    },
  };
}

interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  openHover: () => void;
  scheduleClose: () => void;
  triggerMode: TriggerMode;
  side: Side;
  align: Align;
  gap: number;
  contentId: string;
  triggerRef: React.MutableRefObject<HTMLElement | null>;
  contentRef: React.MutableRefObject<HTMLDivElement | null>;
}

const PopoverContext = createContext<PopoverContextValue | null>(null);

function usePopoverContext(component: string) {
  const ctx = useContext(PopoverContext);
  if (!ctx) throw new Error(`${component} must be used within <Popover>`);
  return ctx;
}

export interface PopoverProps {
  children: ReactNode;
  /** Controlled open state. */
  open?: boolean;
  /** Uncontrolled initial open state. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** How the popover is summoned. Default "click". */
  trigger?: TriggerMode;
  /** Which side of the trigger the panel opens on. Default "bottom". */
  side?: Side;
  /** Alignment along the trigger's edge. Default "center". */
  align?: Align;
  /** Gap between trigger and panel, in px. Default 4. */
  sideOffset?: number;
  className?: string;
  /** Measure a separate surface without changing its disclosure semantics. */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Focus target when dismissing an externally anchored panel. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export function Popover({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  trigger = "click",
  side = "bottom",
  align = "center",
  sideOffset = 4,
  className,
  anchorRef,
  restoreFocusRef,
}: PopoverProps) {
  const contentId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const internalTriggerRef = useRef<HTMLElement | null>(null);
  const triggerRef = anchorRef ?? internalTriggerRef;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootHover = useHoverGesture();

  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openHover = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose, setOpen]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY);
  }, [cancelClose, setOpen]);

  const toggle = useCallback(() => setOpen(!open), [setOpen, open]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  // The dialog panel goes inert the moment it closes, so
  // focus cannot be left sitting inside it: Escape hands it back to the
  // trigger, the way the ARIA dialog pattern asks. A pointer dismissal takes
  // the focus onward itself when it lands on something focusable — this only
  // catches the case where it would otherwise be stranded.
  const close = useCallback(() => {
    setOpen(false);
    const focused = document.activeElement;
    const inPanel = focused instanceof HTMLElement && contentRef.current?.contains(focused);
    if (inPanel) (restoreFocusRef ?? triggerRef).current?.focus();
  }, [setOpen, restoreFocusRef, triggerRef]);
  // The panel is portalled, so both trees participate in outside detection.
  const ignoreContent = useCallback(
    (target: Element) =>
      Boolean(contentRef.current?.contains(target) || anchorRef?.current?.contains(target)),
    [anchorRef],
  );
  // A hover trigger opens on tap as well now, so it needs the same outside
  // dismissal the click trigger always had. The gesture passes through to
  // whatever it landed on, which is the light-dismiss bargain the platform's
  // own popovers strike.
  useDismiss(open, close, rootRef, { ignore: ignoreContent });

  const ctx = useMemo<PopoverContextValue>(
    () => ({
      open,
      setOpen,
      toggle,
      openHover,
      scheduleClose,
      triggerMode: trigger,
      side,
      align,
      gap: sideOffset,
      contentId,
      triggerRef,
      contentRef,
    }),
    [
      open,
      setOpen,
      toggle,
      openHover,
      scheduleClose,
      trigger,
      side,
      align,
      sideOffset,
      contentId,
      triggerRef,
    ],
  );

  const hoverHandlers =
    trigger === "hover" ? makeHoverHandlers(rootHover, openHover, scheduleClose) : {};

  return (
    <PopoverContext.Provider value={ctx}>
      <div
        ref={rootRef}
        className={cn("relative inline-flex isolate", className)}
        {...hoverHandlers}
      >
        {children}
      </div>
    </PopoverContext.Provider>
  );
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object")
        (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

export interface PopoverTriggerProps {
  /** A single focusable element (e.g. a Button) that opens the popover. */
  children: ReactElement;
}

export function PopoverTrigger({ children }: PopoverTriggerProps) {
  const ctx = usePopoverContext("PopoverTrigger");
  // What the last gesture on the trigger was, and whether the panel was
  // already open when it started. A click reports neither.
  const tap = useTapGesture<boolean>();

  if (!isValidElement(children)) return children;

  const child = children as ReactElement<Record<string, unknown>>;
  const childProps = child.props;
  const childRef = (childProps as { ref?: Ref<HTMLElement> }).ref;

  const compose =
    <E extends { defaultPrevented?: boolean }>(name: string, handler: (event: E) => void) =>
    (event: E) => {
      (childProps[name] as ((e: unknown) => void) | undefined)?.(event);
      if (!event.defaultPrevented) handler(event);
    };

  // Observation, not action. `compose` steps aside for a child that handled
  // the event itself, which is right for anything that *does* something — but
  // a child preventing the pointerdown default (to hold focus, say) has not
  // said the gesture didn't happen. Skipping the record there left the panel
  // reading whatever the gesture before it had put in.
  const observe =
    <E,>(name: string, handler: (event: E) => void) =>
    (event: E) => {
      (childProps[name] as ((e: unknown) => void) | undefined)?.(event);
      handler(event);
    };

  // The hover trigger keeps its hover path and *adds* a tap one, rather than
  // swapping mode on a device that reports a touchscreen: a touchscreen laptop
  // has both inputs and the mouse must keep working. A hovering pointer has
  // already opened the panel on its way in, and a keyboard press arrives with
  // no pointerdown behind it, so only a tap toggles here. Which panel state
  // the tap acts on is read from the gesture's start, because a browser that
  // focuses the trigger on contact would otherwise open it mid-gesture and let
  // the click close it again.
  const handlers: Record<string, unknown> =
    ctx.triggerMode === "hover"
      ? {
          onFocus: compose("onFocus", ctx.openHover),
          onBlur: compose("onBlur", ctx.scheduleClose),
          onPointerDown: observe<React.PointerEvent>("onPointerDown", (event) =>
            tap.start(event, ctx.open),
          ),
          onPointerCancel: observe("onPointerCancel", tap.drop),
          onKeyDown: observe("onKeyDown", tap.drop),
          onClick: compose("onClick", () => {
            const gesture = tap.take();
            if (!gesture || gesture.pointerType === "mouse") return;
            ctx.setOpen(!gesture.state);
          }),
        }
      : ctx.triggerMode === "manual"
        ? {}
        : { onClick: compose("onClick", ctx.toggle) };

  return cloneElement(child, {
    ...handlers,
    ref: mergeRefs(childRef, (node: HTMLElement | null) => {
      ctx.triggerRef.current = node;
    }),
    className: cn("relative z-0", childProps.className as string | undefined),
    "aria-haspopup": "dialog",
    "aria-expanded": ctx.open,
    "aria-controls": ctx.open ? ctx.contentId : undefined,
    "data-state": ctx.open ? "open" : "closed",
  });
}

export interface PopoverContentProps extends Pick<
  HTMLAttributes<HTMLDivElement>,
  "onFocus" | "onBlur" | "onPointerEnter" | "onPointerLeave"
> {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  ref?: Ref<HTMLDivElement>;
}

export function PopoverContent({
  children,
  className,
  ariaLabel,
  ref,
  ...props
}: PopoverContentProps) {
  const componentText = useComponentText();
  const ctx = usePopoverContext("PopoverContent");
  const [portalReady, setPortalReady] = useState(false);
  const {
    side,
    align,
    gap,
    contentId,
    triggerRef,
    contentRef,
    open,
    triggerMode,
    openHover,
    scheduleClose,
  } = ctx;
  const panelHover = useHoverGesture();
  const layout = usePopoverPortalPosition(triggerRef, contentRef, portalReady);
  useEffect(() => setPortalReady(true), []);

  let left = 0;
  let top = 0;
  if (layout) {
    const { trigger, content, viewport } = layout;
    left =
      side === "right"
        ? trigger.width + gap
        : align === "start"
          ? 0
          : align === "end"
            ? trigger.width - content.width
            : (trigger.width - content.width) / 2;
    top =
      side === "right"
        ? align === "start"
          ? 0
          : align === "end"
            ? trigger.height - content.height
            : (trigger.height - content.height) / 2
        : side === "bottom"
          ? trigger.height + gap
          : -(gap + content.height);
    left = Math.max(
      8 - trigger.left,
      Math.min(left, viewport.width - 8 - trigger.left - content.width),
    );
    const below = viewport.height - trigger.top - trigger.height - gap;
    const above = trigger.top - gap;
    if (side === "bottom" && below < content.height && above >= content.height)
      top = -(gap + content.height);
    if (side === "top" && above < content.height && below >= content.height)
      top = trigger.height + gap;
    top = Math.max(
      8 - trigger.top,
      Math.min(top, viewport.height - 8 - trigger.top - content.height),
    );
  }
  const hoverHandlers =
    triggerMode === "hover" ? makeHoverHandlers(panelHover, openHover, scheduleClose) : {};
  if (!portalReady) return null;

  // Keep the panel measurable while closed; visibility and inertness change together.
  return createPortal(
    <div
      data-popover-portal=""
      inert={!open}
      className={cn(
        OVERLAY_LAYER.interactive,
        "pointer-events-none fixed left-0 top-0 isolate size-0",
      )}
      style={{
        visibility: open && layout ? "visible" : "hidden",
        transform: `translate3d(${layout?.trigger.left ?? 0}px, ${layout?.trigger.top ?? 0}px, 0)`,
      }}
    >
      <div
        ref={mergeRefs(contentRef, ref)}
        id={contentId}
        role="dialog"
        aria-hidden={!open}
        aria-label={ariaLabel ?? componentText("component.context")}
        {...hoverHandlers}
        {...props}
        style={{ position: "absolute", left, top, pointerEvents: open ? "auto" : "none" }}
        className={cn(
          "w-max max-w-[min(calc(100vw-32px),320px)] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-xl border border-popover-border bg-popover p-3 text-popover-foreground shadow-md outline-none",
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
