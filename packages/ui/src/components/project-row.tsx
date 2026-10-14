import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Folder, FolderOpen, MessageCircle, Pin, PinOff, Plus, Settings } from "lucide-react";
import type { WireProject } from "@rukie/shared";
import { Button } from "./motion/button/base";
import { Popover, PopoverContent } from "./motion/popover";
import { Tooltip } from "./motion/tooltip";
import { useHoverGesture } from "../lib/hooks/use-hover-gesture";
import { useAppText } from "../lib/i18n";
import { cn } from "../lib/utils";
import { projectPath } from "../lib/project-path";

interface ProjectRowProps {
  project: WireProject;
  resetKey: number;
  count: number;
  homeDir: string | null;
  selected: boolean;
  expanded: boolean;
  open: boolean;
  pinned: boolean;
  onPinChange: (pinned: boolean) => void;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: () => void;
  onNew: () => void;
  onEdit: () => void;
}

export function ProjectRow(props: ProjectRowProps) {
  const t = useAppText();
  const anchor = useRef<HTMLDivElement>(null);
  const disclosure = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const isPinned = props.pinned;
  useLayoutEffect(() => {
    pinned.current = props.pinned;
  }, [props.pinned]);
  const pointerFocus = useRef(false);
  const hovering = useRef(false);
  const suppressFocus = useRef(false);
  const enterPanel = useRef(false);
  const rowHover = useHoverGesture();
  const panelHover = useHoverGesture();
  const changeOpen = props.onOpenChange;
  const cancelOpen = useCallback(() => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const dismiss = useCallback(() => {
    cancelOpen();
    cancelClose();
    suppressFocus.current = Boolean(panel.current?.contains(document.activeElement));
    hovering.current = false;
    pinned.current = false;
    changeOpen(false);
  }, [cancelOpen, cancelClose, changeOpen]);
  const focusedInside = useCallback(
    () =>
      Boolean(
        anchor.current?.contains(document.activeElement) ||
        panel.current?.contains(document.activeElement),
      ),
    [],
  );
  const leave = useCallback(
    (blurring = false) => {
      cancelOpen();
      if (pinned.current || (!blurring && focusedInside()) || closeTimer.current !== null) return;
      closeTimer.current = setTimeout(() => {
        closeTimer.current = null;
        if (!pinned.current && !focusedInside() && !hovering.current) changeOpen(false);
      }, 150);
    },
    [cancelOpen, focusedInside, changeOpen],
  );
  const enter = () => {
    cancelClose();
    suppressFocus.current = false;
    if (props.open || props.disabled || openTimer.current !== null) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      changeOpen(true);
    }, 300);
  };
  useEffect(
    () => () => {
      cancelOpen();
      cancelClose();
    },
    [cancelOpen, cancelClose],
  );
  useEffect(() => {
    hovering.current = false;
    cancelOpen();
    cancelClose();
  }, [props.resetKey, cancelOpen, cancelClose]);
  useLayoutEffect(() => {
    if (props.open && enterPanel.current) {
      enterPanel.current = false;
      panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
  }, [props.open]);
  useEffect(() => {
    if (props.open && !props.disabled) return;
    cancelOpen();
    cancelClose();
    pinned.current = false;
    // A parent may suspend the portal while opening a modal or changing views.
    if (panel.current?.contains(document.activeElement)) {
      suppressFocus.current = true;
      disclosure.current?.focus();
    }
  }, [props.open, props.disabled, cancelOpen, cancelClose]);
  useEffect(() => {
    if (!props.open) return;
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const row = anchor.current?.getBoundingClientRect();
      const card = panel.current?.getBoundingClientRect();
      if (!row || !card) return;
      const inside = (box: DOMRect) =>
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      // The measured gap stays interactive even if the pointer rests there beyond the grace period.
      const corridor =
        event.clientX >= row.right &&
        event.clientX <= card.left &&
        event.clientY >= Math.max(row.top, card.top) &&
        event.clientY <= Math.min(row.bottom, card.bottom);
      hovering.current = inside(row) || inside(card) || corridor;
      if (hovering.current) cancelClose();
      else leave();
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [props.open, cancelClose, leave]);
  const focus = () => {
    cancelClose();
    if (suppressFocus.current) {
      suppressFocus.current = false;
      return;
    }
    if (pointerFocus.current || props.disabled) return;
    cancelOpen();
    changeOpen(true);
  };
  const blur = (event: React.FocusEvent) => {
    if (
      event.relatedTarget instanceof Node &&
      (anchor.current?.contains(event.relatedTarget) ||
        panel.current?.contains(event.relatedTarget))
    )
      return;
    suppressFocus.current = false;
    leave(true);
  };
  return (
    <Popover
      open={props.open && !props.disabled}
      onOpenChange={(open) => (open ? changeOpen(true) : dismiss())}
      trigger="manual"
      side="right"
      align="start"
      sideOffset={4}
      anchorRef={anchor}
      restoreFocusRef={disclosure}
      className="block w-full"
    >
      <div
        ref={anchor}
        data-project-row={props.project.id}
        className={cn(
          "group/project flex min-w-0 items-center rounded-lg hover:bg-hover",
          props.selected && "bg-selected",
        )}
        onPointerEnter={(event) => {
          if (rowHover.enter(event)) {
            hovering.current = true;
            enter();
          }
        }}
        onPointerLeave={(event) => {
          pointerFocus.current = false;
          if (rowHover.leave(event)) {
            hovering.current = false;
            leave();
          }
        }}
        onPointerDown={() => {
          pointerFocus.current = true;
        }}
        onPointerUp={() => {
          pointerFocus.current = false;
        }}
        onPointerCancel={() => {
          pointerFocus.current = false;
        }}
        onFocus={focus}
        onBlur={blur}
        onKeyDown={(event) => {
          pointerFocus.current = false;
          if (event.key === "ArrowRight" && !props.disabled) {
            event.preventDefault();
            suppressFocus.current = false;
            enterPanel.current = !props.open;
            changeOpen(true);
            panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
          }
        }}
      >
        <button
          ref={disclosure}
          aria-expanded={props.expanded}
          onClick={props.onToggle}
          className="flex cursor-pointer active:bg-muted min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 min-h-8 text-left text-ui-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {props.expanded ? (
            <FolderOpen className="size-4 shrink-0" />
          ) : (
            <Folder className="size-4 shrink-0" />
          )}
          <span className="truncate">{props.project.name}</span>
        </button>
        <Tooltip content={t("app.new-in-project", { project: props.project.name })}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("app.new-in-project", { project: props.project.name })}
            className="shrink-0 opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100"
            onClick={() => {
              dismiss();
              props.onNew();
            }}
          >
            <Plus className="size-4" />
          </Button>
        </Tooltip>
      </div>
      <PopoverContent
        ref={panel}
        ariaLabel={t("app.project-details")}
        className="w-[320px] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] p-4 flex flex-col gap-3"
        onFocus={() => cancelClose()}
        onBlur={blur}
        onPointerEnter={(event) => {
          if (panelHover.enter(event)) {
            hovering.current = true;
            cancelClose();
          }
        }}
        onPointerLeave={(event) => {
          if (panelHover.leave(event)) {
            hovering.current = false;
            leave();
          }
        }}
      >
        <div className="flex min-w-0 items-center gap-2 min-h-7">
          <Folder className="size-5 shrink-0" />
          <span className="min-w-0 flex-1 break-words text-ui-lg font-medium">
            {props.project.name}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 min-h-7 min-w-7 shrink-0"
            aria-label={t(isPinned ? "app.unpin-details" : "app.pin-details")}
            aria-pressed={isPinned}
            onClick={() => {
              if (pinned.current) {
                dismiss();
                disclosure.current?.focus();
              } else {
                pinned.current = true;
                props.onPinChange(true);
                cancelClose();
              }
            }}
          >
            {isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </Button>
        </div>
        <div className="flex items-center gap-2 text-ui-base">
          <MessageCircle className="size-4 shrink-0 text-muted-foreground" />
          {t("app.project-session-count", { count: props.count })}
        </div>
        <div className="h-px shrink-0 bg-border" />
        <div className="flex flex-col gap-2">
          {props.project.directories.map((path) => (
            <div key={path} className="flex items-start gap-2">
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 select-text break-all font-mono text-ui-base">
                {projectPath(path, props.homeDir)}
              </span>
            </div>
          ))}
        </div>
        <div className="h-px shrink-0 bg-border" />
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => {
            dismiss();
            props.onEdit();
          }}
        >
          <Settings className="size-4 text-muted-foreground" />
          {t("app.edit-project")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
