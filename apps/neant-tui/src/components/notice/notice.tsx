import { Box, ThemedText } from "@neant/tui";

export type NoticeKind = "info" | "error" | "success" | "warning" | "dim";

export function Notice({
  kind,
  text,
  color,
  report,
}: {
  kind: NoticeKind;
  text: string;
  color?: "success";
  /** Frontend-local report: command heading and indented multiline output. */
  report?: string;
}) {
  if (report)
    return (
      <Box flexDirection="column" marginTop={1}>
        <ThemedText color="bashBorder" wrap="wrap">{`! ${report}`}</ThemedText>
        <Box paddingLeft={2}>
          <ThemedText dimColor wrap="wrap">
            {text}
          </ThemedText>
        </Box>
      </Box>
    );
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
