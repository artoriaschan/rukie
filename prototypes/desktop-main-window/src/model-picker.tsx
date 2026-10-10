// PROTOTYPE composer pickers after Pencil C06–C08: a context ring that opens the usage breakdown,
// and a model list whose hovered or focused row shows that model's details and thinking levels.
// Real code builds both from shadcn popover + command.
import { Check, Cpu } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { contextUsage, models, type ModelItem, type ThinkingLevel } from "./data";
import { useT } from "./i18n";
import { cn, Popover, Tooltip } from "./ui";

const fmt = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n));

/** Ring that fills clockwise with the used share of the context window. */
function Ring({ ratio }: { ratio: number }) {
  const r = 6.5;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 16 16" className="size-4 -rotate-90" aria-hidden>
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" className="stroke-border-strong" />
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" strokeDasharray={`${c * ratio} ${c}`} className={ratio >= 0.8 ? "stroke-warning" : "stroke-accent"} />
    </svg>
  );
}

export function ContextUsage({ model }: { model: ModelItem }) {
  const t = useT();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const u = contextUsage;
  const used = u.system + u.tools + u.messages;
  const ratio = Math.min(1, used / model.contextWindow);
  const pct = Math.round(ratio * 100);
  const rows = [
    { label: t("contextSystem"), value: u.system, dot: "bg-muted-foreground" },
    { label: t("contextTools", { n: u.toolCount }), value: u.tools, dot: "bg-accent" },
    { label: t("contextMessages"), value: u.messages, dot: "bg-danger" },
  ];
  return (
    <>
      <Tooltip label={`${t("context")} · ${t("contextUsed", { pct })}`}>
        <button
          type="button"
          aria-label={`${t("context")}: ${t("contextUsed", { pct })}`}
          aria-haspopup="dialog"
          aria-expanded={anchor !== null}
          onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
          className={cn("inline-flex size-8 items-center justify-center rounded-md outline-none hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50", anchor && "bg-card")}
        >
          <Ring ratio={ratio} />
        </button>
      </Tooltip>
      {anchor && (
        <Popover anchor={anchor} label={t("context")} onClose={close}>
          <div className="w-80 space-y-3">
            <div>
              <p className="font-medium">{t("context")}</p>
              <p className="text-ui-sm text-muted-foreground">{model.name}</p>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="font-medium">{t("contextUsed", { pct })}</span>
              <span className="font-mono text-ui-sm text-muted-foreground">
                {fmt(used)} / {fmt(model.contextWindow)}
              </span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-border" role="img" aria-label={t("contextUsed", { pct })}>
              {rows.map((r) => (
                <span key={r.label} className={r.dot} style={{ width: `${(r.value / model.contextWindow) * 100}%` }} />
              ))}
            </div>
            <dl className="space-y-1.5 text-ui-sm">
              {rows.map((r) => (
                <div key={r.label} className="flex items-center gap-2">
                  <span className={cn("size-2.5 rounded-full", r.dot)} aria-hidden />
                  <dt className="flex-1 text-muted-foreground">{r.label}</dt>
                  <dd className="font-mono">{fmt(r.value)}</dd>
                </div>
              ))}
              <div className="flex items-center gap-2 pl-4.5 text-muted-foreground">
                <dt className="flex-1 text-ui-xs">{t("contextOpening")}</dt>
                <dd className="font-mono">{fmt(u.opening)}</dd>
              </div>
            </dl>
            <dl className="flex border-t pt-3 text-ui-sm">
              <dt className="w-24 text-muted-foreground">{t("compactAt")}</dt>
              <dd className="font-mono">
                {fmt(model.contextWindow * u.compactAt)}（{u.compactAt * 100}%）
              </dd>
            </dl>
          </div>
        </Popover>
      )}
    </>
  );
}

function ModelDetail({ model, thinking, onThinking }: { model: ModelItem; thinking: ThinkingLevel; onThinking: (level: ThinkingLevel) => void }) {
  const t = useT();
  return (
    <div role="group" aria-label={t("modelDetail", { model: model.name })} className="w-72 space-y-3 rounded-xl border bg-popover p-4 shadow-md">
      <div>
        <div className="flex items-center gap-2">
          <p className="flex-1 font-medium">{model.name}</p>
          <span className="text-ui-xs text-muted-foreground">{model.provider}</span>
        </div>
        <p className="text-ui-sm text-muted-foreground">{t(model.descriptionKey)}</p>
      </div>
      <dl className="space-y-1.5 border-t pt-3 text-ui-sm">
        <div className="flex">
          <dt className="flex-1 text-muted-foreground">{t("inputKinds")}</dt>
          <dd>{model.input.map((k) => t(`input.${k}`)).join(" / ")}</dd>
        </div>
        <div className="flex">
          <dt className="flex-1 text-muted-foreground">{t("contextWindow")}</dt>
          <dd className="font-mono">{fmt(model.contextWindow)}</dd>
        </div>
      </dl>
      <div className="space-y-2 border-t pt-3">
        <p id={`thinking-${model.id}`} className="text-ui-sm text-muted-foreground">
          {t("thinking")}
        </p>
        <div role="radiogroup" aria-labelledby={`thinking-${model.id}`} className="flex flex-wrap gap-1.5">
          {model.thinking.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={thinking === level}
              onClick={() => onThinking(level)}
              className={cn("h-7 rounded-md border px-2.5 text-ui-sm outline-none hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50", thinking === level && "border-ring bg-card font-medium")}
            >
              {t(`thinking.${level}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Model trigger and list. Hovering or focusing a row previews it beside the list; choosing a
 * thinking level there selects that model too. Esc or an outside press closes the list.
 */
export function ModelPicker({ model, thinking, onChange }: { model: ModelItem; thinking: ThinkingLevel; onChange: (model: ModelItem, thinking: ThinkingLevel) => void }) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(model.id);
  const [pos, setPos] = useState<{ bottom: number; right: number } | null>(null);
  const shown = models.find((m) => m.id === hover) ?? model;
  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const r = trigger.current!.getBoundingClientRect();
    setPos({ bottom: innerHeight - r.top + 8, right: Math.max(8, innerWidth - r.right) });
    setHover(model.id);
    const outside = (e: MouseEvent) => !root.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node) && setOpen(false);
    const escape = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const level = (m: ModelItem): ThinkingLevel => (m.id === model.id ? thinking : m.thinking.includes("high") ? "high" : m.thinking.at(-1)!);

  return (
    <>
      <Tooltip label={t("model")}>
        <button
          ref={trigger}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${t("model")}: ${model.name} ${t(`thinking.${thinking}`)}`}
          onClick={() => setOpen(!open)}
          className={cn("inline-flex h-8 items-center gap-1 rounded-md px-2 text-ui-sm outline-none hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50", open && "bg-card")}
        >
          {model.name} <span className="text-muted-foreground">{t(`thinking.${thinking}`)}</span>
        </button>
      </Tooltip>
      {open &&
        createPortal(
          <div ref={root} className={cn("fixed z-50 flex items-end gap-2", !pos && "opacity-0")} style={pos ?? { bottom: 0, right: 0 }}>
            <ModelDetail model={shown} thinking={level(shown)} onThinking={(l) => onChange(shown, l)} />
            <ul
              role="listbox"
              aria-label={t("model")}
              className="w-64 rounded-xl border bg-popover p-1 shadow-md"
              onKeyDown={(e) => {
                const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=option]")];
                const i = items.indexOf(document.activeElement as HTMLElement);
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
                }
              }}
            >
              {models.map((m) => (
                <li
                  key={m.id}
                  role="option"
                  tabIndex={0}
                  autoFocus={m.id === model.id}
                  aria-selected={m.id === model.id}
                  onMouseEnter={() => setHover(m.id)}
                  onFocus={() => setHover(m.id)}
                  onClick={() => {
                    onChange(m, level(m));
                    close();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onChange(m, level(m));
                      close();
                    }
                  }}
                  className={cn("flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none focus:bg-card", hover === m.id && "bg-card")}
                >
                  {m.id === model.id ? <Check className="size-4 shrink-0" /> : <Cpu className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="text-ui-xs text-muted-foreground">{m.provider}</span>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
