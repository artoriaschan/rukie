import { Box, ThemedText, figures } from "@neant/tui";

export function AssistantMessage({ text }: { text: string }) {
  const body = text
    .split("\n")
    .filter((line) => !line.startsWith("⏵"))
    .join("\n")
    .replace(/^(?:[ \t]*\r?\n)+/, "");
  if (!body.trim()) return null;
  return (
    <Box>
      <Box width={2} flexShrink={0}>
        <ThemedText color="accent">{figures.assistant}</ThemedText>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <ThemedText>{body}</ThemedText>
      </Box>
    </Box>
  );
}
