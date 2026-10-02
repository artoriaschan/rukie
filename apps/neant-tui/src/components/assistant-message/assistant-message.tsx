import { ThemedText, figures } from "@neant/tui";

export function AssistantMessage({ text }: { text: string }) {
  const body = text
    .split("\n")
    .filter((line) => !line.startsWith("⏵"))
    .join("\n");
  if (!body) return null;
  return (
    <ThemedText>
      <ThemedText color="accent">{figures.assistant}</ThemedText> {body}
    </ThemedText>
  );
}
