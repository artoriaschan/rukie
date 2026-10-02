import { ThemedText, figures } from "@neant/tui";

export function UserMessage({ text }: { text: string }) {
  return <ThemedText>{`${figures.user} ${text}`}</ThemedText>;
}
