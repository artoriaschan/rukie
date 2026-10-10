// PROTOTYPE composer, run status and session list.
import { ArrowUp, Loader2, Shield, Square } from "lucide-react";
import { useState } from "react";
import { projects, type PermissionMode } from "./data";
import { useT } from "./i18n";
import { useProto, type RunStatus } from "./state";
import { Badge, Button, cn } from "./ui";

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const t = useT();
  if (status === "idle") return <Badge variant="secondary">{t("idle")}</Badge>;
  if (status === "waiting")
    return (
      <Badge variant="warning">
        <span className="size-1.5 rounded-full bg-warning" />
        {t("waiting")}
      </Badge>
    );
  return (
    <Badge variant="outline">
      <Loader2 className="animate-spin" />
      {t("running")}
    </Badge>
  );
}

/** Turn indicator above the composer, after H08. Shimmer stops under reduced motion via index.css. */
export function TurnIndicator() {
  const t = useT();
  const { status } = useProto();
  if (status === "idle") return null;
  return (
    <div className="flex items-center gap-2 px-1 pb-2 text-ui-sm text-muted-foreground" aria-live="polite">
      {status === "running" ? <Loader2 className="size-4 animate-spin" /> : <span className="size-2 rounded-full bg-warning" />}
      <span>{status === "running" ? t("running") : t("waiting")}</span>
      <span className="font-mono text-ui-xs">· 00:42 · 18.2k tokens</span>
    </div>
  );
}

const modes: PermissionMode[] = ["ask", "auto-review", "full-access"];

export function Composer({ className }: { className?: string }) {
  const t = useT();
  const { mode, setMode, status, stop, send, connection } = useProto();
  const [text, setText] = useState("");
  const busy = status !== "idle";
  const submit = () => {
    if (!text.trim()) return;
    send(text.trim());
    setText("");
  };
  return (
    <div className={cn("rounded-xl border bg-background shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30", className)}>
      <label className="sr-only" htmlFor="composer">
        {busy ? t("steer") : t("placeholder")}
      </label>
      <textarea
        id="composer"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={busy ? t("steer") : t("placeholder")}
        className="block w-full resize-none bg-transparent px-3 pt-3 text-ui-base outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        <label className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-ui-sm text-muted-foreground hover:bg-card">
          <Shield className="size-4" />
          <span className="sr-only">{t("mode")}</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as PermissionMode)}
            className="bg-transparent text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {modes.map((m) => (
              <option key={m} value={m}>
                {t(`mode.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <span className="flex-1 truncate font-mono text-ui-xs text-muted-foreground">claude-sonnet-4.5 · high</span>
        {busy && (
          <Button size="icon-sm" variant="outline" aria-label={t("stop")} onClick={stop}>
            <Square />
          </Button>
        )}
        <Button size="icon-sm" aria-label={busy ? t("steer") : t("send")} disabled={!text.trim() || connection !== "connected"} onClick={submit}>
          <ArrowUp />
        </Button>
      </div>
    </div>
  );
}

export function SessionList({ dense = false }: { dense?: boolean }) {
  const t = useT();
  const { activeSession, setActiveSession, status } = useProto();
  return (
    <nav aria-label={t("sessions")} className="space-y-4">
      {projects.map((project) => (
        <div key={project.id}>
          <div className="flex items-center gap-2 px-2 pb-1 text-ui-sm font-medium text-muted-foreground">
            <span className="truncate">{project.name}</span>
            {!dense && <span className="min-w-0 truncate font-mono text-ui-xs">{project.path}</span>}
          </div>
          <ul className="space-y-0.5">
            {project.sessions.map((s) => {
              const active = s.id === activeSession;
              const dot = s.id === "s1" ? status : "idle";
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => setActiveSession(s.id)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-base outline-none hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      active && "bg-card font-medium",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn("size-2 shrink-0 rounded-full", dot === "running" && "bg-accent animate-pulse", dot === "waiting" && "bg-warning", dot === "idle" && "bg-transparent")}
                    />
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    {dot === "waiting" && <span className="sr-only">{t("waiting")}</span>}
                    {!dense && <span className="shrink-0 text-ui-xs text-muted-foreground">{s.updated}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
