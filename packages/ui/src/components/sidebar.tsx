import { useLayoutEffect, useRef, useState } from "react";
import { Search, Plus, ChevronDown, Pin, PinOff, Ellipsis, LoaderCircle } from "lucide-react";
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
import { ProjectRow } from "./project-row";
import { cn } from "../lib/utils";

export interface SidebarProps {
  recent: WireSessionSummary[];
  homeDir: string | null;
  detailProject: { id: string; pinned: boolean } | null;
  detailsDisabled: boolean;
  detailEpoch: number;
  onDetailProject: (id: string, open: boolean) => void;
  onDetailPin: (id: string, pinned: boolean) => void;
  onEditProject: (project: WireProject | null) => void;
  onRenameProject: (project: WireProject) => void;
  onRevealProject: (project: WireProject) => void;
  onRemoveProject: (project: WireProject) => void;
  projects: WireProject[];
  pinned: string[];
  archived: string[];
  preferences: WirePreferences;
  selected: string | null;
  onSelect: (id: string) => void;
  onNew: (project: string | null) => void;
  onSearch: () => void;
  onAdd: () => void;
  onPin: (id: string, pinned: boolean) => void;
  onRename: (session: WireSessionSummary) => void;
  onArchive: (id: string) => void;
  onDelete: (session: WireSessionSummary) => void;
  onChooseFolder: (session: WireSessionSummary) => void;
  onMove: (session: WireSessionSummary, project: WireProject | null) => void;
  onPreferences: (preferences: WirePreferences) => void;
}
export function Sidebar(props: SidebarProps) {
  const t = useAppText();
  const scrollArea = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => {
    const viewport = scrollArea.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (!viewport) return;
    const measure = () =>
      setScrolled(viewport.scrollHeight > viewport.clientHeight && viewport.scrollTop > 0);
    const resize = new ResizeObserver(measure);
    resize.observe(viewport);
    if (viewport.firstElementChild) resize.observe(viewport.firstElementChild);
    viewport.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      resize.disconnect();
      viewport.removeEventListener("scroll", measure);
    };
  }, []);
  const { preferences: p } = props;
  const [expandedProjects, setExpandedProjects] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<string[]>([]);
  const groups = p.collapsedGroups ?? [];
  const projectGroups = p.collapsedProjects ?? [];
  const pinnedProjects = p.pinnedProjects ?? [];
  const toggle = (id: string) =>
    props.onPreferences({
      ...p,
      collapsedGroups: groups.includes(id)
        ? groups.filter((value) => value !== id)
        : [...groups, id],
    });
  const row = (session: WireSessionSummary) => {
    const pinned = props.pinned.includes(session.id);
    const actions = sessionActions(
      session,
      pinned,
      props.onPin,
      props.onRename,
      props.onArchive,
      props.onDelete,
      props.projects,
      props.onMove,
      props.onChooseFolder,
    );
    return (
      <ContextMenu key={session.id}>
        <ContextMenuTrigger>
          <div
            tabIndex={-1}
            className="group/row relative flex min-w-0 items-center rounded-lg px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring row-hover:bg-hover"
          >
            <button
              onClick={() => props.onSelect(session.id)}
              className="flex cursor-pointer min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 min-h-8 text-left text-ui-base outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/row:pr-[60px] group-focus-within/row:pr-[60px]"
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
            </button>
            <div className="absolute right-1 flex items-center">
              <Tooltip content={t(pinned ? "app.unpin" : "app.pin")}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t(pinned ? "app.unpin" : "app.pin")} ${session.title}`}
                  className="opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
                  onClick={() => props.onPin(session.id, !pinned)}
                >
                  {pinned ? <PinOff /> : <Pin />}
                </Button>
              </Tooltip>
              <Menu.DropdownMenu>
                <Menu.DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`${t("app.more")} ${session.title}`}
                    className="opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100"
                  >
                    <Ellipsis />
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
          className="flex cursor-pointer min-w-0 flex-1 items-center gap-1 py-1 min-h-7 text-left text-ui-base text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  <Ellipsis />
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
                <Plus />
              </Button>
            </Tooltip>
          ) : null}
        </>
      </div>
      {!groups.includes(id) ? children : null}
    </section>
  );
  const projectGroup = ({
    project,
    sessions,
  }: {
    project: WireProject;
    sessions: WireSessionSummary[];
  }) => (
    <div key={project.id} role="group" aria-label={project.name}>
      <ProjectRow
        resetKey={props.detailEpoch}
        project={project}
        homeDir={props.homeDir}
        count={
          props.recent.filter(
            (session) => project.id === session.projectId && !props.archived.includes(session.id),
          ).length
        }
        selected={props.recent.some(
          (session) => session.id === props.selected && project.id === session.projectId,
        )}
        expanded={!projectGroups.includes(project.id)}
        open={props.detailProject?.id === project.id}
        pinned={props.detailProject?.id === project.id && props.detailProject.pinned}
        disabled={
          props.detailsDisabled ||
          (Boolean(props.detailProject?.pinned) && props.detailProject?.id !== project.id)
        }
        onOpenChange={(open) => props.onDetailProject(project.id, open)}
        onPinChange={(pinned) => props.onDetailPin(project.id, pinned)}
        onToggle={() =>
          props.onPreferences({
            ...p,
            collapsedProjects: projectGroups.includes(project.id)
              ? projectGroups.filter((id) => id !== project.id)
              : [...projectGroups, project.id],
          })
        }
        onNew={() => props.onNew(project.id)}
        onEdit={() => props.onEditProject(project)}
        projectPinned={pinnedProjects.includes(project.id)}
        onProjectPin={(pin) =>
          props.onPreferences({
            ...p,
            pinnedProjects: pin
              ? [...pinnedProjects.filter((id) => id !== project.id), project.id]
              : pinnedProjects.filter((id) => id !== project.id),
          })
        }
        onRename={() => props.onRenameProject(project)}
        onReveal={() => props.onRevealProject(project)}
        onRemove={() => props.onRemoveProject(project)}
      />
      {!projectGroups.includes(project.id) ? (
        <div className="pl-3">
          {(expandedSessions.includes(project.id) ? sessions : sessions.slice(0, 5)).map(row)}
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
  );
  const navigation = sessionGroups(
    props.recent,
    props.projects,
    props.pinned,
    props.archived,
    pinnedProjects,
  );
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
          <Plus className="size-3" />
          {t("app.new-chat")}
        </Button>
        <Tooltip content={t("app.search")}>
          <Button size="icon" variant="ghost" aria-label={t("app.search")} onClick={props.onSearch}>
            <Search />
          </Button>
        </Tooltip>
      </div>
      <Separator.Root
        decorative
        data-slot="separator"
        className="h-px shrink-0 mb-2 bg-(--layout-divider)"
        style={{ opacity: scrolled ? 1 : 0 }}
      />
      <ScrollArea
        ref={scrollArea}
        className="min-h-0 flex-1"
        viewportLabel={t("app.session-navigation")}
        // Prevent Radix's measuring table from adopting a long title's intrinsic width.
        viewportClassName="min-w-0 [contain:inline-size]"
      >
        {p.showPinned !== false &&
        (navigation.pinnedProjects.length > 0 || navigation.pinned.length > 0)
          ? section(
              "pinned",
              <>
                {navigation.pinnedProjects.map(projectGroup)}
                {navigation.pinned.map(row)}
              </>,
              [
                ...navigation.pinnedProjects.flatMap((group) => group.sessions),
                ...navigation.pinned,
              ],
            )
          : null}
        {p.showProjects !== false
          ? section(
              "projects",
              <>
                {(expandedProjects ? navigation.projects : navigation.projects.slice(0, 5)).map(
                  projectGroup,
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
