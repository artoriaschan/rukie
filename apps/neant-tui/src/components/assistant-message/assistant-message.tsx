import { ThemedText, figures } from "@neant/tui";

export function AssistantMessage({ text }: { text: string }) {
  return (
    <ThemedText>
      <ThemedText color="accent">{figures.assistant}</ThemedText> {text}
    </ThemedText>
  );
}
