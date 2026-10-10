// PROTOTYPE pinned Session summary after the Codex reference: a card pinned to the top-right of
// the conversation, toggled from the title bar. It stays open while scrolling and does not move
// focus or block the Transcript; Esc closes it when focus is inside.
import { motion } from "motion/react";
import { ChevronRight, CircleCheck, Circle, FileDiff, GitBranch, Link2, Loader2, Workflow } from "lucide-react";
import { useState } from "react";
import { summary } from "./data";
import { useT } from "./i18n";
import { cn } from "./ui";

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-t py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <h3 className="mb-1.5 flex items-center text-ui-sm text-muted-foreground">
        <span className="flex-1">{title}</span>
        {aside}
      </h3>
      {children}
    </section>
  );
}

export function SummaryPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [files, setFiles] = useState(false);
  const add = summary.changes.reduce((n, c) => n + c.add, 0);
  const del = summary.changes.reduce((n, c) => n + c.del, 0);
  const doneTodos = summary.todos.filter((x) => x.done).length;
  return (
    <motion.aside
      id="session-summary"
      aria-label={t("summary")}
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ type: "spring", duration: 0.3, bounce: 0 }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="absolute top-2 right-3 z-20 max-h-[calc(100%-1rem)] w-72 origin-top-right overflow-y-auto rounded-xl border bg-popover p-3 shadow-md max-sm:right-2 max-sm:left-2 max-sm:w-auto"
    >
      <Section title={summary.project}>
        <button type="button" aria-expanded={files} onClick={() => setFiles(!files)} className="flex w-full items-center gap-2 rounded-md py-1 text-left text-ui-base font-medium outline-none hover:text-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <FileDiff className="size-4" />
          <span className="flex-1">{t("changes")}</span>
          <span className="font-mono text-ui-sm text-success">+{add}</span>
          <span className="font-mono text-ui-sm text-danger">-{del}</span>
          <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", files && "rotate-90")} />
        </button>
        {files && (
          <ul className="mt-1 space-y-0.5 pl-6">
            {summary.changes.map((c) => (
              <li key={c.path} className="flex min-w-0 items-center gap-2 font-mono text-ui-sm">
                <span className="min-w-0 flex-1 truncate" title={c.path}>
                  {c.path.split("/").at(-1)}
                </span>
                <span className="text-success">+{c.add}</span>
                <span className="text-danger">-{c.del}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex min-w-0 items-center gap-2 py-1 text-ui-sm">
          <GitBranch className="size-4 shrink-0 text-violet" aria-label={t("branch")} />
          <span className="min-w-0 truncate font-mono">{summary.branch}</span>
        </div>
      </Section>
      <Section title={t("todos")} aside={<span className="font-mono text-ui-xs">{doneTodos}/{summary.todos.length}</span>}>
        <ul className="space-y-1">
          {summary.todos.map((todo) => (
            <li key={todo.text} className={cn("flex items-start gap-2 text-ui-sm", todo.done && "text-muted-foreground line-through")}>
              {todo.done ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" /> : <Circle className="mt-0.5 size-3.5 shrink-0" />}
              <span>{todo.text}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("subagents")}>
        <div className="flex items-center gap-2 text-ui-sm">
          <Workflow className="size-4 text-muted-foreground" />
          <span className="flex-1">{t("subagentStatus", { done: summary.subagents.done, running: summary.subagents.running })}</span>
          {summary.subagents.running > 0 && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>
      </Section>
      <Section title={t("sources")}>
        <ul className="space-y-1">
          {summary.sources.map((s) => (
            <li key={s}>
              <a href="#" className="flex min-w-0 items-center gap-2 rounded-sm text-ui-sm text-muted-foreground outline-none hover:text-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <Link2 className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate font-mono">{s}</span>
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </motion.aside>
  );
}
