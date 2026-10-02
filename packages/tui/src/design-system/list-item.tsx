import type { ReactNode } from "react";
import { Box } from "../components";
import { figures } from "./figures";
import { ThemedText } from "./themed";

export interface ListItemProps {
  focused?: boolean;
  children?: ReactNode;
}

export function ListItem({ focused = false, children }: ListItemProps) {
  return (
    <Box>
      <Box width={2} flexShrink={0}>
        <ThemedText color={focused ? "accent" : "text"} bold={focused} wrap="truncate">
          {focused ? `${figures.user} ` : "  "}
        </ThemedText>
      </Box>
      <Box flexGrow={1}>
        <ThemedText color={focused ? "accent" : "text"} bold={focused}>
          {children}
        </ThemedText>
      </Box>
    </Box>
  );
}
