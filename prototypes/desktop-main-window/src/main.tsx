// PROTOTYPE: desktop main window after the Codex reference (ticket 09, round 3).
// Query params: ?theme=light|dark&lang=zh|en&conn=connected|reconnecting|disconnected.
// Earlier rounds live in this branch's history (A/B/C variants: 7b1a5155; round 2: 4b6c9cc1).
import { RotateCcw } from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { initialSessions, type Connection, type PermissionMode, type PermissionReply } from "./data";
import { LangContext, type Lang } from "./i18n";
import "./index.css";
import { ProtoContext, type ProtoState, type RunStatus, type Selection } from "./state";

function useParam<T extends string>(name: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const v = new URLSearchParams(location.search).get(name);
    return allowed.includes(v as T) ? (v as T) : fallback;
  });
  const set = (v: T) => {
    const params = new URLSearchParams(location.search);
    params.set(name, v);
    history.replaceState(null, "", `?${params}`);
    setValue(v);
  };
  return [value, set];
}

const connections = ["connected", "reconnecting", "disconnected"] as const;
const pill = "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-ui-sm whitespace-nowrap hover:bg-white/15 outline-none focus-visible:ring-2 focus-visible:ring-white";

function Root() {
  const [theme, setTheme] = useParam("theme", ["light", "dark"] as const, "light");
  const [lang, setLang] = useParam<Lang>("lang", ["zh", "en"], "zh");
  const [connection, setConnection] = useParam<Connection>("conn", connections, "connected");
  const [mode, setMode] = useState<PermissionMode>("ask");
  const [sessions, setSessions] = useState(initialSessions);
  const [selection, select] = useState<Selection>({ kind: "session", id: "s1" });
  const [reply, setReply] = useState<PermissionReply | null>(null);
  const [stopped, setStopped] = useState<Record<string, boolean>>({});
  const [sent, setSent] = useState<Record<string, string[]>>({});
  const [created, setCreated] = useState<string[]>([]);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.lang = lang;
  }, [theme, lang]);

  const statusOf = (id: string): RunStatus => {
    if (stopped[id]) return "idle";
    if (id === "s1") return reply ? "running" : "waiting";
    return created.includes(id) ? "running" : "idle";
  };

  const send = (text: string) => {
    let id: string;
    if (selection.kind === "new") {
      id = `n${Date.now()}`;
      const title = text.length > 24 ? `${text.slice(0, 24)}…` : text;
      setSessions((list) => [{ id, title, projectId: selection.projectId, pinned: false, updatedMin: 0 }, ...list]);
      setCreated((list) => [...list, id]);
      select({ kind: "session", id });
    } else {
      id = selection.id;
      setSessions((list) => list.map((s) => (s.id === id ? { ...s, updatedMin: 0 } : s)));
    }
    setSent((all) => ({ ...all, [id]: [...(all[id] ?? []), text] }));
  };

  const state: ProtoState = {
    connection,
    mode,
    setMode,
    sessions,
    selection,
    select,
    togglePin: (id) => setSessions((list) => list.map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s))),
    statusOf,
    reply,
    answer: setReply,
    stop: (id) => setStopped((all) => ({ ...all, [id]: true })),
    sentOf: (id) => sent[id] ?? [],
    send,
  };

  return (
    <LangContext value={lang}>
      <ProtoContext value={state}>
        <App key={epoch} />
      </ProtoContext>
      {import.meta.env.DEV && (
        <div className="fixed bottom-2 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#6e40c9] px-2 py-1 text-white shadow-lg ring-1 ring-black/20">
          <span className="px-2 text-ui-sm font-semibold whitespace-nowrap">PROTOTYPE</span>
          <span className="h-4 w-px bg-white/30" />
          <button type="button" className={pill} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme}
          </button>
          <button type="button" className={pill} onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
            {lang}
          </button>
          <button type="button" className={pill} onClick={() => setConnection(connections[(connections.indexOf(connection) + 1) % connections.length])}>
            {connection}
          </button>
          <button
            type="button"
            className={pill}
            aria-label="Reset prototype state"
            onClick={() => {
              setSessions(initialSessions);
              select({ kind: "session", id: "s1" });
              setReply(null);
              setStopped({});
              setSent({});
              setCreated([]);
              setEpoch((n) => n + 1);
            }}
          >
            <RotateCcw className="size-4" />
          </button>
        </div>
      )}
    </LangContext>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
