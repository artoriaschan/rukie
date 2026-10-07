import { Box, Divider, ThemedText } from "../../../ink/index.ts";

import type { NoticeKind } from "../../../view/conversation/conversation";
export type { NoticeKind } from "../../../view/conversation/conversation";

export function Notice({
  kind,
  text,
  color,
  report,
  truncate = false,
  divider = false,
}: {
  kind: NoticeKind;
  text: string;
  color?: "success";
  /** Frontend-local report: command heading and indented multiline output. */
  report?: string;
  truncate?: boolean;
  /** Transcript auxiliary row. Explicit lines remain separate, each clipped to its width. */
  divider?: boolean;
}) {
  if (report)
    return (
      <Box flexShrink={0} flexDirection="column" marginTop={1}>
        <ThemedText color="bashBorder" wrap="wrap">{`! ${report}`}</ThemedText>
        <Box flexShrink={0} paddingLeft={2}>
          <ThemedText dim wrap="wrap">
            {text}
          </ThemedText>
        </Box>
      </Box>
    );
  if (divider)
    return (
      <Box width="100%" flexShrink={0} marginTop={1} flexDirection="column">
        {text.split("\n").map((line, index) =>
          text.includes("\n") ? (
            <Box key={index} width="100%" minHeight={1} flexShrink={0}>
              <ThemedText dim wrap="truncate">
                {index === 0 ? `─ ${line}` : line}
              </ThemedText>
            </Box>
          ) : (
            <Divider key={index} title={line} />
          ),
        )}
      </Box>
    );
  return (
    <Box width="100%" flexShrink={0} flexDirection="column">
      {text.split("\n").map((line, index) => (
        <Box key={index} width="100%" minHeight={1} flexShrink={0}>
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
            dim={kind === "dim"}
            wrap={kind === "error" && !truncate ? "wrap" : "truncate"}
          >
            {line}
          </ThemedText>
        </Box>
      ))}
    </Box>
  );
}
