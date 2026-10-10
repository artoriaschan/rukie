// PROTOTYPE main window after the Codex reference layout: sidebar | title bar + conversation +
// docked composer. No inspector; the Session summary is a pinned card toggled from the title bar.
import { AnimatePresence } from "motion/react";
import { Ellipsis, Folder, ListTree, PanelLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConnectionNotice, PermissionDock } from "./blocks";
import { Composer } from "./composer";
import { Conversation, TurnRail } from "./conversation";
import { projects, turns } from "./data";
import { useT } from "./i18n";
import { Sidebar } from "./sidebar";
import { useProto } from "./state";
import { SummaryPanel } from "./summary";
import { Button, cn } from "./ui";

export function App() {
  const t = useT();
  const { reply, status } = useProto();
  const [sidebar, setSidebar] = useState(() => matchMedia("(min-width: 768px)").matches);
  const [summaryOpen, setSummaryOpen] = useState(() => matchMedia("(min-width: 1024px)").matches);
  const [activeTurn, setActiveTurn] = useState(turns.length - 1);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, []);

  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top + 80;
    let current = 0;
    turns.forEach((_, i) => {
      const el = document.getElementById(`turn-${i}`);
      if (el && el.getBoundingClientRect().top <= top) current = i;
    });
    setActiveTurn(current);
  };

  const pending = turns.at(-1)!.items.find((i) => i.kind === "permission");
  const showDock = pending?.kind === "permission" && !reply && status !== "idle";
  const session = projects[0].sessions[0];

  return (
    <div className="flex h-full min-h-0">
      {sidebar && (
        <div className="contents max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:block max-md:shadow-lg">
          <Sidebar onClose={() => setSidebar(false)} />
        </div>
      )}
      <main className="relative flex min-w-0 flex-1 flex-col border-l">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          {!sidebar && (
            <Button size="icon-sm" variant="ghost" aria-label={t("toggleSidebar")} onClick={() => setSidebar(true)}>
              <PanelLeft />
            </Button>
          )}
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-ui-sm text-muted-foreground max-sm:hidden">{projects[0].name} /</span>
          <h1 className="min-w-0 truncate text-ui-base font-medium">{session.title}</h1>
          <span className="flex-1" />
          <Button size="icon-sm" variant="ghost" aria-label={t("more")}>
            <Ellipsis />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("summary")}
            aria-expanded={summaryOpen}
            aria-controls="session-summary"
            onClick={() => setSummaryOpen(!summaryOpen)}
            className={cn(summaryOpen && "bg-card")}
          >
            <ListTree />
          </Button>
        </header>

        <div className="relative min-h-0 flex-1">
          <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto">
            {/* Wide windows make room for the pinned summary instead of covering user bubbles. */}
            <div className={cn("transition-[padding] duration-300 ease-out", summaryOpen && "lg:pr-76")}>
              <Conversation />
            </div>
          </div>
          <TurnRail
            active={activeTurn}
            onJump={(i) => {
              document.getElementById(`turn-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              setActiveTurn(i);
            }}
          />
          <AnimatePresence>{summaryOpen && <SummaryPanel onClose={() => setSummaryOpen(false)} />}</AnimatePresence>
        </div>

        <div className={cn("transition-[padding] duration-300 ease-out", summaryOpen && "lg:pr-76")}>
          <div className="mx-auto w-full max-w-3xl space-y-2 px-6 pb-4">
          <ConnectionNotice />
          <AnimatePresence>{showDock && pending?.kind === "permission" && <PermissionDock item={pending} />}</AnimatePresence>
          <Composer />
          </div>
        </div>
      </main>
    </div>
  );
}
