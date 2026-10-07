import { Notice, type NoticeKind } from "../notice";
import { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  ThemedTextInput,
  ThemedText,
  figures,
  type TextInputProps,
} from "../../../ink/index.ts";

export function PromptInput({
  value,
  onChange,
  onSubmit,
  getValue,
  columns,
  maxLines,
  working = false,
  planMode = false,
  history,
  onHistoryRecall,
  inputRevision,
  readOnly = false,
  compact = false,
  tip,
  notice,
  warning,
  filterInput,
  onPaste,
  highlightRanges,
  atomicRanges,
  onCursorChange,
  onAtomicRangeClick,
  initialCursorOffset,
  suggestions,
}: {
  value: string;
  onChange: TextInputProps["onChange"];
  onSubmit(prompt: string): void;
  getValue?(): string;
  columns: number;
  maxLines: number;
  working?: boolean;
  planMode?: boolean;
  history?: TextInputProps["history"];
  onHistoryRecall?: TextInputProps["onHistoryRecall"];
  /** Remounts the editor after programmatic replacement while retaining the Tips lifetime. */
  inputRevision?: number;
  readOnly?: boolean;
  compact?: boolean;
  /** Expires after ten seconds; changing or clearing the content starts a new lifecycle. */
  tip?: string;
  notice?: { text: string; warning?: boolean; kind?: NoticeKind };
  /** Pre-wrapped additional warning occupies its own rows above the editor. */
  warning?: string;
  filterInput?: TextInputProps["filterInput"];
  onPaste?: TextInputProps["onPaste"];
  highlightRanges?: TextInputProps["highlightRanges"];
  atomicRanges?: TextInputProps["atomicRanges"];
  onCursorChange?: TextInputProps["onCursorChange"];
  onAtomicRangeClick?: TextInputProps["onAtomicRangeClick"];
  /** Restores the caret when a view or small terminal remounts the composer. */
  initialCursorOffset?: number;
  suggestions?: ReactNode;
}) {
  const [restoredCursor, setRestoredCursor] = useState(initialCursorOffset);
  const [visibleTip, setVisibleTip] = useState(tip);
  useEffect(() => {
    setVisibleTip(tip);
    if (!tip) return;
    const timer = setTimeout(() => setVisibleTip(undefined), 10000);
    return () => clearTimeout(timer);
  }, [tip]);
  const activeTip = visibleTip === tip ? visibleTip : undefined;
  const edge = "─".repeat(Math.max(0, columns - 2));
  return (
    <Box flexShrink={0} flexDirection="column" marginTop={compact && !notice ? 0 : 1}>
      {suggestions}
      {warning && <ThemedText color="warning">{warning}</ThemedText>}
      {!compact && (
        <ThemedText
          color={planMode ? "plan" : "promptBorder"}
          wrap="truncate"
        >{`╭${edge}╮`}</ThemedText>
      )}
      <Box flexShrink={0} paddingRight={1}>
        <Box width={2} flexShrink={0}>
          <ThemedText dim={working}>{`${figures.user} `}</ThemedText>
        </Box>
        <Box flexShrink={0} flexGrow={1}>
          <ThemedTextInput
            key={inputRevision}
            isActive={!readOnly}
            readOnly={readOnly}
            value={value}
            getValue={getValue}
            onChange={onChange}
            onSubmit={onSubmit}
            maxLines={maxLines}
            columns={Math.max(1, columns - 3)}
            cursorStyle="block"
            history={history}
            onHistoryRecall={onHistoryRecall}
            filterInput={filterInput}
            onPaste={onPaste}
            highlightRanges={highlightRanges}
            atomicRanges={atomicRanges}
            onAtomicRangeClick={onAtomicRangeClick}
            cursorOffset={restoredCursor}
            onCursorChange={(offset) => {
              setRestoredCursor(undefined);
              onCursorChange?.(offset);
            }}
          />
        </Box>
      </Box>
      {!compact && (
        <ThemedText
          color={planMode ? "plan" : "promptBorder"}
          wrap="truncate"
        >{`╰${edge}╯`}</ThemedText>
      )}
      {(notice || activeTip) && (
        <Box
          flexShrink={0}
          position="absolute"
          top={-1}
          right={1}
          width={Math.min(Bun.stringWidth(notice?.text ?? activeTip!), Math.max(1, columns - 3))}
          height={1}
        >
          {notice ? (
            <Notice
              kind={notice.kind ?? (notice.warning ? "warning" : "success")}
              color={notice.kind === "success" ? "success" : undefined}
              text={notice.text}
            />
          ) : (
            <ThemedText dim wrap="truncate">
              {activeTip}
            </ThemedText>
          )}
        </Box>
      )}
    </Box>
  );
}
