// PROTOTYPE conversation after the Codex reference: user prompts as right-aligned bubbles, each
// finished Turn folded behind a "用时 …" rule showing only its final reply, the live Turn fully
// expanded. A dash rail on the left edge jumps between Turns.
import { ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { PermissionResult, StepRow } from "./blocks";
import { turns, type Turn } from "./data";
import { useT } from "./i18n";
import { useProto } from "./state";
import { cn, RichText } from "./ui";

function Bubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl bg-card px-4 py-2 whitespace-pre-wrap">{text}</div>
    </div>
  );
}

function TurnBody({ turn }: { turn: Turn }) {
  const { reply } = useProto();
  return (
    <div className="space-y-2">
      {turn.items.map((item) => {
        if (item.kind === "text")
          return (
            <p key={item.id} className="leading-relaxed">
              <RichText text={item.text} />
            </p>
          );
        if (item.kind === "step") return <StepRow key={item.id} step={item} />;
        return reply ? <PermissionResult key={item.id} item={item} reply={reply} /> : null;
      })}
    </div>
  );
}

function TurnView({ turn, index }: { turn: Turn; index: number }) {
  const t = useT();
  const { status } = useProto();
  const live = turn.status === "live" && status !== "idle";
  const stopped = turn.status === "stopped" || (turn.status === "live" && status === "idle");
  const [open, setOpen] = useState(false);
  const last = turn.items.filter((i) => i.kind === "text").at(-1);
  const label = live ? t("working", { time: turn.elapsed }) : stopped ? t("stoppedAfter", { time: turn.elapsed }) : t("elapsed", { time: turn.elapsed });
  return (
    <section id={`turn-${index}`} aria-label={t("turnN", { n: index + 1, prompt: turn.prompt })} className="scroll-mt-4 space-y-4">
      <Bubble text={turn.prompt} />
      <div>
        {live ? (
          <div className="flex items-center gap-2 border-b pb-2 text-ui-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="size-3.5 animate-spin" />
            {status === "waiting" ? `${t("waiting")} · ${turn.elapsed}` : label}
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex w-full items-center gap-1 border-b pb-2 text-left text-ui-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {label}
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        )}
        <div className="pt-3">
          {live || open || stopped ? (
            <TurnBody turn={turn} />
          ) : (
            last && (
              <p className="leading-relaxed">
                <RichText text={last.text} />
              </p>
            )
          )}
        </div>
      </div>
    </section>
  );
}

export function TurnRail({ active, onJump }: { active: number; onJump: (i: number) => void }) {
  const t = useT();
  return (
    <nav aria-label={t("turnNav")} className="absolute top-1/2 left-3 z-10 flex -translate-y-1/2 flex-col gap-1.5 max-md:hidden">
      {turns.map((turn, i) => (
        <button
          key={turn.id}
          type="button"
          aria-label={t("turnN", { n: i + 1, prompt: turn.prompt })}
          aria-current={i === active ? "true" : undefined}
          title={turn.prompt}
          onClick={() => onJump(i)}
          className={cn("h-0.5 w-3 rounded-full outline-none transition-all hover:w-5 hover:bg-foreground focus-visible:ring-2 focus-visible:ring-ring", i === active ? "w-5 bg-foreground" : "bg-border-strong")}
        />
      ))}
    </nav>
  );
}

export function Conversation() {
  const { sent } = useProto();
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-6 pt-6 pb-8">
      {turns.map((turn, i) => (
        <TurnView key={turn.id} turn={turn} index={i} />
      ))}
      {sent.map((text, i) => (
        <Bubble key={i} text={text} />
      ))}
    </div>
  );
}
