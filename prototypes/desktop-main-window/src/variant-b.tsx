// Variant B · Focus: no persistent sidebar; Session switcher popover in the title bar.
// Each Turn folds its tool calls into one step timeline; the approval docks above the composer.
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronRight, Loader2, Plus, ShieldAlert, WifiOff } from "lucide-react";
import { useState } from "react";
import { PermissionCard, ToolBody, ToolStatus } from "./blocks";
import { Composer, RunStatusBadge, SessionList, TurnIndicator } from "./composer";
import { projects, transcript, type Item } from "./data";
import { useT } from "./i18n";
import { useProto } from "./state";
import { Badge, Button, cn, Kbd, RichText, toolIcons } from "./ui";

export const name = "专注单栏";

type ToolItem = Extract<Item, { kind: "tool" }>;

function StepTimeline({ steps }: { steps: ToolItem[] }) {
  const t = useT();
  const failed = steps.some((s) => s.status === "error");
  const [open, setOpen] = useState(failed);
  const [detail, setDetail] = useState<string | null>(failed ? steps.find((s) => s.status === "error")!.id : null);
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-ui-sm text-muted-foreground outline-none hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
        <span>{t("steps", { n: steps.length })}</span>
        <span className="flex gap-1">
          {steps.map((s) => (
            <ToolStatus key={s.id} status={s.status} />
          ))}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
            className="relative border-t py-1"
          >
            {steps.map((s) => {
              const Icon = toolIcons[s.tool];
              return (
                <li key={s.id} className="relative pl-7">
                  <span aria-hidden className="absolute top-0 bottom-0 left-[18px] w-px bg-border" />
                  <button
                    type="button"
                    aria-expanded={detail === s.id}
                    onClick={() => setDetail(detail === s.id ? null : s.id)}
                    className="flex w-full min-w-0 items-center gap-2 py-1.5 pr-3 text-left text-ui-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <Icon className="relative size-4 shrink-0 bg-background text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono">{s.title}</span>
                    <ToolStatus status={s.status} />
                  </button>
                  {detail === s.id && (
                    <div className="mr-3 mb-2 overflow-hidden rounded-md border bg-card">
                      <ToolBody item={s} />
                    </div>
                  )}
                </li>
              );
            })}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Groups consecutive tool calls so the Transcript reads as prose plus one fold per step run. */
function groupItems(items: Item[]) {
  const out: (Item | { kind: "steps"; id: string; steps: ToolItem[] })[] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (item.kind === "tool") {
      if (last?.kind === "steps") last.steps.push(item);
      else out.push({ kind: "steps", id: `g-${item.id}`, steps: [item] });
    } else out.push(item);
  }
  return out;
}

function ConnectionChip() {
  const t = useT();
  const { connection } = useProto();
  if (connection === "connected") return null;
  return (
    <Badge variant={connection === "reconnecting" ? "warning" : "danger"}>
      {connection === "reconnecting" ? <Loader2 className="animate-spin" /> : <WifiOff />}
      <span title={t("disconnectedHint")}>{t(connection)}</span>
    </Badge>
  );
}

export function VariantB() {
  const t = useT();
  const { status, reply, sent } = useProto();
  const [picker, setPicker] = useState(false);
  const permission = transcript.find((i) => i.kind === "permission");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-ui-base font-semibold">{t("appName")}</span>
        <span className="text-muted-foreground">/</span>
        <span className="text-ui-sm text-muted-foreground">{projects[0].name}</span>
        <span className="text-muted-foreground">/</span>
        <button
          type="button"
          aria-expanded={picker}
          aria-label={t("selectSession")}
          onClick={() => setPicker(!picker)}
          className="flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-ui-base font-medium outline-none hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="truncate">{projects[0].sessions[0].title}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
        <Kbd>⌘K</Kbd>
        <span className="ml-auto flex items-center gap-2">
          <ConnectionChip />
          <RunStatusBadge status={status} />
          <Button size="sm" variant="outline">
            <Plus /> <span className="max-sm:sr-only">{t("newSession")}</span>
          </Button>
        </span>
        {picker && (
          <div className="absolute top-11 left-24 z-30 w-80 rounded-md border bg-popover p-2 shadow-md">
            <SessionList dense />
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
          {groupItems(transcript).map((item) => {
            if (item.kind === "user")
              return (
                <div key={item.id} className="border-l-2 border-accent pl-3 font-medium">
                  {item.text}
                </div>
              );
            if (item.kind === "assistant")
              return (
                <p key={item.id} className="leading-relaxed">
                  <RichText text={item.text} />
                </p>
              );
            if (item.kind === "steps") return <StepTimeline key={item.id} steps={item.steps} />;
            if (item.kind === "permission")
              return reply ? (
                <PermissionCard key={item.id} item={item} />
              ) : (
                <div key={item.id} className="flex items-center gap-2 text-ui-sm text-warning">
                  <ShieldAlert className="size-4" /> {t("permissionTitle", { tool: item.tool })} ↓
                </div>
              );
            return null;
          })}
          {sent.map((text, i) => (
            <div key={i} className="border-l-2 border-accent pl-3 font-medium">
              {text}
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto w-full max-w-2xl space-y-2 px-4 pb-4">
        {permission?.kind === "permission" && !reply && <PermissionCard item={permission} layout="dock" />}
        <TurnIndicator />
        <Composer />
      </div>
    </div>
  );
}
