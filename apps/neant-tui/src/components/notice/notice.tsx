import { ThemedText } from "@neant/tui";

export function Notice({ kind, text }: { kind: "info" | "error"; text: string }) {
  return (
    <ThemedText
      color={kind === "error" ? "error" : "warning"}
      wrap={kind === "info" ? "truncate" : "wrap"}
    >
      {text}
    </ThemedText>
  );
}
