// PROTOTYPE: three structurally different desktop main-window variants, switchable via ?variant=A|B|C
// (plus ?theme=light|dark&lang=zh|en&conn=connected|reconnecting|disconnected) on one throwaway page.
// Pencil source ~/Desktop/rukie.pen was missing; layouts follow ticket 08's artboard list, DESIGN.md
// and shadcn/ui default style.
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Connection, PermissionMode, PermissionReply } from "./data";
import { LangContext, type Lang } from "./i18n";
import "./index.css";
import { ProtoContext, type ProtoState } from "./state";
import * as A from "./variant-a";
import * as B from "./variant-b";
import * as C from "./variant-c";

const variants = { A: { name: A.name, View: A.VariantA }, B: { name: B.name, View: B.VariantB }, C: { name: C.name, View: C.VariantC } };
type Key = keyof typeof variants;
const keys = Object.keys(variants) as Key[];

function useParam<T extends string>(name: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const read = () => {
    const v = new URLSearchParams(location.search).get(name);
    return allowed.includes(v as T) ? (v as T) : fallback;
  };
  const [value, setValue] = useState<T>(read);
  const set = (v: T) => {
    const params = new URLSearchParams(location.search);
    params.set(name, v);
    history.replaceState(null, "", `?${params}`);
    setValue(v);
  };
  return [value, set];
}

function cycle<T>(list: readonly T[], current: T, step: number) {
  return list[(list.indexOf(current) + step + list.length) % list.length];
}

const pill = "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-ui-sm hover:bg-white/15 outline-none focus-visible:ring-2 focus-visible:ring-white";

function App() {
  const [variant, setVariant] = useParam<Key>("variant", keys, "A");
  const [theme, setTheme] = useParam("theme", ["dark", "light"] as const, "dark");
  const [lang, setLang] = useParam<Lang>("lang", ["zh", "en"], "zh");
  const [connection, setConnection] = useParam<Connection>("conn", ["connected", "reconnecting", "disconnected"], "connected");
  const [mode, setMode] = useState<PermissionMode>("ask");
  const [reply, setReply] = useState<PermissionReply | null>(null);
  const [stopped, setStopped] = useState(false);
  const [activeSession, setActiveSession] = useState("s1");
  const [sent, setSent] = useState<string[]>([]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.lang = lang;
  }, [theme, lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") setVariant(cycle(keys, variant, -1));
      if (e.key === "ArrowRight") setVariant(cycle(keys, variant, 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const state: ProtoState = {
    connection,
    mode,
    setMode,
    reply,
    answer: (r) => setReply(r),
    status: stopped ? "idle" : reply ? "running" : "waiting",
    stop: () => setStopped(true),
    activeSession,
    setActiveSession,
    sent,
    send: (text) => setSent((list) => [...list, text]),
  };
  const reset = () => {
    setReply(null);
    setStopped(false);
    setSent([]);
  };
  const { View, name } = variants[variant];

  return (
    <LangContext value={lang}>
      <ProtoContext value={state}>
        <View key={variant} />
      </ProtoContext>
      {import.meta.env.DEV && (
        <div className="fixed bottom-2 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#6e40c9] px-2 py-1 text-white shadow-lg ring-1 ring-black/20">
          <button type="button" className={pill} aria-label="Previous variant" onClick={() => setVariant(cycle(keys, variant, -1))}>
            <ChevronLeft className="size-4" />
          </button>
          <span className="px-1 text-ui-sm font-semibold whitespace-nowrap">
            {variant} ({name})
          </span>
          <button type="button" className={pill} aria-label="Next variant" onClick={() => setVariant(cycle(keys, variant, 1))}>
            <ChevronRight className="size-4" />
          </button>
          <span className="mx-1 h-4 w-px bg-white/30" />
          <button type="button" className={pill} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme}
          </button>
          <button type="button" className={pill} onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
            {lang}
          </button>
          <button type="button" className={pill} onClick={() => setConnection(cycle(["connected", "reconnecting", "disconnected"] as const, connection, 1))}>
            {connection}
          </button>
          <button type="button" className={pill} aria-label="Reset prototype state" onClick={reset}>
            <RotateCcw className="size-4" />
          </button>
        </div>
      )}
    </LangContext>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
