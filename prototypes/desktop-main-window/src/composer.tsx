// PROTOTYPE composer after the Codex reference: one rounded card, attach and permission mode on
// the left, model and send/stop on the right. While a Run is live, Enter steers instead of queuing.
import { ArrowUp, ChevronDown, Loader2, Plus, Shield, ShieldAlert, ShieldCheck, Square } from "lucide-react";
import { useState } from "react";
import type { PermissionMode } from "./data";
import { useT } from "./i18n";
import { useProto } from "./state";
import { Button, cn } from "./ui";

const modes: PermissionMode[] = ["ask", "auto-review", "full-access"];
const modeStyle = {
  ask: { icon: Shield, className: "text-muted-foreground" },
  "auto-review": { icon: ShieldCheck, className: "text-accent" },
  "full-access": { icon: ShieldAlert, className: "text-warning" },
};

export function Composer() {
  const t = useT();
  const { mode, setMode, status, stop, send, connection } = useProto();
  const [text, setText] = useState("");
  const busy = status !== "idle";
  const offline = connection !== "connected";
  const submit = () => {
    if (!text.trim() || offline) return;
    send(text.trim());
    setText("");
  };
  const ModeIcon = modeStyle[mode].icon;
  return (
    <div className="rounded-2xl border bg-background shadow-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
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
        className="block w-full resize-none bg-transparent px-4 pt-3 text-ui-base outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        <Button size="icon-sm" variant="ghost" aria-label={t("attach")}>
          <Plus />
        </Button>
        <label className={cn("relative inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-ui-sm hover:bg-card focus-within:ring-[3px] focus-within:ring-ring/50", modeStyle[mode].className)}>
          <ModeIcon className="size-4" />
          <span>{t(`mode.${mode}`)}</span>
          <select aria-label={t("mode")} value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)} className="absolute inset-0 cursor-pointer opacity-0">
            {modes.map((m) => (
              <option key={m} value={m}>
                {t(`mode.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <span className="flex-1" />
        {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t("status.running")} />}
        <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md px-2 font-mono text-ui-sm hover:bg-card outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          claude-sonnet-4.5 <span className="text-muted-foreground">high</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
        {busy && !text.trim() ? (
          <Button size="icon-sm" className="rounded-full" aria-label={t("stop")} onClick={stop}>
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button size="icon-sm" className="rounded-full" aria-label={busy ? t("steer") : t("send")} disabled={!text.trim() || offline} onClick={submit}>
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  );
}
