import { Archive, Trash2, Pencil, Pin, PinOff, type LucideIcon } from "lucide-react";
import type { WireSessionSummary } from "@rukie/shared";
import { useAppText } from "../lib/i18n";
import * as Menu from "./ui/dropdown-menu";
import { ContextMenuItem } from "./motion/context-menu";

interface SessionAction {
  id: string;
  label: "app.rename" | "app.pin" | "app.unpin" | "app.archive" | "app.delete";
  icon: LucideIcon;
  disabled: boolean;
  destructive: boolean;
  onSelect: () => void;
}

/** All Session menu entries are derived here; presentation chooses its menu primitive. */
export function sessionActions(
  session: WireSessionSummary,
  pinned: boolean,
  onPin: (id: string, pinned: boolean) => void,
  onRename: (session: WireSessionSummary) => void,
  onArchive: (id: string) => void,
  onDelete: (session: WireSessionSummary) => void,
): SessionAction[] {
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
  return actions.map((action) => (
    <Menu.DropdownMenuItem
      key={action.id}
      disabled={action.disabled}
      variant={action.destructive ? "destructive" : "default"}
      onSelect={action.onSelect}
    >
      <action.icon />
      {t(action.label)}
    </Menu.DropdownMenuItem>
  ));
}

export function SessionContextItems({ actions }: { actions: SessionAction[] }) {
  const t = useAppText();
  return actions.map((action) => (
    <ContextMenuItem
      key={action.id}
      disabled={action.disabled}
      tone={action.destructive ? "destructive" : "default"}
      onSelect={action.onSelect}
    >
      <action.icon aria-hidden="true" className="size-4 shrink-0" />
      {t(action.label)}
    </ContextMenuItem>
  ));
}
