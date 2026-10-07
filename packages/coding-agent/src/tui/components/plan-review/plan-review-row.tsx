import type { Locale } from "@neant/i18n";
import { ThemedBox, ThemedText } from "../../../ink/index.ts";
import { createTuiI18n } from "../../i18n";
import { Markdown } from "../../../ink/index.ts";

export function PlanReviewRow({
  plan,
  kind,
  feedback,
  expanded,
  onToggle,
  locale,
}: {
  plan: string;
  kind: "approve" | "revise" | "takeover";
  feedback?: string;
  expanded: boolean;
  onToggle(): void;
  locale: Locale;
}) {
  const t = createTuiI18n(locale);
  const title = `${expanded ? "▴" : "▾"} ${t(kind === "approve" ? "plan.review.approved" : kind === "revise" ? "plan.review.revised" : "plan.review.takeover")} · ${t(expanded ? "plan.review.collapse" : "plan.review.expand")}`;
  return (
    <ThemedBox flexDirection="column">
      <ThemedBox onClick={onToggle}>
        <ThemedText color="plan" wrap="truncate">
          {title}
        </ThemedText>
      </ThemedBox>
      {expanded && <Markdown text={plan} />}
      {kind === "revise" && (
        <ThemedText>{`${t("plan.review.feedback")}: ${feedback ?? ""}`}</ThemedText>
      )}
    </ThemedBox>
  );
}
