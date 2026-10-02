import { Box, Divider, HintLine, ListItem, ThemedText } from "@neant/tui";

export function PermissionDialog({
  toolName,
  args,
  selected,
}: {
  toolName: string;
  args: unknown;
  selected: number;
}) {
  return (
    <Box flexDirection="column">
      <Divider title="权限确认" color="permission" />
      <ThemedText wrap="truncate">
        {`${toolName} ${JSON.stringify(args)}`.replace(/\s+/g, " ")}
      </ThemedText>
      {["允许一次", "本 session 内一直允许这个工具", "拒绝"].map((label, index) => (
        <ListItem key={label} focused={selected === index}>
          {`${index + 1}. ${label}`}
        </ListItem>
      ))}
      <HintLine>方向键或 1–3 选择 · Enter 确认 · Esc 拒绝</HintLine>
    </Box>
  );
}
