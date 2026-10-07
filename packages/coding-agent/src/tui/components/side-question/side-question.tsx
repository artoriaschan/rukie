import {
  Box,
  HintLine,
  ScrollBox,
  Spinner,
  ThemedText,
  type ScrollHandle,
} from "../../../ink/index.ts";
import type { RefObject } from "react";
import type { Locale } from "@neant/i18n";
import { Markdown } from "../markdown";
import { createTuiI18n } from "../../../view/i18n";

/** Pure presentation for the current auxiliary answer; Chat owns request and input state. */
export function SideQuestionPanel({
  question,
  answer,
  error,
  done,
  height,
  locale,
  scrollRef,
}: {
  question: string;
  answer: string;
  error?: string;
  done: boolean;
  height: number;
  locale: Locale;
  scrollRef: RefObject<ScrollHandle | null>;
}) {
  const t = createTuiI18n(locale);
  return (
    <Box flexDirection="column" height={height} flexShrink={0}>
      <ThemedText color="permission" bold wrap="truncate">{`/btw ${question}`}</ThemedText>
      <ScrollBox ref={scrollRef} height={Math.max(1, height - 2)}>
        {error ? (
          <ThemedText color="error">{error}</ThemedText>
        ) : answer ? (
          <Markdown text={answer} />
        ) : !done ? (
          <Box>
            <Spinner />
            <ThemedText color="permission">{` ${t("btw.answering")}`}</ThemedText>
          </Box>
        ) : null}
      </ScrollBox>
      <HintLine>{t("btw.hint")}</HintLine>
    </Box>
  );
}
