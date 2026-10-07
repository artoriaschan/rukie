import type { RefObject } from "react";
import { usePanelScroll } from "../../hooks/reading-position";
import {
  Box,
  Divider,
  ScrollBox,
  ThemedBox,
  ThemedText,
  ThemedTextInput,
  type ScrollBoxHandle,
} from "../../../ink/index.ts";
import type { Locale } from "@rukie/i18n";
import { createTuiI18n } from "../../../view/i18n";
import { Markdown } from "../markdown";

export function PlanReviewDialog({
  plan,
  selected,
  feedback,
  cursor,
  maxHeight,
  columns,
  locale,
  scrollRef,
  onSelect,
  onOption,
}: {
  plan: string;
  selected: number;
  feedback: string;
  cursor: number;
  maxHeight: number;
  columns: number;
  locale: Locale;
  scrollRef: RefObject<ScrollBoxHandle | null>;
  onSelect(index: number): void;
  onOption(index: number): void;
}) {
  const scroll = usePanelScroll(scrollRef, 0, columns);
  const t = createTuiI18n(locale);
  const prefix = `${t("plan.review.feedback")}: `;
  return (
    <Box flexShrink={0} flexDirection="column" paddingX={2} height={maxHeight}>
      <Divider title={t("plan.review.heading")} color="plan" />
      <ScrollBox
        ref={scroll}
        flexGrow={0}
        flexShrink={0}
        height={Math.max(1, maxHeight - 5)}
        stickyScroll={false}
      >
        <Markdown text={plan} />
      </ScrollBox>
      {["plan.review.approve", "plan.review.revise"].map((key, index) => (
        <ThemedBox flexShrink={0} key={key} height={1} onClick={() => onOption(index)}>
          <ThemedText
            color={selected === index ? "plan" : undefined}
            bold={selected === index}
            wrap="truncate"
          >{`${selected === index ? "❯" : " "} ${index + 1} ${t(key as "plan.review.approve" | "plan.review.revise")}`}</ThemedText>
        </ThemedBox>
      ))}
      <ThemedBox flexShrink={0} height={1} onClick={() => onSelect(2)}>
        <ThemedText
          color={selected === 2 ? "plan" : undefined}
        >{`${selected === 2 ? "❯" : " "} ${prefix}`}</ThemedText>
        <ThemedTextInput
          value={feedback}
          cursorOffset={cursor}
          cursorStyle={selected === 2 ? "block" : undefined}
          readOnly
          onChange={() => {}}
          columns={Math.max(1, columns - 6 - Bun.stringWidth(prefix))}
          maxLines={1}
        />
      </ThemedBox>
      <ThemedText dim wrap="truncate">
        {t("plan.review.hint")}
      </ThemedText>
    </Box>
  );
}
