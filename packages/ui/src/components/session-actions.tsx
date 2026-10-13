import { Pencil, Pin, PinOff, type LucideIcon } from "lucide-react";
import type { WireSessionSummary } from "@rukie/shared";
import { useAppText } from "../lib/i18n";
import * as Menu from "./ui/dropdown-menu";
import { ContextMenuItem } from "./motion/context-menu";

interface SessionAction {
  id: string;
  label: "app.rename" | "app.pin" | "app.unpin";
  icon: LucideIcon;
  disabled: boolean;
  destructive: boolean;
  onSelect: () => void;
  shortcut?: string;
}

/** All Session menu entries are derived here; presentation chooses its menu primitive. */
export function sessionActions(
  session: WireSessionSummary,
  pinned: boolean,
  onPin: (id: string, pinned: boolean) => void,
  onRename: (session: WireSessionSummary) => void,
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
      shortcut: "⌥⌘P",
    },
  ];
}

export function SessionDropdownItems({
  actions,
  shortcuts = false,
}: {
  actions: SessionAction[];
  shortcuts?: boolean;
}) {
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
      {shortcuts && action.shortcut ? (
        <Menu.DropdownMenuShortcut>{action.shortcut}</Menu.DropdownMenuShortcut>
      ) : null}
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
