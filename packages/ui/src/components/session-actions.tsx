import {
  Archive,
  Check,
  Folder,
  FolderOpen,
  MessageCircle,
  Trash2,
  Pencil,
  Pin,
  PinOff,
  type LucideIcon,
} from "lucide-react";
import { Fragment } from "react";
import type { WireProject, WireSessionSummary } from "@rukie/shared";
import { useAppText } from "../lib/i18n";
import * as Menu from "./ui/dropdown-menu";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "./motion/context-menu";

interface SessionMoveTarget {
  id: string;
  /** A Project name is shown verbatim; fixed entries are localized copy. */
  label: { name: string } | { copy: "app.choose-folder" | "app.move-out" };
  icon: LucideIcon;
  /** The Session's own Project: listed, checked and not selectable. */
  current?: boolean;
  separator?: boolean;
  onSelect: () => void;
}

interface SessionAction {
  id: string;
  label:
    | "app.rename"
    | "app.pin"
    | "app.unpin"
    | "app.archive"
    | "app.delete-session"
    | "app.move-project";
  icon: LucideIcon;
  disabled: boolean;
  destructive: boolean;
  separator?: boolean;
  onSelect?: () => void;
  targets?: SessionMoveTarget[];
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
  onMove: (session: WireSessionSummary, project: WireProject | null) => void,
  onChooseFolder: (session: WireSessionSummary) => void,
): SessionAction[] {
  const busy = Boolean(session.running || session.waitingPermission);
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
      disabled: busy,
      destructive: false,
      onSelect: () => onArchive(session.id),
    },
    {
      id: "move",
      label: "app.move-project",
      icon: Folder,
      disabled: Boolean(session.worktree) || busy,
      destructive: false,
      targets: [
        ...projects.map((project) => ({
          id: project.id,
          label: { name: project.name },
          icon: Folder,
          current: project.id === session.projectId,
          onSelect: () => onMove(session, project),
        })),
        {
          id: "choose-folder",
          label: { copy: "app.choose-folder" },
          icon: FolderOpen,
          separator: true,
          onSelect: () => onChooseFolder(session),
        },
        ...(session.projectId
          ? [
              {
                id: "move-out",
                label: { copy: "app.move-out" } as const,
                icon: MessageCircle,
                onSelect: () => onMove(session, null),
              },
            ]
          : []),
      ],
    },
    {
      id: "delete",
      label: "app.delete-session",
      icon: Trash2,
      disabled: busy,
      destructive: true,
      separator: true,
      onSelect: () => onDelete(session),
    },
  ];
}

function useTargetLabel() {
  const t = useAppText();
  return (target: SessionMoveTarget) =>
    "name" in target.label ? target.label.name : t(target.label.copy);
}

export function SessionDropdownItems({ actions }: { actions: SessionAction[] }) {
  const t = useAppText();
  const label = useTargetLabel();
  return actions.map((action) => (
    <Fragment key={action.id}>
      {action.separator ? <Menu.DropdownMenuSeparator /> : null}
      {action.targets ? (
        <Menu.DropdownMenuSub>
          <Menu.DropdownMenuSubTrigger disabled={action.disabled}>
            <action.icon />
            {t(action.label)}
          </Menu.DropdownMenuSubTrigger>
          <Menu.DropdownMenuSubContent className="min-w-56">
            <Menu.DropdownMenuGroup>
              {action.targets.map((target) => (
                <Fragment key={target.id}>
                  {target.separator ? <Menu.DropdownMenuSeparator /> : null}
                  <Menu.DropdownMenuItem
                    disabled={action.disabled || target.current}
                    aria-current={target.current ? "true" : undefined}
                    onSelect={target.onSelect}
                  >
                    <target.icon />
                    <span className="min-w-0 flex-1 truncate">{label(target)}</span>
                    {target.current ? <Check aria-hidden="true" /> : null}
                  </Menu.DropdownMenuItem>
                </Fragment>
              ))}
            </Menu.DropdownMenuGroup>
          </Menu.DropdownMenuSubContent>
        </Menu.DropdownMenuSub>
      ) : (
        <Menu.DropdownMenuItem
          disabled={action.disabled}
          variant={action.destructive ? "destructive" : "default"}
          onSelect={action.onSelect}
        >
          <action.icon />
          {t(action.label)}
        </Menu.DropdownMenuItem>
      )}
    </Fragment>
  ));
}

export function SessionContextItems({ actions }: { actions: SessionAction[] }) {
  const t = useAppText();
  const label = useTargetLabel();
  return actions.map((action) => (
    <Fragment key={action.id}>
      {action.separator ? <ContextMenuSeparator /> : null}
      {action.targets ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={action.disabled} textValue={t(action.label)}>
            <action.icon aria-hidden="true" className="size-4 shrink-0" />
            {t(action.label)}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent ariaLabel={t(action.label)}>
            {action.targets.map((target) => (
              <Fragment key={target.id}>
                {target.separator ? <ContextMenuSeparator /> : null}
                <ContextMenuItem
                  disabled={action.disabled || target.current}
                  ariaCurrent={target.current}
                  onSelect={target.onSelect}
                  textValue={label(target)}
                >
                  <target.icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{label(target)}</span>
                  {target.current ? <Check aria-hidden="true" className="size-3 shrink-0" /> : null}
                </ContextMenuItem>
              </Fragment>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : (
        <ContextMenuItem
          disabled={action.disabled}
          tone={action.destructive ? "destructive" : "default"}
          onSelect={action.onSelect}
        >
          <action.icon aria-hidden="true" className="size-4 shrink-0" />
          {t(action.label)}
        </ContextMenuItem>
      )}
    </Fragment>
  ));
}
