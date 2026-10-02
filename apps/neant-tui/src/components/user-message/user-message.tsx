import { Text } from "@neant/tui";

export function UserMessage({ text }: { text: string }) {
  return <Text>{`> ${text}`}</Text>;
}
