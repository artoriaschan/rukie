import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../../view/i18n";
import { useState } from "react";
import { Box, ThemedBox, ThemedText } from "../../../ink/index.ts";

/** Fixed bottom-chrome button; the chat screen owns the scroll action. */
export function ScrollToBottom({
  locale = "zh",
  columns,
  unread,
  onClick,
  compact = false,
}: {
  locale?: Locale;
  columns: number;
  unread: boolean;
  onClick(): void;
  /** Omit the top gap when fixed chrome would crowd a short approval viewport. */
  compact?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const t = createTuiI18n(locale);
  const label = ` ↓ ${t(unread ? "scroll.unread" : "scroll.return")} `;
  const available = Math.max(0, columns - 4);
  const width = Math.min(available, Bun.stringWidth(label));
  return (
    <Box
      width={columns}
      paddingX={2}
      paddingTop={compact ? 0 : 1}
      height={compact ? 1 : 2}
      flexShrink={0}
    >
      <Box width={Math.floor((available - width) / 2)} flexShrink={0} />
      <ThemedBox
        width={width}
        height={1}
        color="inverseText"
        backgroundColor={hovered ? "badgeHoverBackground" : "badgeBackground"}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onClick}
      >
        <ThemedText bold preserveWhitespace wrap="truncate">
          {label}
        </ThemedText>
      </ThemedBox>
    </Box>
  );
}
