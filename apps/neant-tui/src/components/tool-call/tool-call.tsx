import { StatusIcon, ThemedBox, ThemedText, figures, type StatusIconProps } from "@neant/tui";

export function ToolCall({
  summary,
  status,
  result,
  error,
}: {
  summary: string;
  status: StatusIconProps["status"];
  result?: string;
  error?: string;
}) {
  const output = status === "error" ? error?.split(/\r?\n/).slice(0, 3).join("\n") : result;
  return (
    <ThemedBox flexDirection="column">
      <ThemedText wrap="truncate">
        <StatusIcon status={status} /> {summary}
      </ThemedText>
      {status !== "running" && output && (
        <ThemedBox color={status === "error" ? "error" : "text"}>
          <ThemedBox width={2}>
            <ThemedText>{figures.result}</ThemedText>
          </ThemedBox>
          <ThemedText wrap="truncate">{output}</ThemedText>
        </ThemedBox>
      )}
    </ThemedBox>
  );
}
