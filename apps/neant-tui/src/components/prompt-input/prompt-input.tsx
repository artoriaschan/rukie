import { Box, ThemedTextInput, ThemedText, figures } from "@neant/tui";

export function PromptInput({
  value,
  onChange,
  onSubmit,
  columns,
  maxLines,
  working = false,
}: {
  value: string;
  onChange(value: string): void;
  onSubmit(prompt: string): void;
  columns: number;
  maxLines: number;
  working?: boolean;
}) {
  const edge = "─".repeat(Math.max(0, columns - 2));
  return (
    <Box flexDirection="column" marginTop={1}>
      <ThemedText color="promptBorder" wrap="truncate">{`╭${edge}╮`}</ThemedText>
      <Box paddingRight={1}>
        <Box width={2} flexShrink={0}>
          <ThemedText dimColor={working}>{`${figures.user} `}</ThemedText>
        </Box>
        <Box flexGrow={1}>
          <ThemedTextInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            maxLines={maxLines}
            columns={Math.max(1, columns - 3)}
            cursorStyle="block"
          />
        </Box>
      </Box>
      <ThemedText color="promptBorder" wrap="truncate">{`╰${edge}╯`}</ThemedText>
    </Box>
  );
}
