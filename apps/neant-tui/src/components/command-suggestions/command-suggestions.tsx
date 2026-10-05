import { Box, ThemedText } from "@neant/tui";

export function CommandSuggestions({
  items,
  selected,
  maxHeight,
}: {
  items: readonly { name: string; description: string; skill?: boolean }[];
  selected: number;
  maxHeight: number;
}) {
  const start = Math.max(0, selected - maxHeight + 1);
  return (
    <Box flexDirection="column" flexShrink={0}>
      {items.slice(start, start + maxHeight).map((item, index) => (
        <ThemedText
          key={item.name}
          wrap="truncate"
          color={index + start === selected ? "accent" : undefined}
        >
          {`${index + start === selected ? "❯" : " "} /${item.name}${item.skill ? " [skill]" : ""}  ${item.description}`}
        </ThemedText>
      ))}
    </Box>
  );
}
