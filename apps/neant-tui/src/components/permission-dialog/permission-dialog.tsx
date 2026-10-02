import { Box, Text } from "@neant/tui";

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
      <Text bold>权限确认</Text>
      <Text wrap="truncate">{`${toolName} ${JSON.stringify(args)}`.replace(/\s+/g, " ")}</Text>
      {["允许一次", "本 session 内一直允许这个工具", "拒绝"].map((label, index) => (
        <Text key={label} bold={selected === index}>
          {`${selected === index ? ">" : " "} ${index + 1}. ${label}`}
        </Text>
      ))}
      <Text dimColor>方向键或 1–3 选择 · Enter 确认 · Esc 拒绝</Text>
    </Box>
  );
}
