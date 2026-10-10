// Variant C · Workbench: project rail + Session column, conversation with one-line tool chips,
// right inspector holding the pending Interaction queue and the selected tool output.
import { FolderGit2, PanelRight, Plus, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { PermissionCard, ToolBody, ToolStatus } from "./blocks";
import { Composer, RunStatusBadge, SessionList, TurnIndicator } from "./composer";
import { projects, transcript, type Item } from "./data";
import { useT } from "./i18n";
import { useProto } from "./state";
import { Badge, Button, cn, RichText, toolIcons } from "./ui";

export const name = "工作台 + 检查器";

type ToolItem = Extract<Item, { kind: "tool" }>;

function StatusDot() {
  const t = useT();
  const { connection } = useProto();
  return (
    <span className="flex items-center gap-1.5 text-ui-xs text-muted-foreground" role="status">
      <span className={cn("size-2 rounded-full", connection === "connected" && "bg-success", connection === "reconnecting" && "bg-warning animate-pulse", connection === "disconnected" && "bg-danger")} />
      <span className={cn(connection === "connected" && "sr-only")}>{t(connection)}</span>
    </span>
  );
}

export function VariantC() {
  const t = useT();
  const { status, reply, sent, connection } = useProto();
  const [selected, setSelected] = useState<string | null>("t4");
  const [inspector, setInspector] = useState(true);
  const tool = transcript.find((i): i is ToolItem => i.kind === "tool" && i.id === selected);
  const permission = transcript.find((i) => i.kind === "permission");
  const pending = permission?.kind === "permission" && !reply;
  return (
    <div className="flex h-full min-h-0">
      <nav aria-label={t("projects")} className="flex w-14 shrink-0 flex-col items-center gap-2 border-r bg-card py-3 max-sm:hidden">
        {projects.map((p, i) => (
          <button
            key={p.id}
            type="button"
            aria-label={p.name}
            title={p.path}
            className={cn("flex size-9 items-center justify-center rounded-md border bg-background font-mono text-ui-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", i === 0 && "border-ring")}
          >
            {p.name.slice(0, 2)}
          </button>
        ))}
        <Button size="icon-sm" variant="ghost" aria-label={t("addProject")}>
          <FolderGit2 />
        </Button>
      </nav>
      <aside className="flex w-60 shrink-0 flex-col border-r max-lg:hidden">
        <div className="flex h-11 items-center gap-2 border-b px-3">
          <span className="flex-1 text-ui-sm font-semibold">{t("sessions")}</span>
          <Button size="icon-sm" variant="ghost" aria-label={t("newSession")}>
            <Plus />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <SessionList dense />
        </div>
        <div className="border-t px-3 py-2">
          <StatusDot />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
          <h1 className="min-w-0 truncate text-ui-base font-semibold">{projects[0].sessions[0].title}</h1>
          <span className="ml-auto flex items-center gap-2">
            <span className="lg:hidden">
              <StatusDot />
            </span>
            <RunStatusBadge status={status} />
            <Button size="icon-sm" variant="ghost" aria-pressed={inspector} aria-label={t("toggleInspector")} onClick={() => setInspector(!inspector)}>
              <PanelRight />
            </Button>
          </span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn("mx-auto max-w-3xl space-y-3 px-4 py-5", connection !== "connected" && "opacity-70")}>
            {transcript.map((item) => {
              if (item.kind === "user")
                return (
                  <div key={item.id} className="rounded-lg bg-card px-3 py-2">
                    {item.text}
                  </div>
                );
              if (item.kind === "assistant")
                return (
                  <p key={item.id} className="px-3 leading-relaxed">
                    <RichText text={item.text} />
                  </p>
                );
              if (item.kind === "tool") {
                const Icon = toolIcons[item.tool];
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected === item.id}
                    onClick={() => {
                      setSelected(item.id);
                      setInspector(true);
                    }}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-1 text-left text-ui-sm text-muted-foreground outline-none hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      selected === item.id && "bg-card text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-mono">{item.title}</span>
                    <ToolStatus status={item.status} />
                  </button>
                );
              }
              return reply ? (
                <div key={item.id} className="px-3">
                  <PermissionCard item={item} />
                </div>
              ) : (
                <button key={item.id} type="button" onClick={() => setInspector(true)} className="flex items-center gap-2 px-3 text-ui-sm text-warning outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  <ShieldAlert className="size-4" /> {t("permissionTitle", { tool: item.tool })} →
                </button>
              );
            })}
            {sent.map((text, i) => (
              <div key={i} className="rounded-lg bg-card px-3 py-2">
                {text}
              </div>
            ))}
          </div>
        </div>
        <div className="mx-auto w-full max-w-3xl px-4 pb-4">
          <TurnIndicator />
          <Composer />
        </div>
      </main>

      {inspector && (
        <aside aria-label={t("inspector")} className="flex w-96 shrink-0 flex-col border-l bg-card max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-20 max-md:h-1/2 max-md:w-full max-md:border-t max-md:shadow-lg">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 text-ui-sm font-semibold">{t("inspector")}</div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            {pending && permission?.kind === "permission" && (
              <section className="space-y-2">
                <h2 className="flex items-center gap-2 text-ui-sm font-medium text-muted-foreground">
                  {t("pending")} <Badge variant="warning">1</Badge>
                </h2>
                <PermissionCard item={permission} />
              </section>
            )}
            <section className="space-y-2">
              <h2 className="text-ui-sm font-medium text-muted-foreground">{t("output")}</h2>
              {tool ? (
                <div className="overflow-hidden rounded-lg border bg-background">
                  <div className="flex min-w-0 items-center gap-2 border-b px-3 py-2 text-ui-sm">
                    <span className="min-w-0 flex-1 truncate font-mono">{tool.title}</span>
                    <ToolStatus status={tool.status} />
                  </div>
                  <ToolBody item={tool} />
                </div>
              ) : (
                <p className="text-ui-sm text-muted-foreground">{t("noSelection")}</p>
              )}
            </section>
          </div>
        </aside>
      )}
    </div>
  );
}
