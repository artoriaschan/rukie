import { Box, ThemedText, useTheme } from "@neant/tui";
import { mergeColoredCells, renderBigText } from "./bigfont";

/** Placeholder branding is isolated here so replacing it leaves the chat screen alone. */
export function Logo({ model, cwd }: { model: string; cwd: string }) {
  const theme = useTheme();
  const rows = renderBigText("NEANT", theme.logoFrom, theme.logoTo);
  return (
    <Box flexDirection="column">
      {rows.map((row, y) => (
        <Box key={y} flexDirection="row">
          {mergeColoredCells(row).map((segment, x) => (
            <ThemedText key={x} color={segment.color} wrap="truncate">
              {segment.text}
            </ThemedText>
          ))}
        </Box>
      ))}
      <ThemedText color="subtle" wrap="truncate">
        {model} · {cwd}
      </ThemedText>
    </Box>
  );
}
