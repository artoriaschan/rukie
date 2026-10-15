import { Copy, Download, Lightbulb, Maximize2 } from "lucide-react";
import { useState } from "react";
import type { PlanSubmission } from "../lib/plans";
import { useAppText } from "../lib/i18n";
import { Markdown } from "./markdown";
import { Button } from "./motion/button/base";
export function PlanPreview({
  submission,
  onExpand,
}: {
  submission: PlanSubmission;
  onExpand?: (submission: PlanSubmission) => void;
}) {
  const t = useAppText();
  const [error, setError] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(submission.plan);
      setError("");
    } catch {
      setError(t("plan.copy-error"));
    }
  };
  const download = () => {
    let url: string | undefined;
    try {
      url = URL.createObjectURL(
        new Blob([submission.plan], { type: "text/markdown;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${submission.title.replace(/[<>:"/\\|?*]|\p{Cc}/gu, "_").trim() || "plan"}.md`;
      link.click();
      setError("");
    } catch {
      setError(t("plan.download-error"));
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  };
  return (
    <div className="min-w-0">
      <section
        role="region"
        aria-label={t("plan.preview-label", { title: submission.title })}
        className="min-w-0 overflow-hidden rounded-2xl bg-input-surface ring-1 ring-inset ring-border"
      >
        <header className="flex h-11 items-center gap-2 px-4 text-ui-sm text-muted-foreground">
          <Lightbulb aria-hidden="true" className="size-3" />
          <span className="min-w-0 flex-1">{t("plan.label")}</span>
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
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("plan.expand")}
            disabled={!onExpand}
            onClick={() => onExpand?.(submission)}
          >
            <Maximize2 />
          </Button>
        </header>
        <div data-plan-body className="relative h-[248px] overflow-hidden px-4">
          <Markdown text={submission.plan} />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-input-surface to-transparent"
          />
        </div>
      </section>
      {submission.outcome ? (
        <p className="mt-2 text-ui-sm text-muted-foreground">
          {t(`plan.outcome-${submission.outcome}`)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-ui-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
