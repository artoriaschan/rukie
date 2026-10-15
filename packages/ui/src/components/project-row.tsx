import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  Folder,
  FolderOpen,
  MessageCircle,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings,
  SlidersHorizontal,
  SquarePen,
  Trash2,
} from "lucide-react";
import type { WireProject } from "@rukie/shared";
import { Button } from "./motion/button/base";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./motion/context-menu";
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
  /** C23 right-click actions; the Project pin is navigation state, not the detail-card pin. */
  projectPinned: boolean;
  onProjectPin: (pinned: boolean) => void;
  onRename: () => void;
  onReveal: () => void;
  onRemove: () => void;
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
  const menuOpen = useRef(false);
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
    if (props.open || props.disabled || menuOpen.current || openTimer.current !== null) return;
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
    if (pointerFocus.current || props.disabled || menuOpen.current) return;
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
      <ContextMenu
        onOpenChange={(open) => {
          menuOpen.current = open;
          if (!open) return;
          cancelOpen();
          // The menu replaces transient hover details; a pinned card stays until dismissed.
          if (props.open && !pinned.current) changeOpen(false);
        }}
      >
        <ContextMenuTrigger>
          <div
            ref={anchor}
            tabIndex={-1}
            data-project-row={props.project.id}
            className={cn(
              "group/project flex min-w-0 items-center rounded-lg row-hover:bg-hover",
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
            onFocus={(event) => {
              // Closing the menu restores focus to this row container; return it to the disclosure.
              if (event.target === anchor.current) {
                suppressFocus.current = true;
                disclosure.current?.focus();
                return;
              }
              focus();
            }}
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
              className="flex cursor-pointer min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 min-h-8 text-left text-ui-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {props.expanded ? (
                <FolderOpen className="size-3 shrink-0" />
              ) : (
                <Folder className="size-3 shrink-0" />
              )}
              <span className="truncate">{props.project.name}</span>
            </button>
            <Tooltip content={t("app.new-in-project", { project: props.project.name })}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("app.new-in-project", { project: props.project.name })}
                className="mr-1 opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100"
                onClick={() => {
                  dismiss();
                  props.onNew();
                }}
              >
                <Plus />
              </Button>
            </Tooltip>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent ariaLabel={t("app.project-actions")}>
          <ContextMenuItem onSelect={props.onRename}>
            <Pencil aria-hidden="true" className="size-3 shrink-0" />
            {t("app.rename")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={props.onEdit}>
            <SlidersHorizontal aria-hidden="true" className="size-3 shrink-0" />
            {t("app.edit-project-menu")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => props.onProjectPin(!props.projectPinned)}>
            {props.projectPinned ? (
              <PinOff aria-hidden="true" className="size-3 shrink-0" />
            ) : (
              <Pin aria-hidden="true" className="size-3 shrink-0" />
            )}
            {t(props.projectPinned ? "app.unpin" : "app.pin")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={props.onNew}>
            <SquarePen aria-hidden="true" className="size-3 shrink-0" />
            {t("app.new-chat-in-project")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={props.onReveal}>
            <FolderOpen aria-hidden="true" className="size-3 shrink-0" />
            {t("app.open-in-finder")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem tone="destructive" onSelect={props.onRemove}>
            <Trash2 aria-hidden="true" className="size-3 shrink-0" />
            {t("app.delete-project")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent
        ref={panel}
        ariaLabel={t("app.project-details")}
        className="w-[320px] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] flex flex-col gap-1.5"
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
        <div className="mx-1.5 mt-1.5 flex min-w-0 items-center gap-2 min-h-7">
          <Folder className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 break-words text-ui-lg font-medium">
            {props.project.name}
          </span>
          <Button
            variant="ghost"
            size="icon"
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
            {isPinned ? <PinOff /> : <Pin />}
          </Button>
        </div>
        <div className="mx-1.5 flex items-center gap-2 text-ui-base">
          <MessageCircle className="size-3 shrink-0 text-muted-foreground" />
          {t("app.project-session-count", { count: props.count })}
        </div>
        <div role="separator" className="h-px shrink-0 bg-border" />
        <div className="mx-1.5 flex flex-col gap-2">
          {props.project.directories.map((path) => (
            <div key={path} className="flex items-start gap-2">
              <Folder className="size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 select-text break-all font-mono text-ui-base">
                {projectPath(path, props.homeDir)}
              </span>
            </div>
          ))}
        </div>
        <div role="separator" className="h-px shrink-0 bg-border" />
        <Button
          variant="ghost"
          className="mx-1.5 mb-1.5 justify-start"
          onClick={() => {
            dismiss();
            props.onEdit();
          }}
        >
          <Settings className="size-3 text-muted-foreground" />
          {t("app.edit-project")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
