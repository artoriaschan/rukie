import { useState } from "react";
import type { PlanSubmission } from "./plans";
import { useAppText } from "./i18n";

export function usePlanActions(submission: PlanSubmission) {
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
  return { error, copy, download };
}
