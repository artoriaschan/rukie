import { Box, ThemedTextInput, ThemedText, figures, type TextInputProps } from "@neant/tui";

export function PromptInput({
  value,
  onChange,
  onSubmit,
  columns,
  maxLines,
  working = false,
  planMode = false,
  history,
  readOnly = false,
  compact = false,
  tip,
  filterInput,
}: {
  value: string;
  onChange(value: string): void;
  onSubmit(prompt: string): void;
  columns: number;
  maxLines: number;
  working?: boolean;
  planMode?: boolean;
  history?: TextInputProps["history"];
  readOnly?: boolean;
  compact?: boolean;
  tip?: string;
  filterInput?: TextInputProps["filterInput"];
}) {
  const edge = "─".repeat(Math.max(0, columns - 2));
  return (
    <Box flexDirection="column" marginTop={compact ? 0 : 1}>
      {!compact && (
        <ThemedText
          color={planMode ? "plan" : "promptBorder"}
          wrap="truncate"
        >{`╭${edge}╮`}</ThemedText>
      )}
      <Box paddingRight={1}>
        <Box width={2} flexShrink={0}>
          <ThemedText dimColor={working}>{`${figures.user} `}</ThemedText>
        </Box>
        <Box flexGrow={1}>
          <ThemedTextInput
            isActive={!readOnly}
            readOnly={readOnly}
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            maxLines={maxLines}
            columns={Math.max(1, columns - 3)}
            cursorStyle="block"
            history={history}
            filterInput={filterInput}
          />
        </Box>
      </Box>
      {!compact && (
        <ThemedText
          color={planMode ? "plan" : "promptBorder"}
          wrap="truncate"
        >{`╰${edge}╯`}</ThemedText>
      )}
      {tip && (
        <Box
          position="absolute"
          top={-1}
          right={1}
          width={Math.min(Bun.stringWidth(tip), Math.max(1, columns - 3))}
          height={1}
        >
          <ThemedText dimColor wrap="truncate">
            {tip}
          </ThemedText>
        </Box>
      )}
    </Box>
  );
}
