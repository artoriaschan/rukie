// PROTOTYPE shared blocks. Variants reuse the leaf pieces but own their layout.
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, CircleAlert, CircleCheck, Loader2, ShieldAlert, WifiOff } from "lucide-react";
import { useState } from "react";
import type { Item, PermissionReply } from "./data";
import { useT } from "./i18n";
import { useProto } from "./state";
import { Badge, Button, cn, Kbd, toolIcons } from "./ui";

type ToolItem = Extract<Item, { kind: "tool" }>;
type PermissionItem = Extract<Item, { kind: "permission" }>;

export function ToolStatus({ status }: { status: ToolItem["status"] }) {
  if (status === "running") return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  if (status === "error") return <CircleAlert className="size-4 text-danger" />;
  return <CircleCheck className="size-4 text-success" />;
}

export function ToolBody({ item }: { item: ToolItem }) {
  if (item.diff) {
    return (
      <pre className="overflow-x-auto py-1 font-mono text-[12px] leading-5">
        {item.diff.map((line, i) => (
          <div key={i} className={cn("px-3", line.sign === "+" && "bg-diff-added", line.sign === "-" && "bg-diff-removed")}>
            <span className="mr-3 select-none text-muted-foreground">{line.sign}</span>
            {line.text}
          </div>
        ))}
      </pre>
    );
  }
  return (
    <pre className="overflow-x-auto px-3 py-2 font-mono text-[12px] leading-5 text-muted-foreground">
      {item.output?.join("\n")}
    </pre>
  );
}

/** Collapsible tool call: header line always visible, output on demand. Errors open by default. */
export function ToolBlock({ item, compact = false }: { item: ToolItem; compact?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(item.status === "error" || Boolean(item.diff));
  const Icon = toolIcons[item.tool];
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-background", compact && "rounded-md")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-ui-sm outline-none hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono">{item.title}</span>
        {item.ms !== undefined && <span className="font-mono text-ui-xs text-muted-foreground">{(item.ms / 1000).toFixed(2)}s</span>}
        <ToolStatus status={item.status} />
        <span className="sr-only">{t(`tool.${item.status}`)}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
            className="border-t bg-card"
          >
            <ToolBody item={item} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReplyResult({ reply }: { reply: PermissionReply }) {
  const t = useT();
  const label = reply === "allow" ? t("allowed") : reply === "allow-session" ? t("allowedSession") : t("denied");
  return <Badge variant={reply === "deny" ? "danger" : "success"}>{label}</Badge>;
}

/**
 * Permission Interaction. Allow is the region's primary action; deny is outline so a stray Enter
 * cannot pick it. Keys: Enter allow, A allow for session, Esc deny (shown, wired only while focused).
 */
export function PermissionCard({ item, layout = "card" }: { item: PermissionItem; layout?: "card" | "dock" }) {
  const t = useT();
  const { reply, answer, connection } = useProto();
  const offline = connection !== "connected";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", duration: 0.35, bounce: 0.1 }}
      role="group"
      aria-label={t("permissionTitle", { tool: item.tool })}
      onKeyDown={(e) => {
        if (reply || offline) return;
        if (e.key === "Escape") answer("deny");
        if (e.key.toLowerCase() === "a") answer("allow-session");
      }}
      className={cn(
        "rounded-lg border bg-background shadow-sm",
        !reply && "border-warning/50",
        layout === "dock" && "shadow-md",
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ShieldAlert className="size-4 text-warning" />
        <span className="flex-1 text-ui-base font-medium">{t("permissionTitle", { tool: item.tool })}</span>
        {reply && <ReplyResult reply={reply} />}
      </div>
      <div className="space-y-2 px-3 py-3">
        <pre className="overflow-x-auto rounded-md border bg-card px-3 py-2 font-mono text-[12px] leading-5">$ {item.command}</pre>
        <p className="text-ui-sm text-muted-foreground">
          {t("reason")}：{item.reason}
        </p>
      </div>
      {!reply && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-3 py-2">
          <Button size="sm" variant="outline" disabled={offline} onClick={() => answer("deny")}>
            {t("deny")} <Kbd>Esc</Kbd>
          </Button>
          <Button size="sm" variant="secondary" disabled={offline} onClick={() => answer("allow-session")}>
            {t("allowSession")} <Kbd>A</Kbd>
          </Button>
          <Button size="sm" autoFocus disabled={offline} onClick={() => answer("allow")}>
            {t("allow")} <Kbd>↵</Kbd>
          </Button>
        </div>
      )}
    </motion.div>
  );
}

export function ConnectionBanner() {
  const t = useT();
  const { connection } = useProto();
  if (connection === "connected") return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-warning/40 bg-card px-4 py-2 text-ui-sm">
      {connection === "reconnecting" ? <Loader2 className="size-4 animate-spin text-warning" /> : <WifiOff className="size-4 text-danger" />}
      <span className="font-medium">{t(connection)}</span>
      <span className="min-w-0 flex-1 text-muted-foreground">{t("disconnectedHint")}</span>
      {connection === "disconnected" && (
        <Button size="xs" variant="outline">
          {t("retry")}
        </Button>
      )}
    </div>
  );
}
