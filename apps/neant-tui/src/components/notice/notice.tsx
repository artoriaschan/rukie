import { ThemedText } from "@neant/tui";

export type NoticeKind = "info" | "error" | "success" | "warning" | "dim";

export function Notice({
  kind,
  text,
  color,
}: {
  kind: NoticeKind;
  text: string;
  color?: "success";
}) {
  return (
    <ThemedText
      color={
        color ??
        (kind === "error"
          ? "error"
          : kind === "success"
            ? "text"
            : kind === "dim"
              ? undefined
              : "warning")
      }
      dimColor={kind === "dim"}
      wrap={kind === "error" ? "wrap" : "truncate"}
    >
      {text}
    </ThemedText>
  );
}
