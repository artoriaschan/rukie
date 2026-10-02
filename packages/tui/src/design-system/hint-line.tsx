import type { ReactNode } from "react";
import { ThemedText } from "./themed";

export interface HintLineProps {
  children?: ReactNode;
}

export function HintLine({ children }: HintLineProps) {
  return (
    <ThemedText color="subtle" wrap="truncate">
      {children}
    </ThemedText>
  );
}
