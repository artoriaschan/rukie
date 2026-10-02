import { useTerminalSize } from "../hooks";
import { ThemedText, type ThemeColor } from "./themed";

export interface DividerProps {
  title?: string;
  color?: ThemeColor;
}

/** Fill the available row; truncation keeps titles and rules on one line. */
export function Divider({ title, color = "subtle" }: DividerProps) {
  const { columns } = useTerminalSize();
  return (
    <ThemedText color={color} wrap="truncate">
      {title ? `─ ${title} ` : ""}
      {"─".repeat(columns)}
    </ThemedText>
  );
}
