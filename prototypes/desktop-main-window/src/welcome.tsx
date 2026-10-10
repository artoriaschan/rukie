// PROTOTYPE welcome page for a new Session (Codex reference figure 1): a centered prompt naming
// the target, and a picker that moves the new Session between the default workspace and projects.
import { Check, Folder, MessageSquare, SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { projects } from "./data";
import { useT } from "./i18n";
import { useProto } from "./state";
import { cn } from "./ui";

/** Target picker shared by the welcome heading and the composer's context band. */
export function TargetPicker({ variant }: { variant: "heading" | "chip" }) {
  const t = useT();
  const { selection, select } = useProto();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const projectId = selection.kind === "new" ? selection.projectId : null;
  const current = projects.find((p) => p.id === projectId);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const options = [{ id: null, name: t("defaultWorkspace"), hint: t("noProjectHint") }, ...projects.map((p) => ({ id: p.id, name: p.name, hint: p.path }))];
  return (
    <div ref={box} className="relative inline-block" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("chooseTarget")}
        onClick={() => setOpen(!open)}
        className={cn(
          "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          variant === "heading" ? "rounded-sm underline decoration-border-strong decoration-dashed underline-offset-6 hover:decoration-foreground" : "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-ui-sm hover:bg-background",
        )}
      >
        {variant === "chip" && (current ? <Folder className="size-3.5 text-muted-foreground" /> : <MessageSquare className="size-3.5 text-muted-foreground" />)}
        {current?.name ?? t("defaultWorkspace")}
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t("chooseTarget")}
          className={cn("absolute z-30 w-72 rounded-md border bg-popover p-1 text-left shadow-md", variant === "heading" ? "top-full left-1/2 mt-2 -translate-x-1/2" : "bottom-full left-0 mb-2")}
        >
          {options.map((o) => (
            <li key={o.id ?? "default"} role="option" aria-selected={o.id === projectId}>
              <button
                type="button"
                autoFocus={o.id === projectId}
                onClick={() => {
                  select({ kind: "new", projectId: o.id });
                  setOpen(false);
                }}
                className="flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-card focus-visible:bg-card"
              >
                {o.id ? <Folder className="size-4 shrink-0 text-muted-foreground" /> : <MessageSquare className="size-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-ui-base">{o.name}</span>
                  <span className="block truncate font-mono text-ui-xs text-muted-foreground">{o.hint}</span>
                </span>
                {o.id === projectId && <Check className="size-4 shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Welcome() {
  const t = useT();
  const { selection } = useProto();
  const inProject = selection.kind === "new" && selection.projectId !== null;
  const [before, after] = t.parts("welcomeProject", "project");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 pb-24 text-center">
      <span className="flex size-12 items-center justify-center rounded-full border text-muted-foreground">
        <SquareTerminal className="size-6" />
      </span>
      <h1 className="text-ui-xl font-medium text-balance">
        {inProject ? (
          <>
            {before}
            <TargetPicker variant="heading" />
            {after}
          </>
        ) : (
          t("welcomeChat")
        )}
      </h1>
      {!inProject && (
        <p className="text-ui-sm text-muted-foreground">
          <TargetPicker variant="heading" />
        </p>
      )}
    </div>
  );
}
