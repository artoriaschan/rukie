import { Box, Divider, TextInput, ThemedText, figures } from "@neant/tui";

export function PromptInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange(value: string): void;
  onSubmit(prompt: string): void;
}) {
  return (
    <Box flexDirection="column">
      <Divider color="promptBorder" />
      <Box>
        <Box width={2} flexShrink={0}>
          <ThemedText>{`${figures.user} `}</ThemedText>
        </Box>
        <Box flexGrow={1}>
          <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
        </Box>
      </Box>
      <Divider color="promptBorder" />
    </Box>
  );
}
