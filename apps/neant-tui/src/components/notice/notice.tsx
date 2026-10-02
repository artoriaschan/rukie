import { Text } from "@neant/tui";

export function Notice({ kind, text }: { kind: "info" | "error"; text: string }) {
  return kind === "error" ? (
    <Text color="red">{text}</Text>
  ) : (
    <Text dimColor wrap="truncate">
      {text}
    </Text>
  );
}
