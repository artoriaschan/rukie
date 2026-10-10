// PROTOTYPE sidebar after the Codex reference: app header, New session, projects as folders
// with their Sessions nested. Holding Ctrl reveals ⌃1–⌃9 Session shortcuts.
import { ChevronDown, Folder, FolderOpen, FolderPlus, Loader2, PanelLeft, Search, Settings, SquarePen } from "lucide-react";
import { useEffect, useState } from "react";
import { projects } from "./data";
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

const row = "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-base outline-none hover:bg-background/70 focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function Sidebar({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { activeSession, setActiveSession, status } = useProto();
  const ctrl = useCtrlHeld();
  const [open, setOpen] = useState<Record<string, boolean>>({ rukie: true });
  let shortcut = 0;
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-card">
      <div className="flex h-12 shrink-0 items-center gap-1 px-3">
        <button type="button" className="flex items-center gap-1 rounded-md px-1 text-ui-lg font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          {t("appName")} <ChevronDown className="size-4 text-muted-foreground" />
        </button>
        <span className="flex-1" />
        <Button size="icon-sm" variant="ghost" aria-label={t("search")}>
          <Search />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={t("toggleSidebar")} onClick={onClose}>
          <PanelLeft />
        </Button>
      </div>
      <div className="px-2">
        <button type="button" className={row}>
          <SquarePen className="size-4 text-muted-foreground" />
          <span className="flex-1">{t("newSession")}</span>
          <Kbd>⌘N</Kbd>
        </button>
      </div>
      <div className="flex items-center px-4 pt-4 pb-1">
        <span className="flex-1 text-ui-sm text-muted-foreground">{t("projects")}</span>
        <Button size="icon-sm" variant="ghost" className="size-6" aria-label={t("addProject")}>
          <FolderPlus />
        </Button>
      </div>
      <nav aria-label={t("projects")} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <ul className="space-y-0.5">
          {projects.map((p) => {
            const expanded = open[p.id] ?? false;
            const Icon = expanded ? FolderOpen : Folder;
            return (
              <li key={p.id}>
                <button type="button" aria-expanded={expanded} title={p.path} onClick={() => setOpen({ ...open, [p.id]: !expanded })} className={row}>
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                </button>
                {expanded && (
                  <ul className="space-y-0.5">
                    {p.sessions.map((s) => {
                      shortcut += 1;
                      const active = s.id === activeSession;
                      const live = s.id === "s1" ? status : "idle";
                      return (
                        <li key={s.id}>
                          <button type="button" aria-current={active ? "page" : undefined} onClick={() => setActiveSession(s.id)} className={cn(row, "pl-8", active && "bg-background font-medium shadow-xs")}>
                            <span className="min-w-0 flex-1 truncate">{s.title}</span>
                            {ctrl && shortcut <= 9 ? (
                              <Kbd>⌃{shortcut}</Kbd>
                            ) : live === "running" ? (
                              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label={t("status.running")} />
                            ) : live === "waiting" ? (
                              <span className="size-2 shrink-0 rounded-full bg-warning" role="img" aria-label={t("waiting")} />
                            ) : (
                              <span className="shrink-0 text-ui-xs text-muted-foreground">{s.updated}</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-ui-xs font-semibold text-primary-foreground">CZ</span>
        <span className="flex-1" />
        <Button size="icon-sm" variant="ghost" aria-label={t("settings")}>
          <Settings />
        </Button>
      </div>
    </aside>
  );
}
