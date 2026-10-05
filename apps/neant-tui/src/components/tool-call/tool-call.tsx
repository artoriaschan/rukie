import { useState } from "react";
import type { PromptImage } from "@neant/agent";
import { ImagePlaceholder } from "../image-placeholder";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";
import { Markdown } from "../markdown";
import { StatusIcon, ThemedBox, ThemedText, figures, type StatusIconProps } from "@neant/tui";

export function ToolCall({
  summary,
  status,
  outcomeUnknown = false,
  result,
  images,
  onImageOpen,
  error,
  planReview,
  locale = "zh",
}: {
  summary: string;
  status: StatusIconProps["status"];
  outcomeUnknown?: boolean;
  result?: string;
  images?: PromptImage[];
  onImageOpen?(image: PromptImage): void;
  error?: string;
  locale?: Locale;
  planReview?: { plan: string; kind: "approve" | "revise" | "takeover"; feedback?: string };
}) {
  const [expanded, setExpanded] = useState(false);
  const t = createTuiI18n(locale);
  if (planReview)
    return (
      <ThemedBox flexDirection="column">
        <ThemedBox onClick={() => setExpanded((value) => !value)}>
          <ThemedText
            color="plan"
            wrap="truncate"
          >{`${planReview.kind === "approve" ? (expanded ? "▾" : "▸") : "▾"} ${t(planReview.kind === "approve" ? "plan.review.approved" : planReview.kind === "revise" ? "plan.review.revised" : "plan.review.takeover")}${planReview.kind === "approve" ? ` · ${t(expanded ? "plan.review.collapse" : "plan.review.expand")}` : ""}`}</ThemedText>
        </ThemedBox>
        {(expanded || planReview.kind !== "approve") && <Markdown text={planReview.plan} />}
        {planReview.kind === "revise" && (
          <ThemedText>{`${t("plan.review.feedback")}: ${planReview.feedback ?? ""}`}</ThemedText>
        )}
      </ThemedBox>
    );
  const output = status === "error" ? error?.split(/\r?\n/).slice(0, 3).join("\n") : result;
  return (
    <ThemedBox flexDirection="column">
      <ThemedText wrap="truncate">
        {outcomeUnknown ? (
          <ThemedText color="warning">?</ThemedText>
        ) : (
          <StatusIcon status={status} />
        )}{" "}
        {summary}
      </ThemedText>
      {status !== "running" && output && (
        <ThemedBox color={status === "error" ? "error" : "text"}>
          <ThemedBox width={2}>
            <ThemedText>{figures.result}</ThemedText>
          </ThemedBox>
          <ThemedText wrap="truncate">{output}</ThemedText>
        </ThemedBox>
      )}
      {images?.map((image, index) => (
        <ImagePlaceholder key={index} image={image} onOpen={onImageOpen} />
      ))}
    </ThemedBox>
  );
}
