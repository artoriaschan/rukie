import { ThemedText } from "@neant/tui";

export function Notice({
  kind,
  text,
}: {
  kind: "info" | "error" | "success" | "warning";
  text: string;
}) {
  return (
    <ThemedText
      color={kind === "error" ? "error" : kind === "success" ? "text" : "warning"}
      wrap={kind === "error" ? "wrap" : "truncate"}
    >
      {text}
    </ThemedText>
  );
}
