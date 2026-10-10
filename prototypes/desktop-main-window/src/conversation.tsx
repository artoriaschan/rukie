// PROTOTYPE conversation after the Codex reference (figure 2): user prompts as right-aligned
// bubbles, each finished Turn folded behind a "用时 …" rule showing only its final reply, the live
// Turn fully expanded. A dash rail on the left edge jumps between Turns.
import { ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { PermissionResult, StepRow } from "./blocks";
import { turns as scripted, type SessionItem, type Turn } from "./data";
import { useT } from "./i18n";
import { useProto, type RunStatus } from "./state";
import { cn, RichText } from "./ui";

/** Scripted Transcript for s1; a one-Turn placeholder history for every other existing Session. */
export function turnsOf(session: SessionItem, created: boolean): Turn[] {
  if (session.id === "s1") return scripted;
  if (created) return [];
  return [
    {
      id: `${session.id}-t1`,
      prompt: session.title,
      status: "done",
      elapsed: "2分钟 05秒",
      items: [
        { kind: "step", id: `${session.id}-r`, tool: "Read", title: "README.md", status: "done", ms: 30, output: ["… 86 行"] },
        { kind: "text", id: `${session.id}-x`, text: `（原型占位）这是「${session.title}」的历史会话，展开“用时”可以看到步骤。` },
      ],
    },
  ];
}

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

function TurnView({ turn, index, status }: { turn: Turn; index: number; status: RunStatus }) {
  const t = useT();
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

export function TurnRail({ turns, active, onJump }: { turns: Turn[]; active: number; onJump: (i: number) => void }) {
  const t = useT();
  if (turns.length < 2) return null;
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

export function Conversation({ turns, sent, status }: { turns: Turn[]; sent: string[]; status: RunStatus }) {
  const t = useT();
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-6 pt-6 pb-8">
      {turns.map((turn, i) => (
        <TurnView key={turn.id} turn={turn} index={i} status={status} />
      ))}
      {sent.map((text, i) => (
        <div key={i} className="space-y-4">
          <Bubble text={text} />
          {i === sent.length - 1 && status === "running" && turns.length === 0 && (
            <div className="flex items-center gap-2 border-b pb-2 text-ui-sm text-muted-foreground" aria-live="polite">
              <Loader2 className="size-3.5 animate-spin" />
              {t("starting")}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
