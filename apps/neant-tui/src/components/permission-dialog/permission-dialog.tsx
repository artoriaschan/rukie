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

export function PermissionDialog({
  toolName,
  args,
  selected,
  maxHeight,
  scrollRef,
  scrollFocused = false,
}: {
  toolName: string;
  args: unknown;
  selected: number;
  maxHeight: number;
  scrollRef?: Ref<ScrollHandle>;
  scrollFocused?: boolean;
}) {
  return (
    <Box flexDirection="column" height={maxHeight}>
      <Divider title="权限确认" color="permission" />
      <ScrollBox ref={scrollRef} initialFollow={false}>
        <ThemedText
          preserveWhitespace
        >{`${toolName}\n${JSON.stringify(args, null, 2)}`}</ThemedText>
      </ScrollBox>
      {["允许一次", "本 session 内一直允许这个工具", "拒绝"].map((label, index) => (
        <ListItem key={label} focused={selected === index}>
          {`${index + 1}. ${label}`}
        </ListItem>
      ))}
      <HintLine>{`↑↓选择 · Enter确认 · Esc拒绝 · Tab${scrollFocused ? "主体" : "详情"}`}</HintLine>
    </Box>
  );
}
