// PROTOTYPE Session search overlay in shadcn/ui CommandDialog style; real code installs shadcn's
// command + dialog. Empty query lists recent Sessions; typing filters by title or project name.
import { Folder, MessageSquare, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { projects } from "./data";
import { useAgo, useT } from "./i18n";
import { useProto } from "./state";
import { cn, Kbd } from "./ui";

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const ago = useAgo();
  const { sessions, select } = useProto();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const q = query.trim().toLowerCase();
  const projectName = (id: string | null) => (id ? (projects.find((p) => p.id === id)?.name ?? "") : t("chats"));
  const results = [...sessions]
    .sort((a, b) => a.updatedMin - b.updatedMin)
    .filter((s) => !q || s.title.toLowerCase().includes(q) || projectName(s.projectId).toLowerCase().includes(q))
    .slice(0, q ? 50 : 8);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const open = (id: string) => {
    select({ kind: "session", id });
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/50" />
      <div role="dialog" aria-modal="true" aria-label={t("search")} className="relative mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-lg border bg-background shadow-lg">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
            aria-activedescendant={results[active] ? `search-${results[active].id}` : undefined}
            aria-label={t("search")}
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && !e.nativeEvent.isComposing && results[active]) {
                e.preventDefault();
                open(results[active].id);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            className="h-11 min-w-0 flex-1 bg-transparent text-ui-base outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="px-3 pt-2 pb-1 text-ui-sm text-muted-foreground">{q ? t("searchResults", { n: results.length }) : t("recent")}</div>
        <ul id="search-results" ref={listRef} role="listbox" aria-label={t("search")} className="max-h-80 overflow-y-auto px-1 pb-1">
          {results.length === 0 && <li className="px-3 py-6 text-center text-ui-sm text-muted-foreground">{t("noResults")}</li>}
          {results.map((s, i) => {
            const Icon = s.projectId ? Folder : MessageSquare;
            return (
              <li
                key={s.id}
                id={`search-${s.id}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => open(s.id)}
                className={cn("flex min-w-0 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-ui-base", i === active && "bg-card")}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className="shrink-0 text-ui-sm text-muted-foreground">{projectName(s.projectId)}</span>
                <span className="w-10 shrink-0 text-right text-ui-xs text-muted-foreground">{ago(s.updatedMin)}</span>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-3 border-t px-3 py-2 text-ui-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {t("searchMove")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> {t("searchOpen")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> {t("searchClose")}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
