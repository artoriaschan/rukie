import { Box, ThemedText, figures } from "@neant/tui";
import { Markdown } from "@neant/tui";
import { useSmoothText } from "@neant/tui";

export function AssistantMessage({
  text,
  revealKey = "assistant",
  streaming = false,
}: {
  text: string;
  revealKey?: string;
  streaming?: boolean;
}) {
  const visible = useSmoothText(revealKey, text, streaming);
  const body = visible
    .split("\n")
    .filter((line) => !line.startsWith("⏵"))
    .join("\n")
    .replace(/^(?:[ \t]*\r?\n)+/, "");
  if (!body.trim()) return null;
  return (
    <Box>
      <Box width={2} flexShrink={0}>
        <ThemedText color="text">{figures.assistant}</ThemedText>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Markdown text={body} />
      </Box>
    </Box>
  );
}
