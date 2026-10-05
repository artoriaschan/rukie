import type { ReactNode } from "react";
import { Box } from "../components";
import { figures } from "./figures";
import { ThemedText } from "./themed";

export interface ListItemProps {
  focused?: boolean;
  children?: ReactNode;
  singleLine?: boolean;
  width?: number;
  showScrollUp?: boolean;
  showScrollDown?: boolean;
}

export function ListItem({
  focused = false,
  children,
  width,
  singleLine = false,
  showScrollUp = false,
  showScrollDown = false,
}: ListItemProps) {
  return (
    <Box width={width} height={singleLine ? 1 : undefined} flexShrink={singleLine ? 0 : undefined}>
      <Box width={2} flexShrink={0}>
        <ThemedText color={focused ? "accent" : "text"} bold={focused} wrap="truncate">
          {focused ? `${figures.user} ` : showScrollDown ? "↓ " : showScrollUp ? "↑ " : "  "}
        </ThemedText>
      </Box>
      <Box flexGrow={1} flexShrink={singleLine ? 1 : undefined}>
        <ThemedText
          color={focused ? "accent" : "text"}
          bold={focused}
          wrap={singleLine ? "truncate" : undefined}
        >
          {children}
        </ThemedText>
      </Box>
      {focused && (showScrollUp || showScrollDown) && (
        <Box width={2} flexShrink={0}>
          <ThemedText
            dimColor
            wrap="truncate"
          >{`${showScrollUp ? "↑" : ""}${showScrollDown ? "↓" : ""}`}</ThemedText>
        </Box>
      )}
    </Box>
  );
}
