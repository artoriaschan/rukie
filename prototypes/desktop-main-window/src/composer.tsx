// PROTOTYPE composer after the Codex reference: one rounded card, attach and permission mode on
// the left, model and send/stop on the right. On the welcome page a context band above it shows
// where the new Session will run. While a Run is live, Enter steers instead of queuing.
import { ArrowUp, ChevronDown, Plus, Shield, ShieldAlert, ShieldCheck, Square } from "lucide-react";
import { useCallback, useState } from "react";
import { Menu } from "./menu";
import { models, type PermissionMode, type ThinkingLevel } from "./data";
import { ContextUsage, ModelPicker } from "./model-picker";
import { useT } from "./i18n";
import { useProto, type RunStatus } from "./state";
import { Button, cn, Tooltip } from "./ui";
import { TargetPicker } from "./welcome";

const modes: PermissionMode[] = ["ask", "auto-review", "full-access"];
const modeStyle = {
  ask: { icon: Shield, className: "text-muted-foreground" },
  "auto-review": { icon: ShieldCheck, className: "text-accent" },
  "full-access": { icon: ShieldAlert, className: "text-warning" },
};

export function Composer({ status, onStop, isNew }: { status: RunStatus; onStop: () => void; isNew: boolean }) {
  const t = useT();
  const { mode, setMode, send, connection } = useProto();
  const [text, setText] = useState("");
  const [model, setModel] = useState(models[0]!);
  const [thinking, setThinking] = useState<ThinkingLevel>("high");
  const busy = status !== "idle";
  const offline = connection !== "connected";
  const submit = () => {
    if (!text.trim() || offline) return;
    send(text.trim());
    setText("");
  };
  const ModeIcon = modeStyle[mode].icon;
  const [modeMenu, setModeMenu] = useState<{ anchor: HTMLElement; keyboard: boolean } | null>(null);
  const closeModeMenu = useCallback(() => setModeMenu(null), []);
  const placeholder = busy ? t("steer") : isNew ? t("placeholderNew") : t("placeholder");
  return (
    <div className={cn(isNew && "rounded-2xl border bg-card")}>
      {isNew && (
        <div className="flex items-center gap-1 px-2 py-1">
          <TargetPicker variant="chip" />
        </div>
      )}
      <div className={cn("rounded-2xl border bg-background shadow-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30", isNew && "-m-px")}>
        <label className="sr-only" htmlFor="composer">
          {placeholder}
        </label>
        <textarea
          id="composer"
          rows={2}
          autoFocus={isNew}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className="block w-full resize-none bg-transparent px-4 pt-3 text-ui-base outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <Button size="icon-sm" variant="ghost" tip={t("attach")}>
            <Plus />
          </Button>
          {/* Permission mode menu after Pencil C05: one row per mode with its description. */}
          <Tooltip label={t("mode")}>
          <button
            type="button"
            aria-label={`${t("mode")}: ${t(`mode.${mode}`)}`}
            aria-haspopup="menu"
            aria-expanded={modeMenu !== null}
            onClick={(e) => setModeMenu(modeMenu ? null : { anchor: e.currentTarget, keyboard: e.detail === 0 })}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-ui-sm outline-none hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50", modeMenu && "bg-card", modeStyle[mode].className)}
          >
            <ModeIcon className="size-4" />
            <span>{t(`mode.${mode}`)}</span>
            <ChevronDown className="size-3.5" />
          </button>
          </Tooltip>
          {modeMenu && (
            <Menu
              anchor={modeMenu.anchor}
              keyboard={modeMenu.keyboard}
              label={t("mode")}
              onClose={closeModeMenu}
              entries={[
                { kind: "label", label: t("modeTitle") },
                ...modes.map((m) => ({
                  kind: "check" as const,
                  radio: true,
                  icon: modeStyle[m].icon,
                  label: t(`mode.${m}`),
                  description: t(`modeHint.${m}`),
                  className: m === "full-access" ? "text-warning" : undefined,
                  checked: mode === m,
                  onSelect: () => {
                    setMode(m);
                    closeModeMenu();
                  },
                })),
              ]}
            />
          )}
          <span className="flex-1" />
          <ContextUsage model={model} />
          <ModelPicker
            model={model}
            thinking={thinking}
            onChange={(m, level) => {
              setModel(m);
              setThinking(level);
            }}
          />
          {busy && !text.trim() ? (
            <Button size="icon-sm" className="rounded-full" tip={t("stop")} onClick={onStop}>
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button size="icon-sm" className="rounded-full" tip={busy ? t("steer") : t("send")} disabled={!text.trim() || offline} onClick={submit}>
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
