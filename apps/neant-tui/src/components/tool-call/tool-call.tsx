import { Box, Spinner, Text } from "@neant/tui";

export function ToolCall({
  summary,
  status,
  error,
}: {
  summary: string;
  status: "running" | "success" | "error";
  error?: string;
}) {
  return status === "running" ? (
    <Text wrap="truncate">
      <Spinner /> {summary}
    </Text>
  ) : (
    <Box flexDirection="column">
      <Text wrap="truncate">{`${status === "error" ? "✗" : "✓"} ${summary}`}</Text>
      {error && (
        <Text color="red" wrap="truncate">
          {error}
        </Text>
      )}
    </Box>
  );
}
