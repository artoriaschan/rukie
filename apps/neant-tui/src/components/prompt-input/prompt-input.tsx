import { Box, Divider, TextInput, ThemedText, figures } from "@neant/tui";

export function PromptInput({
  value,
  onChange,
  onSubmit,
  columns,
  maxLines,
}: {
  value: string;
  onChange(value: string): void;
  onSubmit(prompt: string): void;
  columns: number;
  maxLines: number;
}) {
  return (
    <Box flexDirection="column">
      <Divider color="promptBorder" />
      <Box>
        <Box width={2} flexShrink={0}>
          <ThemedText>{`${figures.user} `}</ThemedText>
        </Box>
        <Box flexGrow={1}>
          <TextInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            maxLines={maxLines}
            columns={columns}
          />
        </Box>
      </Box>
      <Divider color="promptBorder" />
    </Box>
  );
}
