import {
  Box,
  Divider,
  HintLine,
  ListItem,
  ScrollBox,
  ThemedText,
  type ScrollHandle,
} from "@neant/tui";
import type { Ref } from "react";
import type { PermissionMode } from "@neant/shared";

const ALLOW_ONCE = { label: "允许一次", decision: "allow" } as const;
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
  return (
    <Box flexDirection="column" height={maxHeight}>
      <Divider title={reason ?? "权限确认"} color="permission" />
      <ScrollBox ref={scrollRef} initialFollow={false}>
        <ThemedText
          preserveWhitespace
        >{`${toolName}\n${JSON.stringify(args, null, 2)}`}</ThemedText>
      </ScrollBox>
      {permissionChoices(mode).map(({ label }, index) => (
        <ListItem key={label} focused={selected === index}>
          {`${index + 1}. ${label}`}
        </ListItem>
      ))}
      <HintLine>{`↑↓选择 · Enter确认 · Esc拒绝 · Tab${scrollFocused ? "主体" : "详情"}`}</HintLine>
    </Box>
  );
}
