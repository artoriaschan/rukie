// PROTOTYPE navigation after the Codex reference: a nav rail with only Home, and the Home sidebar
// with New chat plus four collapsible groups. A Session may appear in several groups (Pinned and
// Recent); ⌃1–⌃9 follow the Recent order so a shortcut means the same Session everywhere.
import { Archive, ArrowDownUp, ChevronDown, Ellipsis, Folder, FolderOpen, FolderPlus, Gauge, Loader2, PanelLeft, Pencil, Pin, PinOff, Plus, Search, Settings, SquarePen, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Menu } from "./menu";
import { projects, type SessionItem } from "./data";
import { useT } from "./i18n";
import { useProto } from "./state";
import { Button, cn, Kbd, Tooltip } from "./ui";

function useCtrlHeld() {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === "Control" && setHeld(true);
    const up = (e: KeyboardEvent) => e.key === "Control" && setHeld(false);
    const blur = () => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return held;
}

const focus = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const rowAction = cn("flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground", focus);
const row = cn("flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-base hover:bg-card", focus);

/** Solid house glyph for the selected Home destination; lucide only ships outlines. */
function HomeFilled() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5 fill-foreground">
      <path d="M10.7 2.6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10.1V19a2 2 0 0 1-2 2h-3.5a1 1 0 0 1-1-1v-4.5a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1V20a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2v-8.9a2 2 0 0 1 .7-1.5z" />
    </svg>
  );
}

/** The avatar opens the account menu; MVP only links Usage and Settings, no profile header. */
export function NavRail() {
  const t = useT();
  const [menu, setMenu] = useState<{ anchor: HTMLElement; keyboard: boolean } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  return (
    <nav aria-label={t("mainNav")} className="flex w-12 shrink-0 flex-col items-center gap-1 pt-1 pb-3">
      {/* Selected destination after the Codex rail: filled glyph on a soft tile, label in a tooltip. */}
      <Button size="icon-sm" variant="ghost" tip={t("home")} tipSide="right" aria-current="page" className="size-10 rounded-xl bg-foreground/8 hover:bg-foreground/8 [&_svg]:size-5">
        <HomeFilled />
      </Button>
      <span className="flex-1" />
      <Tooltip label={t("account")} side="right">
        <button
          type="button"
          aria-label={t("account")}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onClick={(e) => setMenu(menu ? null : { anchor: e.currentTarget, keyboard: e.detail === 0 })}
          className={cn("flex size-10 items-center justify-center rounded-xl hover:bg-foreground/8", menu && "bg-foreground/8", focus)}
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-ui-xs font-semibold text-primary-foreground" aria-hidden>
            CZ
          </span>
        </button>
      </Tooltip>
      {menu && (
        <Menu
          anchor={menu.anchor}
          keyboard={menu.keyboard}
          label={t("account")}
          onClose={closeMenu}
          entries={[
            { kind: "item", label: t("usage"), icon: Gauge, onSelect: () => {} },
            { kind: "item", label: t("settings"), icon: Settings, hint: "⌘,", onSelect: () => {} },
          ]}
        />
      )}
    </nav>
  );
}

/**
 * Collapsible group. The chevron and header actions appear only while the header is hovered or
 * holds focus; `pinActions` keeps the actions visible while one of them owns an open menu.
 */
function Group({ id, title, open, onToggle, actions, pinActions = false, children }: { id: string; title: string; open: boolean; onToggle: () => void; actions?: ReactNode; pinActions?: boolean; children: ReactNode }) {
  const reveal = "opacity-0 transition-opacity group-hover/h:opacity-100 group-focus-within/h:opacity-100";
  return (
    <section aria-labelledby={`group-${id}`} className="pt-3">
      <div className="group/h flex h-7 items-center px-2">
        <button id={`group-${id}`} type="button" aria-expanded={open} onClick={onToggle} className={cn("flex min-w-0 flex-1 items-center gap-1 rounded-md py-1 text-ui-sm text-muted-foreground hover:text-foreground", focus)}>
          {title}
          <ChevronDown className={cn("size-3.5 transition-transform", reveal, !open && "-rotate-90")} />
        </button>
        {actions && <span className={cn("flex items-center gap-0.5", reveal, pinActions && "opacity-100")}>{actions}</span>}
      </div>
      {open && <ul className="space-y-0.5">{children}</ul>}
    </section>
  );
}

function SessionRow({ session, shortcut, indent = false, ctrl }: { session: SessionItem; shortcut?: number; indent?: boolean; ctrl: boolean }) {
  const t = useT();
  const { selection, select, statusOf, togglePin } = useProto();
  const active = selection.kind === "session" && selection.id === session.id;
  const status = statusOf(session.id);
  return (
    <li className="group/row relative">
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={() => select({ kind: "session", id: session.id })}
        className={cn(row, "pr-9", indent && "pl-8", active && "bg-card font-medium")}
      >
        <span className="min-w-0 flex-1 truncate">{session.title}</span>
      </button>
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center group-focus-within/row:opacity-0 group-hover/row:opacity-0">
        {ctrl && shortcut ? (
          <Kbd>⌃{shortcut}</Kbd>
        ) : status === "running" ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label={t("status.running")} />
        ) : status === "waiting" ? (
          <span className="size-2 rounded-full bg-warning" role="img" aria-label={t("waiting")} />
        ) : null}
      </span>
      <span className="absolute top-1/2 right-1 flex -translate-y-1/2 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
        <Tooltip label={session.pinned ? t("unpin") : t("pin")}>
          <button type="button" aria-label={session.pinned ? t("unpin") : t("pin")} onClick={() => togglePin(session.id)} className={rowAction}>
            {session.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
        </Tooltip>
      </span>
    </li>
  );
}

function Empty({ children, indent = false }: { children: ReactNode; indent?: boolean }) {
  return <li className={cn("px-2 py-1 text-ui-sm text-muted-foreground", indent && "pl-8")}>{children}</li>;
}

export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const t = useT();
  const { sessions, selection, select } = useProto();
  const ctrl = useCtrlHeld();
  const [open, setOpen] = useState<Record<string, boolean>>({ pinned: true, chats: true, projects: true, recent: true, "p:rukie": true });
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !(o[key] ?? false) }));
  const [sort, setSort] = useState<"updated" | "created">("updated");
  const [shown, setShown] = useState({ pinned: true, chats: true, projects: true });
  const [menu, setMenu] = useState<{ anchor: HTMLElement; keyboard: boolean } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [projectMenu, setProjectMenu] = useState<{ id: string; anchor: HTMLElement; keyboard: boolean } | null>(null);
  const closeProjectMenu = useCallback(() => setProjectMenu(null), []);
  const setAll = (value: boolean) => setOpen((o) => ({ ...o, pinned: value, chats: value, projects: value, recent: value }));

  const recent = [...sessions].sort((a, b) => (sort === "updated" ? a.updatedMin - b.updatedMin : a.createdMin - b.createdMin));
  const shortcutOf = (id: string) => {
    const i = recent.findIndex((s) => s.id === id);
    return i >= 0 && i < 9 ? i + 1 : undefined;
  };
  const pinned = recent.filter((s) => s.pinned);
  const chats = recent.filter((s) => s.projectId === null);
  const newActive = selection.kind === "new" && selection.projectId === null;

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-background">
      <div className="flex items-center gap-1 px-2 pt-2">
        <button type="button" aria-current={newActive ? "page" : undefined} onClick={() => select({ kind: "new", projectId: null })} className={cn(row, "min-w-0 flex-1", newActive && "bg-card font-medium")}>
          <SquarePen className="size-4 text-muted-foreground" />
          <span className="flex-1">{t("newChat")}</span>
          <Kbd>⌘N</Kbd>
        </button>
        <Button size="icon-sm" variant="ghost" className="rounded-lg text-muted-foreground" tip={`${t("search")} ⌘K`} aria-haspopup="dialog" onClick={onSearch}>
          <Search />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {shown.pinned && (
          <Group id="pinned" title={t("pinned")} open={open.pinned} onToggle={() => toggle("pinned")}>
            {pinned.length ? pinned.map((s) => <SessionRow key={s.id} session={s} shortcut={shortcutOf(s.id)} ctrl={ctrl} />) : <Empty>{t("noPinned")}</Empty>}
          </Group>
        )}

        {shown.chats && (
          <Group id="chats" title={t("chats")} open={open.chats} onToggle={() => toggle("chats")}>
            {chats.length ? chats.map((s) => <SessionRow key={s.id} session={s} shortcut={shortcutOf(s.id)} ctrl={ctrl} />) : <Empty>{t("noSessions")}</Empty>}
          </Group>
        )}

        {shown.projects && (
        <Group
          id="projects"
          title={t("projects")}
          open={open.projects}
          onToggle={() => toggle("projects")}
          actions={
            <Button size="icon-sm" variant="ghost" className="size-6" tip={t("addProject")}>
              <FolderPlus />
            </Button>
          }
        >
          {projects.map((p) => {
            const key = `p:${p.id}`;
            const expanded = open[key] ?? false;
            const Icon = expanded ? FolderOpen : Folder;
            const items = recent.filter((s) => s.projectId === p.id);
            const newHere = selection.kind === "new" && selection.projectId === p.id;
            return (
              <li key={p.id}>
                {/* Folder icon alone shows the state; menu and new-session actions appear on hover or focus. */}
                <div className="group/p relative">
                  <button type="button" aria-expanded={expanded} title={p.path} onClick={() => toggle(key)} className={cn(row, "pr-16", (newHere || projectMenu?.id === p.id) && "bg-card")}>
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  </button>
                  <span className={cn("absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 opacity-0 group-focus-within/p:opacity-100 group-hover/p:opacity-100", projectMenu?.id === p.id && "opacity-100")}>
                    <Tooltip label={t("projectMore", { project: p.name })}>
                      <button
                        type="button"
                        aria-label={t("projectMore", { project: p.name })}
                        aria-haspopup="menu"
                        aria-expanded={projectMenu?.id === p.id}
                        onClick={(e) => setProjectMenu(projectMenu?.id === p.id ? null : { id: p.id, anchor: e.currentTarget, keyboard: e.detail === 0 })}
                        className={cn(rowAction, projectMenu?.id === p.id && "bg-background text-foreground")}
                      >
                        <Ellipsis className="size-3.5" />
                      </button>
                    </Tooltip>
                    <Tooltip label={t("newInProject", { project: p.name })}>
                      <button type="button" aria-label={t("newInProject", { project: p.name })} onClick={() => select({ kind: "new", projectId: p.id })} className={rowAction}>
                        <SquarePen className="size-3.5" />
                      </button>
                    </Tooltip>
                  </span>
                </div>
                {expanded && (
                  <ul className="space-y-0.5">
                    {items.length ? items.map((s) => <SessionRow key={s.id} session={s} shortcut={shortcutOf(s.id)} indent ctrl={ctrl} />) : <Empty indent>{t("noSessions")}</Empty>}
                  </ul>
                )}
              </li>
            );
          })}
        </Group>
        )}

        <Group
          id="recent"
          title={t("recent")}
          open={open.recent}
          onToggle={() => toggle("recent")}
          pinActions={menu !== null}
          actions={
            <>
              <Button
                size="icon-sm"
                variant="ghost"
                className={cn("size-6", menu && "bg-card")}
                tip={t("recentMore")}
                aria-haspopup="menu"
                aria-expanded={menu !== null}
                onClick={(e) => setMenu(menu ? null : { anchor: e.currentTarget, keyboard: e.detail === 0 })}
              >
                <Ellipsis />
              </Button>
              <Button size="icon-sm" variant="ghost" className="size-6" tip={t("newChat")} onClick={() => select({ kind: "new", projectId: null })}>
                <SquarePen />
              </Button>
            </>
          }
        >
          {recent.map((s) => (
            <SessionRow key={s.id} session={s} shortcut={shortcutOf(s.id)} ctrl={ctrl} />
          ))}
        </Group>
      </div>
      {menu && (
        <Menu
          anchor={menu.anchor}
          keyboard={menu.keyboard}
          label={t("recentMore")}
          onClose={closeMenu}
          entries={[
            {
              kind: "sub",
              label: t("organize"),
              icon: PanelLeft,
              entries: [
                { kind: "item", label: t("expandAll"), onSelect: () => setAll(true) },
                { kind: "item", label: t("collapseAll"), onSelect: () => setAll(false) },
              ],
            },
            {
              kind: "sub",
              label: t("sortBy"),
              icon: ArrowDownUp,
              entries: [
                { kind: "check", radio: true, label: t("sortUpdated"), checked: sort === "updated", onSelect: () => setSort("updated") },
                { kind: "check", radio: true, label: t("sortCreated"), checked: sort === "created", onSelect: () => setSort("created") },
              ],
            },
            { kind: "separator" },
            { kind: "label", label: t("show") },
            { kind: "check", label: t("pinned"), checked: shown.pinned, onSelect: () => setShown((v) => ({ ...v, pinned: !v.pinned })) },
            { kind: "check", label: t("chats"), checked: shown.chats, onSelect: () => setShown((v) => ({ ...v, chats: !v.chats })) },
            { kind: "check", label: t("projects"), checked: shown.projects, onSelect: () => setShown((v) => ({ ...v, projects: !v.projects })) },
            { kind: "separator" },
            { kind: "item", label: t("newSection"), icon: Plus, onSelect: () => {} },
          ]}
        />
      )}
      {projectMenu && (
        <Menu
          anchor={projectMenu.anchor}
          keyboard={projectMenu.keyboard}
          label={t("projectMore", { project: projects.find((p) => p.id === projectMenu.id)?.name ?? "" })}
          onClose={closeProjectMenu}
          entries={[
            { kind: "item", label: t("pinProject"), icon: Pin, onSelect: () => {} },
            { kind: "item", label: t("editProject"), icon: Pencil, onSelect: () => {} },
            { kind: "separator" },
            { kind: "item", label: t("archiveChats"), icon: Archive, onSelect: () => {} },
            { kind: "item", label: t("removeProject"), icon: X, onSelect: () => {} },
          ]}
        />
      )}
    </aside>
  );
}
