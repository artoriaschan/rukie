// Variant A · Classic sidebar: persistent project/Session sidebar, linear Transcript with inline
// tool blocks and an inline approval card, connection banner under the header.
import { PanelLeft, Plus, Search, Settings } from "lucide-react";
import { useState } from "react";
import { ConnectionBanner, PermissionCard, ToolBlock } from "./blocks";
import { Composer, RunStatusBadge, SessionList, TurnIndicator } from "./composer";
import { projects, transcript } from "./data";
import { useT } from "./i18n";
import { useProto } from "./state";
import { Button, cn, Kbd, RichText } from "./ui";

export const name = "经典侧栏";

export function VariantA() {
  const t = useT();
  const { status, sent } = useProto();
  // Narrow windows start with the sidebar closed; it then opens as an overlay.
  const [sidebar, setSidebar] = useState(() => matchMedia("(min-width: 768px)").matches);
  return (
    <div className="flex h-full min-h-0">
      <aside className={cn("flex w-64 shrink-0 flex-col border-r bg-card", !sidebar && "hidden", "max-md:absolute max-md:inset-y-0 max-md:z-20 max-md:shadow-lg")}>
        <div className="flex h-12 items-center gap-2 px-3">
          <span className="flex-1 text-ui-base font-semibold">{t("appName")}</span>
          <Button size="icon-sm" variant="ghost" aria-label={t("toggleSidebar")} onClick={() => setSidebar(false)}>
            <PanelLeft />
          </Button>
        </div>
        <div className="space-y-2 px-3 pb-3">
          <Button variant="outline" size="sm" className="w-full justify-start">
            <Plus /> {t("newSession")} <span className="ml-auto"><Kbd>⌘N</Kbd></span>
          </Button>
          <label className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-ui-sm text-muted-foreground focus-within:ring-[3px] focus-within:ring-ring/50">
            <Search className="size-4" />
            <input placeholder={t("search")} aria-label={t("search")} className="min-w-0 flex-1 bg-transparent outline-none" />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          <SessionList />
        </div>
        <div className="flex items-center gap-2 border-t px-3 py-2">
          <Button size="xs" variant="ghost">
            <Plus /> {t("addProject")}
          </Button>
          <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Settings">
            <Settings />
          </Button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
          {!sidebar && (
            <Button size="icon-sm" variant="ghost" aria-label={t("toggleSidebar")} onClick={() => setSidebar(true)}>
              <PanelLeft />
            </Button>
          )}
          <h1 className="min-w-0 truncate text-ui-base font-semibold">{projects[0].sessions[0].title}</h1>
          <span className="hidden truncate font-mono text-ui-xs text-muted-foreground lg:inline">{projects[0].path}</span>
          <span className="ml-auto">
            <RunStatusBadge status={status} />
          </span>
        </header>
        <ConnectionBanner />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
            {transcript.map((item) => {
              if (item.kind === "user")
                return (
                  <div key={item.id} className="flex justify-end">
                    <div className="max-w-[80%] rounded-xl border bg-card px-4 py-2.5">{item.text}</div>
                  </div>
                );
              if (item.kind === "assistant")
                return (
                  <p key={item.id} className="leading-relaxed">
                    <RichText text={item.text} />
                  </p>
                );
              if (item.kind === "tool") return <ToolBlock key={item.id} item={item} />;
              return <PermissionCard key={item.id} item={item} />;
            })}
            {sent.map((text, i) => (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-xl border bg-card px-4 py-2.5">{text}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="mx-auto w-full max-w-3xl px-4 pb-4">
          <TurnIndicator />
          <Composer />
        </div>
      </main>
    </div>
  );
}
