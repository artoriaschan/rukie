import { Spinner } from "./spinner";
import { figures } from "./figures";
import { useTheme } from "./theme-provider";
import { ThemedText } from "./themed";

export interface StatusIconProps {
  status: "running" | "success" | "error";
}

export function StatusIcon({ status }: StatusIconProps) {
  const theme = useTheme();
  return status === "running" ? (
    <Spinner color={theme.accent} frames={figures.spinner} />
  ) : (
    <ThemedText color={status}>{figures[status]}</ThemedText>
  );
}
