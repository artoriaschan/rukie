import { useState } from "react";
import {
  Folder,
  FolderOpen,
  Search,
  Plus,
  ChevronDown,
  Pin,
  PinOff,
  Ellipsis,
  LoaderCircle,
} from "lucide-react";
import type { WireSessionSummary, WireProject, WirePreferences } from "@rukie/shared";
import { Button } from "./motion/button/base";
import { Tooltip } from "./motion/tooltip";
import * as Menu from "./ui/dropdown-menu";
import { useAppText } from "../lib/i18n";
import { sessionActions, SessionDropdownItems, SessionContextItems } from "./session-actions";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent } from "./motion/context-menu";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "radix-ui";
import { sessionGroups } from "../lib/session-groups";
import { cn } from "../lib/utils";

export interface SidebarProps {
  recent: WireSessionSummary[];
  projects: WireProject[];
  pinned: string[];
  archived: string[];
  preferences: WirePreferences;
  selected: string | null;
  ctrl: boolean;
  onSelect: (id: string) => void;
  onNew: (project: string | null) => void;
  onSearch: () => void;
  onAdd: () => void;
  onPin: (id: string, pinned: boolean) => void;
  onRename: (session: WireSessionSummary) => void;
  onArchive: (id: string) => void;
  onDelete: (session: WireSessionSummary) => void;
  onPreferences: (preferences: WirePreferences) => void;
}
export function Sidebar(props: SidebarProps) {
  const t = useAppText();
  const { preferences: p } = props;
  const [expandedProjects, setExpandedProjects] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<string[]>([]);
  const groups = p.collapsedGroups ?? [];
  const projectGroups = p.collapsedProjects ?? [];
  const toggle = (id: string) =>
    props.onPreferences({
      ...p,
      collapsedGroups: groups.includes(id)
        ? groups.filter((value) => value !== id)
        : [...groups, id],
    });
  const row = (session: WireSessionSummary) => {
    const pinned = props.pinned.includes(session.id);
    const shortcut = props.recent.findIndex((value) => value.id === session.id) + 1;
    const actions = sessionActions(
      session,
      pinned,
      props.onPin,
      props.onRename,
      props.onArchive,
      props.onDelete,
    );
    return (
      <ContextMenu key={session.id}>
        <ContextMenuTrigger>
          <div
            tabIndex={-1}
            className={cn(
              "group/row relative flex min-w-0 items-center rounded-lg px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-card",
              props.selected === session.id && "bg-card",
            )}
          >
            <button
              onClick={() => props.onSelect(session.id)}
              className="flex cursor-pointer active:bg-muted min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 min-h-8 text-left text-ui-base outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/row:pr-[68px] group-focus-within/row:pr-[68px]"
              aria-current={props.selected === session.id ? "page" : undefined}
            >
              {session.running && !session.waitingPermission ? (
                <LoaderCircle
                  aria-label={t("app.running")}
                  className="size-3 shrink-0 animate-spin motion-reduce:animate-none"
                />
              ) : session.waitingPermission ? (
                <span
                  aria-label={t("app.waiting")}
                  className="size-2 shrink-0 rounded-full bg-interaction-confirmation-foreground"
                />
              ) : null}
              <span className="session-row-title min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                {session.title}
              </span>
              {props.ctrl && shortcut > 0 && shortcut <= 9 ? (
                <kbd className="font-mono text-ui-xs">⌃{shortcut}</kbd>
              ) : null}
            </button>
            <div className="absolute right-1 flex items-center">
              <Tooltip content={t(pinned ? "app.unpin" : "app.pin")}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t(pinned ? "app.unpin" : "app.pin")} ${session.title}`}
                  className="min-h-7 min-w-7 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
                  onClick={() => props.onPin(session.id, !pinned)}
                >
                  {pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                </Button>
              </Tooltip>
              <Menu.DropdownMenu>
                <Menu.DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`${t("app.more")} ${session.title}`}
                    className="min-h-7 min-w-7 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100"
                  >
                    <Ellipsis className="size-4" />
                  </Button>
                </Menu.DropdownMenuTrigger>
                <Menu.DropdownMenuContent align="end">
                  <Menu.DropdownMenuGroup>
                    <SessionDropdownItems actions={actions} />
                  </Menu.DropdownMenuGroup>
                </Menu.DropdownMenuContent>
              </Menu.DropdownMenu>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent ariaLabel={t("app.more")}>
          <SessionContextItems actions={actions} />
        </ContextMenuContent>
      </ContextMenu>
    );
  };
  const section = (
    id: "pinned" | "conversations" | "projects",
    children: React.ReactNode,
    sessions: WireSessionSummary[],
  ) => (
    <section key={id} aria-label={t(`app.${id}`)} className="mb-3">
      <div className="group/header flex items-center gap-1 px-2">
        <button
          onClick={() => toggle(id)}
          aria-expanded={!groups.includes(id)}
          className="flex cursor-pointer active:bg-muted min-w-0 flex-1 items-center gap-1 py-1 min-h-7 text-left text-ui-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t(`app.${id}`)}
          <ChevronDown
            className={cn(
              "size-3 opacity-0 group-hover/header:opacity-100 group-focus-within/header:opacity-100",
              groups.includes(id) && "-rotate-90 opacity-100",
            )}
          />
        </button>
        {sessions.some((session) => session.running) ? (
          <LoaderCircle
            aria-label={t("app.running")}
            className="size-3 shrink-0 animate-spin motion-reduce:animate-none"
          />
        ) : null}
        <>
          <Menu.DropdownMenu>
            <Tooltip content={t("app.sidebar-options")}>
              <Menu.DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("app.sidebar-options")}
                  className="opacity-0 group-hover/header:opacity-100 group-focus-within/header:opacity-100 data-[state=open]:opacity-100"
                >
                  <Ellipsis className="size-4" />
                </Button>
              </Menu.DropdownMenuTrigger>
            </Tooltip>
            <Menu.DropdownMenuContent>
              <Menu.DropdownMenuGroup>
                <Menu.DropdownMenuSub>
                  <Menu.DropdownMenuSubTrigger>{t("app.organize")}</Menu.DropdownMenuSubTrigger>
                  <Menu.DropdownMenuSubContent>
                    <Menu.DropdownMenuItem
                      onSelect={() => props.onPreferences({ ...p, collapsedGroups: [] })}
                    >
                      {t("app.expand-all")}
                    </Menu.DropdownMenuItem>
                    <Menu.DropdownMenuItem
                      onSelect={() =>
                        props.onPreferences({
                          ...p,
                          collapsedGroups: ["pinned", "projects", "conversations"],
                        })
                      }
                    >
                      {t("app.collapse-all")}
                    </Menu.DropdownMenuItem>
                  </Menu.DropdownMenuSubContent>
                </Menu.DropdownMenuSub>
                <Menu.DropdownMenuSub>
                  <Menu.DropdownMenuSubTrigger>{t("app.sort")}</Menu.DropdownMenuSubTrigger>
                  <Menu.DropdownMenuSubContent>
                    <Menu.DropdownMenuRadioGroup
                      value={p.sort ?? "updated"}
                      onValueChange={(sort) =>
                        props.onPreferences({
                          ...p,
                          sort: sort === "created" ? "created" : "updated",
                        })
                      }
                    >
                      <Menu.DropdownMenuRadioItem value="updated">
                        {t("app.updated")}
                      </Menu.DropdownMenuRadioItem>
                      <Menu.DropdownMenuRadioItem value="created">
                        {t("app.created")}
                      </Menu.DropdownMenuRadioItem>
                    </Menu.DropdownMenuRadioGroup>
                  </Menu.DropdownMenuSubContent>
                </Menu.DropdownMenuSub>
                <Menu.DropdownMenuLabel>{t("app.show")}</Menu.DropdownMenuLabel>
                {(["showPinned", "showProjects", "showConversations"] as const).map((key, i) => (
                  <Menu.DropdownMenuCheckboxItem
                    key={key}
                    checked={p[key] !== false}
                    onCheckedChange={(value) => props.onPreferences({ ...p, [key]: value })}
                  >
                    {t((["app.pinned", "app.projects", "app.conversations"] as const)[i]!)}
                  </Menu.DropdownMenuCheckboxItem>
                ))}
              </Menu.DropdownMenuGroup>
            </Menu.DropdownMenuContent>
          </Menu.DropdownMenu>
          {id !== "pinned" ? (
            <Tooltip content={t(id === "projects" ? "app.add-project" : "app.new-session")}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t(id === "projects" ? "app.add-project" : "app.new-session")}
                className="opacity-0 group-hover/header:opacity-100 group-focus-within/header:opacity-100"
                onClick={() => (id === "projects" ? props.onAdd() : props.onNew(null))}
              >
                <Plus className="size-4" />
              </Button>
            </Tooltip>
          ) : null}
        </>
      </div>
      {!groups.includes(id) ? children : null}
    </section>
  );
  const navigation = sessionGroups(props.recent, props.projects, props.pinned, props.archived);
  return (
    <aside
      aria-label={t("app.home")}
      className="app-session-sidebar flex h-full min-h-0 shrink-0 flex-col p-2"
    >
      <div className="shrink-0 flex items-center gap-1 pb-2">
        <Button
          aria-label={t("app.new-chat")}
          variant="ghost"
          size="sm"
          className="min-w-0 flex-1 justify-start"
          onClick={() => props.onNew(null)}
        >
          <Plus className="size-4" />
          {t("app.new-chat")}
          <kbd className="ml-auto font-mono text-ui-xs">⌘N</kbd>
        </Button>
        <Tooltip content={t("app.search")}>
          <Button size="icon" variant="ghost" aria-label={t("app.search")} onClick={props.onSearch}>
            <Search className="size-4" />
          </Button>
        </Tooltip>
      </div>
      <Separator.Root
        decorative
        data-slot="separator"
        className="h-px shrink-0 mb-2 bg-(--layout-divider)"
      />
      <ScrollArea
        className="min-h-0 flex-1"
        viewportLabel={t("app.session-navigation")}
        // Prevent Radix's measuring table from adopting a long title's intrinsic width.
        viewportClassName="min-w-0 [contain:inline-size]"
      >
        {p.showPinned !== false && navigation.pinned.length > 0
          ? section("pinned", navigation.pinned.map(row), navigation.pinned)
          : null}
        {p.showProjects !== false
          ? section(
              "projects",
              <>
                {(expandedProjects ? navigation.projects : navigation.projects.slice(0, 5)).map(
                  ({ project, sessions }) => (
                    <div key={project.id}>
                      <div className="group/project flex items-center">
                        <button
                          aria-expanded={!projectGroups.includes(project.id)}
                          onClick={() =>
                            props.onPreferences({
                              ...p,
                              collapsedProjects: projectGroups.includes(project.id)
                                ? projectGroups.filter((id) => id !== project.id)
                                : [...projectGroups, project.id],
                            })
                          }
                          className="flex cursor-pointer active:bg-muted min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 min-h-8 text-left text-ui-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {projectGroups.includes(project.id) ? (
                            <Folder className="size-4" />
                          ) : (
                            <FolderOpen className="size-4" />
                          )}
                          <span className="truncate">{project.name}</span>
                        </button>
                        <Tooltip content={t("app.new-in-project", { project: project.name })}>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("app.new-in-project", { project: project.name })}
                            className="opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100"
                            onClick={() => props.onNew(project.id)}
                          >
                            <Plus className="size-4" />
                          </Button>
                        </Tooltip>
                      </div>
                      {!projectGroups.includes(project.id) ? (
                        <div className="pl-3">
                          {(expandedSessions.includes(project.id)
                            ? sessions
                            : sessions.slice(0, 5)
                          ).map(row)}
                          {sessions.length > 5 && !expandedSessions.includes(project.id) ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={t("app.show-more-group", { group: project.name })}
                              onClick={() => setExpandedSessions([...expandedSessions, project.id])}
                            >
                              {t("app.show-more")}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ),
                )}
                {navigation.projects.length > 5 && !expandedProjects ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("app.show-more-group", { group: t("app.projects") })}
                    onClick={() => setExpandedProjects(true)}
                  >
                    {t("app.show-more")}
                  </Button>
                ) : null}
              </>,
              navigation.projects.flatMap((group) => group.sessions),
            )
          : null}
        {p.showConversations !== false
          ? section("conversations", navigation.conversations.map(row), navigation.conversations)
          : null}
      </ScrollArea>
    </aside>
  );
}
