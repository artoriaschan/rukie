import { ThemedText } from "@neant/tui";

export function Notice({
  kind,
  text,
  truncate = false,
}: {
  kind: "info" | "error" | "success" | "warning";
  text: string;
  truncate?: boolean;
}) {
  return (
    <ThemedText
      color={kind === "error" ? "error" : kind === "success" ? "text" : "warning"}
      wrap={kind === "error" && !truncate ? "wrap" : "truncate"}
    >
      {text}
    </ThemedText>
  );
}
