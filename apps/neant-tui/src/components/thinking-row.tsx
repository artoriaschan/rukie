import { Box, ThemedText, useTerminalSize } from "@neant/tui";
import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../i18n";

export function ThinkingRow({
  text,
  expanded,
  onToggle,
  locale,
}: {
  text: string;
  expanded: boolean;
  onToggle(): void;
  locale: Locale;
}) {
  const { columns } = useTerminalSize();
  const t = createTuiI18n(locale);
  const title = `${expanded ? "▴" : "▾"} ${t("subagent.thinking")}`;
  return (
    <Box flexDirection="column">
      <Box width={Math.min(columns, Bun.stringWidth(title))} onClick={onToggle}>
        <ThemedText dimColor>{title}</ThemedText>
      </Box>
      {expanded && <ThemedText dimColor>{text}</ThemedText>}
    </Box>
  );
}
