// PROTOTYPE: desktop main window, single layout after the Codex reference (ticket 09, round 2).
// Query params: ?theme=light|dark&lang=zh|en&conn=connected|reconnecting|disconnected.
// The earlier A/B/C variants live in this branch's history (commit 7b1a5155).
import { RotateCcw } from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import type { Connection, PermissionMode, PermissionReply } from "./data";
import { LangContext, type Lang } from "./i18n";
import "./index.css";
import { ProtoContext, type ProtoState } from "./state";

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
  const [reply, setReply] = useState<PermissionReply | null>(null);
  const [stopped, setStopped] = useState(false);
  const [activeSession, setActiveSession] = useState("s1");
  const [sent, setSent] = useState<string[]>([]);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.lang = lang;
  }, [theme, lang]);

  const state: ProtoState = {
    connection,
    mode,
    setMode,
    reply,
    answer: setReply,
    status: stopped ? "idle" : reply ? "running" : "waiting",
    stop: () => setStopped(true),
    activeSession,
    setActiveSession,
    sent,
    send: (text) => setSent((list) => [...list, text]),
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
              setReply(null);
              setStopped(false);
              setSent([]);
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
