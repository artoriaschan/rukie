// PROTOTYPE main window after the Codex reference: nav rail (Home only) | Home sidebar |
// main area. The main area shows the welcome page for a new Session (figure 1) or the selected
// Session's Transcript (figure 2), both with the composer docked at the bottom.
import { AnimatePresence } from "motion/react";
import { Ellipsis, Folder, ListTree, MessageSquare, PanelLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConnectionNotice, PermissionDock } from "./blocks";
import { Composer } from "./composer";
import { Conversation, TurnRail, turnsOf } from "./conversation";
import { projects } from "./data";
import { useT } from "./i18n";
import { NavRail, Sidebar } from "./sidebar";
import { useProto } from "./state";
import { SummaryPanel } from "./summary";
import { Button, cn } from "./ui";
import { Welcome } from "./welcome";

/** Created in this page: its id starts with "n" (see Root.send). */
const isCreated = (id: string) => id.startsWith("n");

function SessionView({ id, summaryOpen, onCloseSummary }: { id: string; summaryOpen: boolean; onCloseSummary: () => void }) {
  const { sessions, statusOf, sentOf, reply, stop } = useProto();
  const session = sessions.find((s) => s.id === id)!;
  const turns = turnsOf(session, isCreated(id));
  const status = statusOf(id);
  const [activeTurn, setActiveTurn] = useState(turns.length - 1);
  const scroller = useRef<HTMLDivElement>(null);
  const sentCount = sentOf(id).length;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [sentCount]);

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

  const pending = turns.at(-1)?.items.find((i) => i.kind === "permission");
  const showDock = pending?.kind === "permission" && !reply && status !== "idle";
  const shift = id === "s1" && summaryOpen && "lg:pr-76";

  return (
    <>
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto">
          {/* Wide windows make room for the pinned summary instead of covering user bubbles. */}
          <div className={cn("transition-[padding] duration-300 ease-out", shift)}>
            <Conversation turns={turns} sent={sentOf(id)} status={status} />
          </div>
        </div>
        <TurnRail
          turns={turns}
          active={activeTurn}
          onJump={(i) => {
            document.getElementById(`turn-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            setActiveTurn(i);
          }}
        />
        <AnimatePresence>{id === "s1" && summaryOpen && <SummaryPanel onClose={onCloseSummary} />}</AnimatePresence>
      </div>
      <div className={cn("transition-[padding] duration-300 ease-out", shift)}>
        <div className="mx-auto w-full max-w-3xl space-y-2 px-6 pb-4">
          <ConnectionNotice />
          <AnimatePresence>{showDock && pending?.kind === "permission" && <PermissionDock item={pending} />}</AnimatePresence>
          <Composer status={status} onStop={() => stop(id)} isNew={false} />
        </div>
      </div>
    </>
  );
}

export function App() {
  const t = useT();
  const { selection, sessions } = useProto();
  const [sidebar, setSidebar] = useState(() => matchMedia("(min-width: 768px)").matches);
  const [summaryOpen, setSummaryOpen] = useState(() => matchMedia("(min-width: 1024px)").matches);

  const session = selection.kind === "session" ? sessions.find((s) => s.id === selection.id) : undefined;
  const project = session?.projectId ? projects.find((p) => p.id === session.projectId) : undefined;

  return (
    <div className="flex h-full min-h-0">
      <NavRail />
      {sidebar && (
        <div className="contents max-md:absolute max-md:inset-y-0 max-md:left-12 max-md:z-30 max-md:block max-md:shadow-lg">
          <Sidebar onClose={() => setSidebar(false)} />
        </div>
      )}
      <main className="relative flex min-w-0 flex-1 flex-col border-l">
        <header className={cn("flex h-12 shrink-0 items-center gap-2 px-3", session && "border-b")}>
          {!sidebar && (
            <Button size="icon-sm" variant="ghost" aria-label={t("toggleSidebar")} onClick={() => setSidebar(true)}>
              <PanelLeft />
            </Button>
          )}
          {session && (
            <>
              {project ? <Folder className="size-4 shrink-0 text-muted-foreground" /> : <MessageSquare className="size-4 shrink-0 text-muted-foreground" />}
              <span className="shrink-0 text-ui-sm text-muted-foreground max-sm:hidden">{project ? project.name : t("chats")} /</span>
              <h1 className="min-w-0 truncate text-ui-base font-medium">{session.title}</h1>
              <span className="flex-1" />
              <Button size="icon-sm" variant="ghost" aria-label={t("more")}>
                <Ellipsis />
              </Button>
              {session.id === "s1" && (
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
              )}
            </>
          )}
        </header>

        {selection.kind === "new" ? (
          <>
            <div className="min-h-0 flex-1">
              <Welcome />
            </div>
            <div className="mx-auto w-full max-w-3xl space-y-2 px-6 pb-4">
              <ConnectionNotice />
              <Composer status="idle" onStop={() => {}} isNew />
            </div>
          </>
        ) : (
          <SessionView key={selection.id} id={selection.id} summaryOpen={summaryOpen} onCloseSummary={() => setSummaryOpen(false)} />
        )}
      </main>
    </div>
  );
}
