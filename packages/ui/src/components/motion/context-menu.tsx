import { OVERLAY_LAYER } from "@/lib/overlay";
import { useComponentText } from "@/lib/i18n";
// beui.dev/components/motion/context-menu

import { Check, ChevronRight } from "lucide-react";
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { holdSelection, TOUCH_GESTURE_CONTENT_CLASS } from "@/lib/touch";
import { cn } from "@/lib/utils";

type MenuPoint = { x: number; y: number };

const VIEWPORT_PADDING = 8;
const LONG_PRESS_DELAY = 520;
const LONG_PRESS_TOLERANCE = 10;

type TriggerElementProps = React.HTMLAttributes<HTMLElement> & {
  ref?: Ref<HTMLElement>;
};

interface ContextMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  openAt: (point: MenuPoint) => void;
  point: MenuPoint;
  invocation: number;
  menuId: string;
  triggerRef: React.MutableRefObject<HTMLElement | null>;
  contentRef: React.MutableRefObject<HTMLDivElement | null>;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  /** At most one flyout submenu is open; it closes with the root menu. */
  openSub: string | null;
  setOpenSub: (id: string | null) => void;
  /** Side and last pointer x, so a pointer heading for an open flyout keeps it open. */
  subSide: React.MutableRefObject<"left" | "right">;
  pointerX: React.MutableRefObject<number | null>;
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null);
/** True for items rendered inside a flyout submenu. */
const ContextMenuSubLevelContext = createContext(false);

function useContextMenuContext(component: string) {
  const context = useContext(ContextMenuContext);
  if (!context) {
    throw new Error(`${component} must be used within <ContextMenu>`);
  }
  return context;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

function getEnabledItems(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-context-menu-item="true"]:not([data-disabled="true"])',
    ),
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export interface ContextMenuProps {
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function ContextMenu({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  className,
}: ContextMenuProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [point, setPoint] = useState<MenuPoint>({ x: 0, y: 0 });
  const [invocation, setInvocation] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : internalOpen;
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const subSide = useRef<"left" | "right">("right");
  const pointerX = useRef<number | null>(null);
  const menuId = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
      if (!next) {
        setActiveId(null);
        setOpenSub(null);
      }
    },
    [controlled, onOpenChange],
  );

  const openAt = useCallback(
    (nextPoint: MenuPoint) => {
      setPoint(nextPoint);
      setInvocation((current) => current + 1);
      setActiveId(null);
      setOpen(true);
    },
    [setOpen],
  );

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const inSub =
        target instanceof Element &&
        target.closest(`[data-context-menu-owner="${CSS.escape(menuId)}"]`) !== null;
      if (!contentRef.current?.contains(target) && !inSub) setOpen(false);
    };
    const onWindowChange = () => setOpen(false);

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange);
    };
  }, [open, setOpen, menuId]);

  const value = useMemo<ContextMenuContextValue>(
    () => ({
      open,
      setOpen,
      openAt,
      point,
      invocation,
      menuId,
      triggerRef,
      contentRef,
      activeId,
      setActiveId,
      openSub,
      setOpenSub,
      subSide,
      pointerX,
    }),
    [open, setOpen, openAt, point, invocation, menuId, activeId, openSub],
  );

  return (
    <ContextMenuContext.Provider value={value}>
      <div className={cn("contents", className)}>{children}</div>
    </ContextMenuContext.Provider>
  );
}

export interface ContextMenuTriggerProps {
  children: ReactElement<TriggerElementProps>;
  disabled?: boolean;
  className?: string;
}

export function ContextMenuTrigger({
  children,
  disabled = false,
  className,
}: ContextMenuTriggerProps) {
  const context = useContextMenuContext("ContextMenuTrigger");
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchOrigin = useRef<MenuPoint | null>(null);
  const releaseSelection = useRef<(() => void) | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchOrigin.current = null;
  }, []);

  // Held for the whole press, not just the timer: a gesture that turned into a
  // drag must not paint a selection under the finger either.
  const endPress = useCallback(() => {
    cancelLongPress();
    releaseSelection.current?.();
    releaseSelection.current = null;
  }, [cancelLongPress]);

  useEffect(() => endPress, [endPress]);

  if (!isValidElement(children)) {
    throw new Error("<ContextMenuTrigger> requires a single React element");
  }

  const childProps = children.props;
  const childRef = children.props.ref;

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    childProps.onPointerDown?.(event);
    // A pen presses the same way a finger does and gets no `contextmenu` out
    // of the platform for it, so it holds to open too. A mouse has the right
    // button and is left to `onContextMenu`.
    const pressToOpen = event.pointerType === "touch" || event.pointerType === "pen";
    if (event.defaultPrevented || disabled || !pressToOpen) return;

    // `pointer-coarse:select-none` misses this press on a laptop whose mouse
    // is the primary pointer and whose touchscreen is not, and the platform's
    // own long-press selection then claims the gesture and cancels ours. The
    // press is the only thing that knows which input is on the glass, so it
    // takes selection away itself — for its own duration, and no longer.
    releaseSelection.current?.();
    releaseSelection.current = holdSelection(event.currentTarget);

    const origin = { x: event.clientX, y: event.clientY };
    touchOrigin.current = origin;
    longPressTimer.current = setTimeout(() => {
      context.openAt(origin);
      longPressTimer.current = null;
      touchOrigin.current = null;
    }, LONG_PRESS_DELAY);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    childProps.onPointerMove?.(event);
    const origin = touchOrigin.current;
    if (
      origin &&
      Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > LONG_PRESS_TOLERANCE
    ) {
      cancelLongPress();
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    childProps.onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    context.openAt({ x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 });
  };

  return cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      context.triggerRef.current = node;
      assignRef(childRef, node);
    },
    "aria-controls": context.open ? context.menuId : undefined,
    "aria-haspopup": "menu",
    "aria-expanded": context.open,
    // The long press is ours: without this iOS runs its own on the same
    // gesture and drops the selection callout and its handles on top of the
    // menu we just opened. Only the press gesture is ours though — the child
    // is the consumer's content, so a mouse can still select the text in it
    // and right-click the selection. `touch-none` stays off too: the page
    // still has to scroll from the trigger.
    className: cn(TOUCH_GESTURE_CONTENT_CLASS, childProps.className, className),
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      childProps.onContextMenu?.(event);
      if (event.defaultPrevented || disabled) return;
      event.preventDefault();
      endPress();
      context.openAt({ x: event.clientX, y: event.clientY });
    },
    onKeyDown,
    onPointerDown,
    onPointerMove,
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      childProps.onPointerUp?.(event);
      endPress();
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {
      childProps.onPointerCancel?.(event);
      endPress();
    },
  });
}

export interface ContextMenuContentProps {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function ContextMenuContent({
  children,
  className,
  ariaLabel: ariaLabelProp,
}: ContextMenuContentProps) {
  const componentText = useComponentText();
  const ariaLabel = ariaLabelProp ?? componentText("component.context-menu");

  const context = useContextMenuContext("ContextMenuContent");
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<MenuPoint>(context.point);
  const typeahead = useRef("");
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!context.open) return;
    const content = context.contentRef.current;
    if (!content) return;
    content.dataset.invocation = String(context.invocation);

    const rect = content.getBoundingClientRect();
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(
        Math.max(context.point.x, VIEWPORT_PADDING),
        window.innerWidth - rect.width - VIEWPORT_PADDING,
      ),
    );
    const top = Math.max(
      VIEWPORT_PADDING,
      Math.min(
        Math.max(context.point.y, VIEWPORT_PADDING),
        window.innerHeight - rect.height - VIEWPORT_PADDING,
      ),
    );

    setPosition({ x: left, y: top });
  }, [context.open, context.point, context.contentRef, context.invocation]);

  // Content may grow after opening; keep the existing overlay in the viewport.
  useEffect(() => {
    if (!context.open || !mounted) return;
    const content = context.contentRef.current;
    if (!content) return;
    const resize = new ResizeObserver(() => {
      const x = clamp(
        context.point.x,
        VIEWPORT_PADDING,
        Math.max(VIEWPORT_PADDING, window.innerWidth - content.offsetWidth - VIEWPORT_PADDING),
      );
      const y = clamp(
        context.point.y,
        VIEWPORT_PADDING,
        Math.max(VIEWPORT_PADDING, window.innerHeight - content.offsetHeight - VIEWPORT_PADDING),
      );
      setPosition((current) => (current.x === x && current.y === y ? current : { x, y }));
    });
    resize.observe(content);
    return () => resize.disconnect();
  }, [context.open, context.point, context.contentRef, mounted]);

  useEffect(() => {
    if (!context.open) return;
    const frame = requestAnimationFrame(() => {
      const first = getEnabledItems(context.contentRef.current)[0];
      first?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [context.open, context.contentRef]);

  useEffect(
    () => () => {
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    },
    [],
  );

  const moveFocus = (direction: 1 | -1) => {
    const items = getEnabledItems(context.contentRef.current);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = current < 0 ? 0 : (current + direction + items.length) % items.length;
    items[next]?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      context.setOpen(false);
      context.triggerRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      context.setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const items = getEnabledItems(context.contentRef.current);
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typeahead.current += event.key.toLocaleLowerCase();
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = setTimeout(() => {
        typeahead.current = "";
      }, 500);
      const match = getEnabledItems(context.contentRef.current).find((item) =>
        (item.dataset.label ?? item.textContent ?? "")
          .trim()
          .toLocaleLowerCase()
          .startsWith(typeahead.current),
      );
      match?.focus();
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      data-context-menu-portal=""
      aria-hidden={!context.open}
      inert={!context.open}
      style={{ left: position.x, top: position.y, visibility: context.open ? "visible" : "hidden" }}
      className={cn(
        OVERLAY_LAYER.interactive,
        "fixed",
        context.open ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      <div
        ref={context.contentRef}
        id={context.menuId}
        role={context.open ? "menu" : undefined}
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        className={cn(
          "min-w-56 max-w-[calc(100vw-32px)] max-h-[calc(100dvh-32px)] overflow-y-auto space-y-0.5 rounded-lg border border-popover-border bg-menu p-1 text-popover-foreground shadow-(--shadow-overlay) outline-none",
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

type ContextMenuItemTone = "default" | "destructive";

export interface ContextMenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  closeOnSelect?: boolean;
  tone?: ContextMenuItemTone;
  inset?: boolean;
  className?: string;
  textValue?: string;
  ariaHasPopup?: "menu";
  ariaExpanded?: boolean;
  /** Marks the entry representing the current state, such as a Session's own Project. */
  ariaCurrent?: boolean;
}

function itemClassName(tone: ContextMenuItemTone, inset: boolean, className?: string) {
  return cn(
    "relative isolate flex w-full select-none items-center min-h-8 gap-2 rounded-md px-2 py-0 text-left text-ui-base outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring",
    "cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:cursor-inherit [&_span]:cursor-inherit",
    inset && "pl-8",
    tone === "destructive" ? "text-destructive-soft-foreground" : "text-foreground",
    className,
  );
}

function ItemHighlight({ tone }: { tone: ContextMenuItemTone }) {
  return (
    <span
      className={cn(
        "absolute inset-0 -z-10 rounded-md",
        tone === "destructive" ? "bg-destructive-soft" : "bg-menu-hover",
      )}
    />
  );
}

/**
 * While a flyout is open, a pointer moving mainly toward it is crossing root items on its way
 * there; those items must not take focus and close the flyout.
 */
function headingForSub(context: ContextMenuContextValue, clientX: number, clientY: number) {
  const previous = context.pointerX.current;
  context.pointerX.current = clientX;
  if (context.openSub === null || previous === null) return false;
  const dx = context.subSide.current === "right" ? clientX - previous : previous - clientX;
  const sub = document.getElementById(context.openSub)?.getBoundingClientRect();
  return Boolean(sub && dx > 0 && clientY >= sub.top && clientY <= sub.bottom);
}

function ContextMenuItemBase({
  children,
  onSelect,
  disabled = false,
  closeOnSelect = true,
  tone = "default",
  inset = false,
  className,
  textValue,
  ariaHasPopup,
  ariaExpanded,
  ariaCurrent,
  role = "menuitem",
  ariaChecked,
}: ContextMenuItemProps & {
  role?: "menuitem" | "menuitemcheckbox" | "menuitemradio";
  ariaChecked?: boolean;
}) {
  const context = useContextMenuContext("ContextMenuItem");
  const inSub = useContext(ContextMenuSubLevelContext);
  const id = useId();
  const active = context.activeId === id;
  const checkedProps = role === "menuitem" ? {} : { "aria-checked": ariaChecked };

  return (
    <button
      type="button"
      id={id}
      role={role}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      aria-current={ariaCurrent ? "true" : undefined}
      {...checkedProps}
      disabled={disabled}
      data-context-menu-item="true"
      data-disabled={disabled ? "true" : undefined}
      data-label={textValue}
      tabIndex={-1}
      onFocus={() => {
        context.setActiveId(id);
        if (!inSub) context.setOpenSub(null);
      }}
      onPointerMove={(event) => {
        if (disabled || event.pointerType === "touch") return;
        if (!inSub && headingForSub(context, event.clientX, event.clientY)) return;
        event.currentTarget.focus();
      }}
      onClick={() => {
        if (disabled) return;
        onSelect?.();
        if (closeOnSelect) context.setOpen(false);
      }}
      className={itemClassName(tone, inset, className)}
    >
      {active && !disabled ? <ItemHighlight tone={tone} /> : null}
      {children}
    </button>
  );
}

export function ContextMenuItem(props: ContextMenuItemProps) {
  return <ContextMenuItemBase {...props} />;
}

interface ContextMenuSubValue {
  /** The flyout panel's element id; also the root `openSub` value while it is open. */
  id: string;
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>;
  /** Set by keyboard opening so the panel focuses its first item once positioned. */
  focusFirst: React.MutableRefObject<boolean>;
}

const ContextMenuSubContext = createContext<ContextMenuSubValue | null>(null);

function useContextMenuSub(component: string) {
  const sub = useContext(ContextMenuSubContext);
  if (!sub) throw new Error(`${component} must be used within <ContextMenuSub>`);
  return sub;
}

/** A flyout submenu: hover or ArrowRight opens it beside its trigger. */
export function ContextMenuSub({ children }: { children: ReactNode }) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const focusFirst = useRef(false);
  const value = useMemo(() => ({ id, triggerRef, focusFirst }), [id]);
  return <ContextMenuSubContext.Provider value={value}>{children}</ContextMenuSubContext.Provider>;
}

export interface ContextMenuSubTriggerProps {
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  textValue?: string;
}

export function ContextMenuSubTrigger({
  children,
  disabled = false,
  className,
  textValue,
}: ContextMenuSubTriggerProps) {
  const context = useContextMenuContext("ContextMenuSubTrigger");
  const sub = useContextMenuSub("ContextMenuSubTrigger");
  const id = useId();
  const open = context.openSub === sub.id;
  const highlighted = (context.activeId === id || open) && !disabled;
  const openWithFocus = () => {
    sub.focusFirst.current = true;
    if (open) document.getElementById(sub.id)?.querySelector<HTMLElement>(ENABLED_ITEM)?.focus();
    else context.setOpenSub(sub.id);
  };
  return (
    <button
      ref={sub.triggerRef}
      type="button"
      id={id}
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? sub.id : undefined}
      disabled={disabled}
      data-context-menu-item="true"
      data-disabled={disabled ? "true" : undefined}
      data-label={textValue}
      tabIndex={-1}
      onFocus={() => context.setActiveId(id)}
      onPointerMove={(event) => {
        if (disabled || event.pointerType === "touch") return;
        context.pointerX.current = event.clientX;
        event.currentTarget.focus();
        if (!open) context.setOpenSub(sub.id);
      }}
      onKeyDown={(event) => {
        if (disabled || event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        openWithFocus();
      }}
      onClick={(event) => {
        if (disabled) return;
        // A keyboard activation (Enter/Space) has no pointer detail and moves into the panel.
        if (event.detail === 0) openWithFocus();
        else context.setOpenSub(sub.id);
      }}
      className={itemClassName("default", false, className)}
    >
      {highlighted ? <ItemHighlight tone="default" /> : null}
      {children}
      <ChevronRight aria-hidden="true" className="ml-auto size-3 shrink-0" />
    </button>
  );
}

const ENABLED_ITEM = '[data-context-menu-item="true"]:not([data-disabled="true"])';
const SUB_GAP = 4;

export interface ContextMenuSubContentProps {
  children: ReactNode;
  ariaLabel: string;
  className?: string;
}

export function ContextMenuSubContent({
  children,
  ariaLabel,
  className,
}: ContextMenuSubContentProps) {
  const context = useContextMenuContext("ContextMenuSubContent");
  const sub = useContextMenuSub("ContextMenuSubContent");
  const open = context.open && context.openSub === sub.id;
  const panel = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<MenuPoint | null>(null);
  const typeahead = useRef("");
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const place = () => {
      const menu = context.contentRef.current?.getBoundingClientRect();
      const trigger = sub.triggerRef.current?.getBoundingClientRect();
      const content = panel.current?.getBoundingClientRect();
      if (!menu || !trigger || !content) return;
      const right = menu.right + SUB_GAP;
      const left = menu.left - SUB_GAP - content.width;
      const fitsRight = right + content.width <= window.innerWidth - VIEWPORT_PADDING;
      const fitsLeft = left >= VIEWPORT_PADDING;
      context.subSide.current = fitsRight || !fitsLeft ? "right" : "left";
      const x = clamp(
        fitsRight || !fitsLeft ? right : left,
        VIEWPORT_PADDING,
        Math.max(VIEWPORT_PADDING, window.innerWidth - content.width - VIEWPORT_PADDING),
      );
      // Align the first row with the trigger row: the panel shell has the same 4px inset.
      const y = clamp(
        trigger.top - 4,
        VIEWPORT_PADDING,
        Math.max(VIEWPORT_PADDING, window.innerHeight - content.height - VIEWPORT_PADDING),
      );
      setPosition((current) => (current?.x === x && current.y === y ? current : { x, y }));
    };
    place();
    const resize = new ResizeObserver(place);
    if (panel.current) resize.observe(panel.current);
    if (context.contentRef.current) resize.observe(context.contentRef.current);
    return () => resize.disconnect();
  }, [open, context.contentRef, context.subSide, sub.triggerRef]);

  useLayoutEffect(() => {
    if (!open || !position || !sub.focusFirst.current) return;
    sub.focusFirst.current = false;
    panel.current?.querySelector<HTMLElement>(ENABLED_ITEM)?.focus();
  }, [open, position, sub.focusFirst]);

  useEffect(
    () => () => {
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    },
    [],
  );

  if (!open) return null;

  const items = () => getEnabledItems(panel.current);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The panel is a React child of the root menu; its keys must not also move root focus.
    event.stopPropagation();
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      context.setOpenSub(null);
      sub.triggerRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      context.setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const list = items();
      if (list.length === 0) return;
      const current = list.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      list[current < 0 ? 0 : (current + step + list.length) % list.length]?.focus();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const list = items();
      list[event.key === "Home" ? 0 : list.length - 1]?.focus();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typeahead.current += event.key.toLocaleLowerCase();
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = setTimeout(() => {
        typeahead.current = "";
      }, 500);
      items()
        .find((item) =>
          (item.dataset.label ?? item.textContent ?? "")
            .trim()
            .toLocaleLowerCase()
            .startsWith(typeahead.current),
        )
        ?.focus();
    }
  };

  return createPortal(
    <div
      data-context-menu-owner={context.menuId}
      style={{
        left: position?.x ?? 0,
        top: position?.y ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
      className={cn(OVERLAY_LAYER.interactive, "fixed pointer-events-auto")}
    >
      <ContextMenuSubLevelContext.Provider value={true}>
        <div
          ref={panel}
          id={sub.id}
          role="menu"
          aria-label={ariaLabel}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onContextMenu={(event) => event.preventDefault()}
          className={cn(
            "min-w-56 max-w-[min(320px,calc(100vw-16px))] max-h-[calc(100dvh-16px)] overflow-y-auto space-y-0.5 rounded-lg border border-popover-border bg-menu p-1 text-popover-foreground shadow-(--shadow-overlay) outline-none",
            className,
          )}
        >
          {children}
        </div>
      </ContextMenuSubLevelContext.Provider>
    </div>,
    document.body,
  );
}

export interface ContextMenuCheckboxItemProps extends Omit<ContextMenuItemProps, "onSelect"> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function ContextMenuCheckboxItem({
  checked,
  onCheckedChange,
  children,
  ...props
}: ContextMenuCheckboxItemProps) {
  return (
    <ContextMenuItemBase
      {...props}
      role="menuitemcheckbox"
      ariaChecked={checked}
      onSelect={() => onCheckedChange?.(!checked)}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {checked ? <Check aria-hidden="true" className="size-3" strokeWidth={2.4} /> : null}
      </span>
      {children}
    </ContextMenuItemBase>
  );
}

interface ContextMenuRadioGroupContextValue {
  value: string;
  onValueChange?: (value: string) => void;
}

const ContextMenuRadioGroupContext = createContext<ContextMenuRadioGroupContextValue | null>(null);

export interface ContextMenuRadioGroupProps {
  value: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function ContextMenuRadioGroup({
  value,
  onValueChange,
  children,
  className,
}: ContextMenuRadioGroupProps) {
  const context = useMemo(() => ({ value, onValueChange }), [value, onValueChange]);
  return (
    <ContextMenuRadioGroupContext.Provider value={context}>
      <div className={cn("space-y-0.5", className)}>{children}</div>
    </ContextMenuRadioGroupContext.Provider>
  );
}

export interface ContextMenuRadioItemProps extends Omit<ContextMenuItemProps, "onSelect"> {
  value: string;
}

export function ContextMenuRadioItem({ value, children, ...props }: ContextMenuRadioItemProps) {
  const group = useContext(ContextMenuRadioGroupContext);
  if (!group) {
    throw new Error("ContextMenuRadioItem must be used within <ContextMenuRadioGroup>");
  }
  const checked = group.value === value;
  return (
    <ContextMenuItemBase
      {...props}
      role="menuitemradio"
      ariaChecked={checked}
      onSelect={() => group.onValueChange?.(value)}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full bg-current",
            checked ? "opacity-100" : "opacity-0",
          )}
        />
      </span>
      {children}
    </ContextMenuItemBase>
  );
}

export interface ContextMenuLabelProps {
  children: ReactNode;
  inset?: boolean;
  className?: string;
}

export function ContextMenuLabel({ children, inset = false, className }: ContextMenuLabelProps) {
  return (
    <div
      className={cn(
        "px-2 py-1 text-ui-sm font-medium text-muted-foreground",
        inset && "pl-8",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface ContextMenuSeparatorProps {
  className?: string;
}

export function ContextMenuSeparator({ className }: ContextMenuSeparatorProps) {
  return <hr className={cn("-mx-1 my-1 h-px border-0 bg-border", className)} />;
}
