import {
  Box,
  HintLine,
  ListItem,
  ScrollBox,
  ThemedText,
  useTerminalSize,
  type ScrollHandle,
  type ScrollSnapshot,
} from "@neant/tui";
import { useCallback, useState, type Ref } from "react";
import type { PermissionMode } from "@neant/shared";

const ALLOW_ONCE = { label: "允许（仅本次）", decision: "allow" } as const;
const ALLOW_TOOL = { label: "本 session 内一直允许这个工具", decision: "allow-tool" } as const;
const DENY = { label: "拒绝", decision: "deny" } as const;

/** The visible choices also define the keyboard decisions for this request. */
export function permissionChoices(mode: PermissionMode = "ask") {
  return mode === "auto-review" ? [ALLOW_ONCE, DENY] : [ALLOW_ONCE, ALLOW_TOOL, DENY];
}

export function PermissionDialog({
  toolName,
  args,
  selected,
  maxHeight,
  scrollRef,
  scrollFocused = false,
  mode = "ask",
  reason,
}: {
  toolName: string;
  args: unknown;
  selected: number;
  maxHeight: number;
  scrollRef?: Ref<ScrollHandle>;
  scrollFocused?: boolean;
  mode?: PermissionMode;
  reason?: string;
}) {
  const { columns } = useTerminalSize();
  const choices = permissionChoices(mode);
  const spacious = maxHeight >= choices.length + 6;
  const showQuestion = maxHeight >= choices.length + 4;
  const [detailHeight, setDetailHeight] = useState(1);
  const measureDetails = useCallback(({ total, width }: ScrollSnapshot) => {
    if (width > 0) setDetailHeight(total);
  }, []);
  // Only details consume the remaining budget; selection never changes the fixed rows.
  const fixedHeight = choices.length + 2 + Number(showQuestion) + (spacious ? 2 : 0);
  const height = Math.min(maxHeight, fixedHeight + Math.max(1, detailHeight));
  const title = ` ⏳ 等待审批 · ${toolName} `;
  const ruleWidth = Math.max(0, columns - 4 - Bun.stringWidth(title));
  const command =
    toolName === "bash" &&
    args !== null &&
    typeof args === "object" &&
    "command" in args &&
    typeof args.command === "string"
      ? args.command
      : undefined;
  const parameters =
    command === undefined
      ? args
      : Object.fromEntries(Object.entries(args ?? {}).filter(([key]) => key !== "command"));
  return (
    <Box flexDirection="column" height={height} paddingX={2} marginBottom={1}>
      <ThemedText color="permission" wrap="truncate">
        {`${"─".repeat(Math.floor(ruleWidth / 2))}${title}${"─".repeat(Math.ceil(ruleWidth / 2))}`}
      </ThemedText>
      {spacious && <Box height={1} flexShrink={0} />}
      <ScrollBox ref={scrollRef} initialFollow={false} onScroll={measureDetails}>
        {command !== undefined && (
          <Box paddingX={2}>
            <ThemedText dimColor preserveWhitespace>
              {command}
            </ThemedText>
          </Box>
        )}
        {(command === undefined || Object.keys(parameters ?? {}).length > 0) && (
          <Box paddingX={2}>
            <ThemedText dimColor preserveWhitespace>
              {JSON.stringify(parameters, null, 2)}
            </ThemedText>
          </Box>
        )}
        {reason !== undefined && <ThemedText dimColor>{reason}</ThemedText>}
      </ScrollBox>
      {showQuestion && (
        <ThemedText dimColor wrap="truncate">
          要允许这次操作吗？
        </ThemedText>
      )}
      <Box flexDirection="column" marginTop={spacious ? 1 : 0} flexShrink={0}>
        {choices.map(({ label }, index) => (
          <ListItem key={label} focused={selected === index}>{`${index + 1}. ${label}`}</ListItem>
        ))}
      </Box>
      <HintLine>
        {["↑↓选择", "Enter确认", "Esc拒绝", `Tab${scrollFocused ? "主体" : "详情"}`].join(
          columns < 50 ? " " : " · ",
        )}
      </HintLine>
    </Box>
  );
}
