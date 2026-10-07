import type { Locale } from "@rukie/i18n";
import { ThemedBox, ThemedText } from "../../../ink/index.ts";
import { createTuiI18n } from "../../../view/i18n";
import { Markdown } from "../markdown";

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
    <ThemedBox flexShrink={0} flexDirection="column">
      <ThemedBox flexShrink={0} onClick={onToggle}>
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
