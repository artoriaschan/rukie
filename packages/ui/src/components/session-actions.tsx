import {
  Archive,
  Trash2,
  Pencil,
  Pin,
  PinOff,
  FolderInput,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { WireProject, WireSessionSummary } from "@rukie/shared";
import { useAppText } from "../lib/i18n";
import * as Menu from "./ui/dropdown-menu";
import { ContextMenuItem } from "./motion/context-menu";

interface SessionAction {
  id: string;
  label: "app.rename" | "app.pin" | "app.unpin" | "app.archive" | "app.delete" | "app.move-project";
  icon: LucideIcon;
  disabled: boolean;
  destructive: boolean;
  onSelect?: () => void;
  targets?: { id: string; name: string; onSelect: () => void }[];
}

/** All Session menu entries are derived here; presentation chooses its menu primitive. */
export function sessionActions(
  session: WireSessionSummary,
  pinned: boolean,
  onPin: (id: string, pinned: boolean) => void,
  onRename: (session: WireSessionSummary) => void,
  onArchive: (id: string) => void,
  onDelete: (session: WireSessionSummary) => void,
  projects: WireProject[],
  onMove: (session: WireSessionSummary, project: WireProject) => void,
): SessionAction[] {
  const targets = projects.filter((project) => project.id !== session.projectId);
  return [
    {
      id: "rename",
      label: "app.rename",
      icon: Pencil,
      disabled: false,
      destructive: false,
      onSelect: () => onRename(session),
    },
    {
      id: "pin",
      label: pinned ? "app.unpin" : "app.pin",
      icon: pinned ? PinOff : Pin,
      disabled: false,
      destructive: false,
      onSelect: () => onPin(session.id, !pinned),
    },
    {
      id: "move",
      label: "app.move-project",
      icon: FolderInput,
      disabled: Boolean(session.running || session.waitingPermission || !targets.length),
      destructive: false,
      targets: targets.map((project) => ({
        id: project.id,
        name: project.name,
        onSelect: () => onMove(session, project),
      })),
    },
    {
      id: "archive",
      label: "app.archive",
      icon: Archive,
      disabled: Boolean(session.running || session.waitingPermission),
      destructive: false,
      onSelect: () => onArchive(session.id),
    },
    {
      id: "delete",
      label: "app.delete",
      icon: Trash2,
      disabled: Boolean(session.running || session.waitingPermission),
      destructive: true,
      onSelect: () => onDelete(session),
    },
  ];
}

export function SessionDropdownItems({ actions }: { actions: SessionAction[] }) {
  const t = useAppText();
  return actions.map((action) =>
    action.targets ? (
      <Menu.DropdownMenuSub key={action.id}>
        <Menu.DropdownMenuSubTrigger disabled={action.disabled}>
          <action.icon />
          {t(action.label)}
        </Menu.DropdownMenuSubTrigger>
        <Menu.DropdownMenuSubContent>
          <Menu.DropdownMenuGroup>
            {action.targets.map((target) => (
              <Menu.DropdownMenuItem
                key={target.id}
                disabled={action.disabled}
                onSelect={target.onSelect}
              >
                {target.name}
              </Menu.DropdownMenuItem>
            ))}
          </Menu.DropdownMenuGroup>
        </Menu.DropdownMenuSubContent>
      </Menu.DropdownMenuSub>
    ) : (
      <Menu.DropdownMenuItem
        key={action.id}
        disabled={action.disabled}
        variant={action.destructive ? "destructive" : "default"}
        onSelect={action.onSelect}
      >
        <action.icon />
        {t(action.label)}
      </Menu.DropdownMenuItem>
    ),
  );
}

export function SessionContextItems({ actions }: { actions: SessionAction[] }) {
  const t = useAppText();
  return actions.map((action) =>
    action.targets ? (
      <SessionContextTargets key={action.id} action={action} />
    ) : (
      <ContextMenuItem
        key={action.id}
        disabled={action.disabled}
        tone={action.destructive ? "destructive" : "default"}
        onSelect={action.onSelect}
      >
        <action.icon aria-hidden="true" className="size-4 shrink-0" />
        {t(action.label)}
      </ContextMenuItem>
    ),
  );
}

/** beUI context menu has no Sub API; compose its items in a keyboard-accessible nested group. */
function SessionContextTargets({ action }: { action: SessionAction }) {
  const t = useAppText();
  const [open, setOpen] = useState(false);
  const group = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (open) group.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" && !open && !action.disabled) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }
        if ((event.key === "ArrowLeft" || event.key === "Escape") && open) {
          event.preventDefault();
          event.stopPropagation();
          group.current?.parentElement?.querySelector<HTMLButtonElement>("button")?.focus();
          setOpen(false);
        }
      }}
    >
      <ContextMenuItem
        disabled={action.disabled}
        closeOnSelect={false}
        onSelect={() => setOpen(!open)}
        ariaHasPopup="menu"
        ariaExpanded={open}
      >
        <action.icon aria-hidden="true" className="size-4 shrink-0" />
        {t(action.label)}
        <ChevronRight aria-hidden="true" className="ml-auto size-4" />
      </ContextMenuItem>
      {open ? (
        <div ref={group} role="menu" aria-label={t(action.label)} className="pl-4">
          {action.targets?.map((target) => (
            <ContextMenuItem
              key={target.id}
              disabled={action.disabled}
              onSelect={target.onSelect}
              textValue={target.name}
            >
              {target.name}
            </ContextMenuItem>
          ))}
        </div>
      ) : null}
    </div>
  );
}
