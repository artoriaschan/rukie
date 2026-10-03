import { Box, ThemedBox, ThemedText, figures } from "@neant/tui";

export function UserMessage({ text }: { text: string }) {
  return (
    <ThemedBox color="userPromptLabel" paddingRight={3}>
      <Box width={2} flexShrink={0}>
        <ThemedText bold>{figures.user}</ThemedText>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <ThemedText bold preserveWhitespace>
          {text}
        </ThemedText>
      </Box>
    </ThemedBox>
  );
}
