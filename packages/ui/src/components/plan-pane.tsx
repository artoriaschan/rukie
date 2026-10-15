import { Lightbulb, Copy, Download, PanelRightClose, X } from "lucide-react";
import { Tabs } from "radix-ui";
import { useLayoutEffect, useRef } from "react";
import type { PlanSubmission } from "../lib/plans";
import { useAppText } from "../lib/i18n";
import { usePlanActions } from "../lib/use-plan-actions";
import { Markdown } from "./markdown";
import { Button } from "./motion/button/base";
import { ScrollArea } from "./ui/scroll-area";

export function PlanPane({
  plans,
  active,
  focusRequest,
  onSelect,
  onCloseTab,
  onClose,
}: {
  plans: PlanSubmission[];
  active: string;
  focusRequest: number;
  onSelect: (id: string) => void;
  onCloseTab: (id: string) => void;
  onClose: () => void;
}) {
  const t = useAppText();
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    root.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus({ preventScroll: true });
  }, [active, focusRequest]);
  return (
    <aside ref={root} aria-label={t("plan.pane")} className="plan-pane">
      <Tabs.Root
        value={active}
        onValueChange={onSelect}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <div className="plan-pane-tabbar">
          <Tabs.List aria-label={t("plan.tabs")} className="plan-pane-tabs">
            {plans.map((plan) => (
              <div className="plan-pane-tab" data-active={plan.id === active} key={plan.id}>
                <Tabs.Trigger value={plan.id} className="plan-pane-trigger" title={plan.title}>
                  <Lightbulb aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-left">{plan.title}</span>
                </Tabs.Trigger>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("plan.close-tab", { title: plan.title })}
                  onClick={() => onCloseTab(plan.id)}
                >
                  <X />
                </Button>
              </div>
            ))}
          </Tabs.List>
          <Button size="icon" variant="ghost" aria-label={t("plan.close-pane")} onClick={onClose}>
            <PanelRightClose />
          </Button>
        </div>
        {plans.map((plan) => (
          <Tabs.Content
            key={plan.id}
            value={plan.id}
            className="flex min-h-0 flex-1 flex-col outline-none data-[state=inactive]:hidden"
          >
            <PlanDocument submission={plan} />
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </aside>
  );
}
function PlanDocument({ submission }: { submission: PlanSubmission }) {
  const t = useAppText();
  const { error, copy, download } = usePlanActions(submission);
  return (
    <>
      <header className="plan-pane-header">
        <div className="flex min-w-0 items-center gap-2 text-ui-sm text-muted-foreground">
          <Lightbulb aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{t("plan.label")}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon" variant="ghost" aria-label={t("plan.download")} onClick={download}>
            <Download />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("plan.copy")}
            onClick={() => {
              void copy();
            }}
          >
            <Copy />
          </Button>
        </div>
      </header>
      {error ? (
        <p role="alert" className="px-6 text-ui-sm text-danger">
          {error}
        </p>
      ) : null}
      <ScrollArea
        className="flex-1"
        viewportLabel={t("plan.document")}
        viewportClassName="px-8 pt-6 pb-8 break-words [overflow-wrap:anywhere]"
      >
        <Markdown text={submission.plan} />
      </ScrollArea>
    </>
  );
}
