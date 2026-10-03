import {
  Box,
  Divider,
  HintLine,
  ListItem,
  ScrollBox,
  ThemedText,
  useTerminalSize,
  type ScrollHandle,
} from "@neant/tui";
import type { Ref } from "react";
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
    <Box flexDirection="column" height={maxHeight} paddingX={2}>
      <Divider title={`等待审批 · ${toolName}`} color="permission" />
      {spacious && <Box height={1} flexShrink={0} />}
      <ScrollBox ref={scrollRef} initialFollow={false}>
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
      {choices.map(({ label }, index) => (
        <Box key={label} marginTop={spacious && selected === index ? 1 : 0} flexShrink={0}>
          <ListItem focused={selected === index}>{`${index + 1}. ${label}`}</ListItem>
        </Box>
      ))}
      <HintLine>
        {["↑↓选择", "Enter确认", "Esc拒绝", `Tab${scrollFocused ? "主体" : "详情"}`].join(
          columns < 50 ? " " : " · ",
        )}
      </HintLine>
    </Box>
  );
}
