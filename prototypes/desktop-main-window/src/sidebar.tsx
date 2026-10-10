// PROTOTYPE navigation after the Codex reference: a nav rail with only Home, and the Home sidebar
// with New chat plus four collapsible groups. A Session may appear in several groups (Pinned and
// Recent); ⌃1–⌃9 follow the Recent order so a shortcut means the same Session everywhere.
import { ArrowDownUp, ChevronDown, ChevronRight, Ellipsis, Folder, FolderOpen, FolderPlus, House, Loader2, PanelLeft, Pin, PinOff, Plus, Search, SquarePen } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Menu } from "./menu";
import { projects, type SessionItem } from "./data";
import { useT } from "./i18n";
import { useProto } from "./state";
import { Button, cn, Kbd } from "./ui";

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
const row = cn("flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-base hover:bg-card", focus);

export function NavRail() {
  const t = useT();
  return (
    <nav aria-label={t("mainNav")} className="flex w-12 shrink-0 flex-col items-center gap-1 pt-1 pb-3">
      <Button size="icon-sm" variant="ghost" aria-label={t("home")} aria-current="page" className="size-9 rounded-lg border bg-background">
        <House />
      </Button>
      <span className="flex-1" />
      <span className="flex size-7 items-center justify-center rounded-full bg-primary text-ui-xs font-semibold text-primary-foreground" aria-hidden>
        CZ
      </span>
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
      <button
        type="button"
        aria-label={session.pinned ? t("unpin") : t("pin")}
        title={session.pinned ? t("unpin") : t("pin")}
        onClick={() => togglePin(session.id)}
        className={cn("absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-background hover:text-foreground group-focus-within/row:opacity-100 group-hover/row:opacity-100", focus)}
      >
        {session.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      </button>
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
        <Button size="icon-sm" variant="ghost" className="rounded-lg text-muted-foreground" aria-label={`${t("search")} (⌘K)`} title={`${t("search")} ⌘K`} aria-haspopup="dialog" onClick={onSearch}>
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
            <Button size="icon-sm" variant="ghost" className="size-6" aria-label={t("addProject")} title={t("addProject")}>
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
                <div className="group/p relative">
                  <button type="button" aria-expanded={expanded} title={p.path} onClick={() => toggle(key)} className={cn(row, "pr-9", newHere && "bg-card")}>
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {!expanded && <ChevronRight className="size-3.5 text-muted-foreground" />}
                  </button>
                  <button
                    type="button"
                    aria-label={t("newInProject", { project: p.name })}
                    title={t("newInProject", { project: p.name })}
                    onClick={() => select({ kind: "new", projectId: p.id })}
                    className={cn("absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-background hover:text-foreground group-focus-within/p:opacity-100 group-hover/p:opacity-100", focus)}
                  >
                    <Plus className="size-3.5" />
                  </button>
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
                aria-label={t("recentMore")}
                title={t("recentMore")}
                aria-haspopup="menu"
                aria-expanded={menu !== null}
                onClick={(e) => setMenu(menu ? null : { anchor: e.currentTarget, keyboard: e.detail === 0 })}
              >
                <Ellipsis />
              </Button>
              <Button size="icon-sm" variant="ghost" className="size-6" aria-label={t("newChat")} title={t("newChat")} onClick={() => select({ kind: "new", projectId: null })}>
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
    </aside>
  );
}
