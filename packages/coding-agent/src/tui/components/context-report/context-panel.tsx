import type { Ref } from "react";
import type { ContextReport } from "@rukie/shared";
import type { Locale } from "@rukie/i18n";
import { Box, Divider, ScrollBox, ThemedText, type ScrollBoxHandle } from "../../../ink/index.ts";
import { usePanelScroll, type ReadingPosition } from "../../hooks/reading-position";
import { createTuiI18n } from "../../../view/i18n";
import { ContextVisualization } from "./context-visualization";

export function ContextPanel({
  report,
  modelName,
  rows,
  columns,
  locale,
  scrollRef,
  initialScroll,
  onClose,
}: {
  report: ContextReport;
  modelName?: string;
  rows: number;
  columns: number;
  locale: Locale;
  scrollRef: Ref<ScrollBoxHandle>;
  initialScroll?: ReadingPosition;
  onClose(): void;
}) {
  const t = createTuiI18n(locale);
  const panelScroll = usePanelScroll(scrollRef, initialScroll);
  return (
    <Box height={rows} flexShrink={0} flexDirection="column">
      <Divider title="/context" />
      <ScrollBox ref={panelScroll} flexGrow={1} flexShrink={1} minHeight={1} stickyScroll={false}>
        <ContextVisualization
          report={report}
          modelName={modelName}
          columns={columns}
          locale={locale}
        />
      </ScrollBox>
      <Box height={1} flexShrink={0} onClick={onClose}>
        <ThemedText dim wrap="truncate">
          {t("context.panel.hint")}
        </ThemedText>
      </Box>
    </Box>
  );
}
