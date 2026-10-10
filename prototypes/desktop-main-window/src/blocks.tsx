// PROTOTYPE leaf blocks: tool step rows, the docked permission card, connection notice.
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, CircleAlert, Loader2, ShieldAlert, ShieldCheck, ShieldX, WifiOff } from "lucide-react";
import { useState } from "react";
import type { Permission, PermissionReply, Step } from "./data";
import { useT } from "./i18n";
import { useProto } from "./state";
import { Button, cn, Kbd, toolIcons } from "./ui";

function StepBody({ step }: { step: Step }) {
  if (step.diff) {
    return (
      <pre className="overflow-x-auto py-1 font-mono text-[12px] leading-5">
        {step.diff.map((line, i) => (
          <div key={i} className={cn("px-3", line.sign === "+" && "bg-diff-added", line.sign === "-" && "bg-diff-removed")}>
            <span className="mr-3 select-none text-muted-foreground">{line.sign}</span>
            {line.text}
          </div>
        ))}
      </pre>
    );
  }
  return <pre className="overflow-x-auto px-3 py-2 font-mono text-[12px] leading-5 text-muted-foreground">{step.output?.join("\n")}</pre>;
}

/**
 * One tool call as a quiet one-line row ("运行了命令 bun test …"). Output stays folded;
 * failed steps show their output immediately because that is what the user reads next.
 */
export function StepRow({ step }: { step: Step }) {
  const t = useT();
  const [open, setOpen] = useState(step.status === "error");
  const Icon = toolIcons[step.tool];
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-ui-base text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Icon className="size-4 shrink-0" />
        <span className="shrink-0">{t(`tool.${step.tool}`)}</span>
        <span className="min-w-0 truncate font-mono text-ui-sm">{step.title}</span>
        {step.status === "error" && <CircleAlert className="size-4 shrink-0 text-danger" aria-label={t("status.error")} />}
        {step.status === "running" && <Loader2 className="size-4 shrink-0 animate-spin" aria-label={t("status.running")} />}
        <ChevronRight className={cn("size-4 shrink-0 opacity-0 transition-transform group-hover:opacity-100 group-focus-visible:opacity-100", open && "rotate-90 opacity-100")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
            className="overflow-hidden"
          >
            <div className="my-1 overflow-hidden rounded-lg border bg-card">
              <StepBody step={step} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Resolved permission, left in the Turn as a quiet row so the Transcript records the decision. */
export function PermissionResult({ item, reply }: { item: Permission; reply: PermissionReply }) {
  const t = useT();
  const Icon = reply === "deny" ? ShieldX : ShieldCheck;
  return (
    <div className="flex min-w-0 items-center gap-2 py-1 text-ui-base text-muted-foreground">
      <Icon className={cn("size-4 shrink-0", reply === "deny" ? "text-danger" : "text-success")} />
      <span className="shrink-0">{t(`reply.${reply}`)}</span>
      <span className="min-w-0 truncate font-mono text-ui-sm">{item.command}</span>
    </div>
  );
}

/**
 * Pending permission Interaction docked above the composer. Allow is the primary action;
 * Esc denies and A allows for the session while the card has focus. Offline disables replies.
 */
export function PermissionDock({ item }: { item: Permission }) {
  const t = useT();
  const { answer, connection } = useProto();
  const offline = connection !== "connected";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", duration: 0.35, bounce: 0.1 }}
      role="group"
      aria-label={t("permissionTitle", { tool: item.tool })}
      onKeyDown={(e) => {
        if (offline) return;
        if (e.key === "Escape") answer("deny");
        if (e.key.toLowerCase() === "a") answer("allow-session");
      }}
      className="rounded-2xl border bg-background p-3 shadow-sm"
    >
      <div className="flex items-center gap-2 text-ui-base font-medium">
        <ShieldAlert className="size-4 text-warning" />
        {t("permissionTitle", { tool: item.tool })}
      </div>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-card px-3 py-2 font-mono text-[12px] leading-5">$ {item.command}</pre>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-ui-sm text-muted-foreground">{item.reason}</p>
        <Button size="sm" variant="ghost" disabled={offline} onClick={() => answer("deny")}>
          {t("deny")} <Kbd>Esc</Kbd>
        </Button>
        <Button size="sm" variant="outline" disabled={offline} onClick={() => answer("allow-session")}>
          {t("allowSession")} <Kbd>A</Kbd>
        </Button>
        <Button size="sm" autoFocus disabled={offline} onClick={() => answer("allow")}>
          {t("allow")} <Kbd>↵</Kbd>
        </Button>
      </div>
    </motion.div>
  );
}

export function ConnectionNotice() {
  const t = useT();
  const { connection } = useProto();
  if (connection === "connected") return null;
  return (
    <div role="status" className="flex items-center gap-2 px-1 text-ui-sm">
      {connection === "reconnecting" ? <Loader2 className="size-4 animate-spin text-warning" /> : <WifiOff className="size-4 text-danger" />}
      <span className="font-medium">{t(connection)}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={t("disconnectedHint")}>
        {t("disconnectedHint")}
      </span>
      {connection === "disconnected" && (
        <Button size="xs" variant="outline">
          {t("retry")}
        </Button>
      )}
    </div>
  );
}
