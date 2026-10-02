import { Box, Text, TextInput } from "@neant/tui";

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
    <Box>
      <Box width={2} flexShrink={0}>
        <Text>{">"}</Text>
      </Box>
      <Box flexGrow={1}>
        <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      </Box>
    </Box>
  );
}
