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
import { cn } from "../lib/utils";

export interface SidebarProps {
  sessions: WireSessionSummary[];
  recent: WireSessionSummary[];
  projects: WireProject[];
  pinned: string[];
  preferences: WirePreferences;
  selected: string | null;
  ctrl: boolean;
  onSelect: (id: string) => void;
  onNew: (project: string | null) => void;
  onSearch: () => void;
  onAdd: () => void;
  onPin: (id: string, pinned: boolean) => void;
  onPreferences: (preferences: WirePreferences) => void;
}
export function Sidebar(props: SidebarProps) {
  const t = useAppText();
  const { preferences: p } = props;
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
    return (
      <div
        key={session.id}
        className={cn(
          "group/row flex min-w-0 items-center rounded-lg px-1 hover:bg-card",
          props.selected === session.id && "bg-card",
        )}
      >
        <button
          onClick={() => props.onSelect(session.id)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-ui-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              className="size-2 shrink-0 rounded-full bg-warning"
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{session.title}</span>
          {props.ctrl && shortcut <= 9 ? (
            <kbd className="font-mono text-ui-xs">⌃{shortcut}</kbd>
          ) : null}
        </button>
        <Tooltip content={t(pinned ? "app.unpin" : "app.pin")}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`${t(pinned ? "app.unpin" : "app.pin")} ${session.title}`}
            className="opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
            onClick={() => props.onPin(session.id, !pinned)}
          >
            {pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
          </Button>
        </Tooltip>
      </div>
    );
  };
  const section = (
    id: "pinned" | "conversations" | "projects" | "recent",
    children: React.ReactNode,
  ) => (
    <section key={id} aria-label={t(`app.${id}`)} className="mb-3">
      <div className="group/header flex items-center gap-1 px-2">
        <button
          onClick={() => toggle(id)}
          aria-expanded={!groups.includes(id)}
          className="flex min-w-0 flex-1 items-center gap-1 py-2 text-left text-ui-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn(
              "size-3 opacity-0 group-hover/header:opacity-100 group-focus-within/header:opacity-100",
              groups.includes(id) && "-rotate-90",
            )}
          />
          {t(`app.${id}`)}
        </button>
        {id === "recent" ? (
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
                            collapsedGroups: ["pinned", "conversations", "projects", "recent"],
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
                  {(["showPinned", "showConversations", "showProjects"] as const).map((key, i) => (
                    <Menu.DropdownMenuCheckboxItem
                      key={key}
                      checked={p[key] !== false}
                      onCheckedChange={(value) => props.onPreferences({ ...p, [key]: value })}
                    >
                      {t((["app.pinned", "app.conversations", "app.projects"] as const)[i]!)}
                    </Menu.DropdownMenuCheckboxItem>
                  ))}
                </Menu.DropdownMenuGroup>
              </Menu.DropdownMenuContent>
            </Menu.DropdownMenu>
            <Tooltip content={t("app.new-chat")}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`${t("app.new-chat")} ${t("app.recent")}`}
                className="opacity-0 group-hover/header:opacity-100 group-focus-within/header:opacity-100"
                onClick={() => props.onNew(null)}
              >
                <Plus className="size-4" />
              </Button>
            </Tooltip>
          </>
        ) : null}
      </div>
      {!groups.includes(id) ? children : null}
    </section>
  );
  const projectPaths = new Set(props.projects.map((project) => project.path));
  return (
    <aside
      aria-label={t("app.home")}
      className="flex h-full min-h-0 w-64 shrink-0 flex-col border-r border-border bg-background p-2"
    >
      <div className="mb-4 flex items-center gap-1">
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {p.showPinned !== false
          ? section("pinned", props.sessions.filter((s) => props.pinned.includes(s.id)).map(row))
          : null}
        {p.showConversations !== false
          ? section(
              "conversations",
              props.sessions.filter((s) => !projectPaths.has(s.cwd)).map(row),
            )
          : null}
        {p.showProjects !== false
          ? section(
              "projects",
              <>
                {props.projects.map((project) => (
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
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-ui-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                        {props.sessions.filter((s) => s.cwd === project.path).map(row)}
                      </div>
                    ) : null}
                  </div>
                ))}
                <Button variant="ghost" size="sm" onClick={props.onAdd}>
                  <Plus className="size-4" />
                  {t("app.add-project")}
                </Button>
              </>,
            )
          : null}
        {section("recent", props.recent.map(row))}
      </div>
    </aside>
  );
}
