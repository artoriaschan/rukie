import { useState, type ReactNode } from "react";
import { Box } from "../components";
import { figures } from "./figures";
import { ThemedBox, ThemedText, ThemedTextInput } from "./themed";

export interface ListItemProps {
  focused?: boolean;
  children?: ReactNode;
  singleLine?: boolean;
  width?: number;
  showScrollUp?: boolean;
  showScrollDown?: boolean;
  /** Picker styling, hover and native cursor matching dsh-TUI selection rows. */
  picker?: boolean;
  description?: string;
  onClick?(): void;
}

export function ListItem({
  focused = false,
  children,
  width,
  singleLine = false,
  showScrollUp = false,
  showScrollDown = false,
  picker = false,
  description,
  onClick,
}: ListItemProps) {
  const [hovered, setHovered] = useState(false);
  const color = focused ? (picker ? "suggestion" : "accent") : "text";
  return (
    <ThemedBox
      width={width}
      flexDirection="column"
      flexShrink={singleLine ? 0 : undefined}
      onClick={onClick}
      onMouseEnter={onClick ? () => setHovered(true) : undefined}
      onMouseLeave={onClick ? () => setHovered(false) : undefined}
      backgroundColor={onClick && hovered ? "badgeHoverBackground" : undefined}
    >
      <Box height={singleLine ? 1 : undefined} flexShrink={singleLine ? 0 : undefined}>
        <Box width={2} flexShrink={0}>
          {picker && focused ? (
            <ThemedTextInput
              color="suggestion"
              value={figures.user}
              readOnly
              isActive
              columns={1}
              maxLines={1}
              cursorOffset={0}
              onChange={() => {}}
              onSubmit={() => {}}
            />
          ) : (
            <ThemedText
              color={color}
              bold={focused && !picker}
              dimColor={picker && (showScrollUp || showScrollDown)}
              wrap="truncate"
            >
              {focused ? `${figures.user} ` : showScrollDown ? "↓ " : showScrollUp ? "↑ " : "  "}
            </ThemedText>
          )}
        </Box>
        <Box flexGrow={1} flexShrink={singleLine ? 1 : undefined}>
          <ThemedText
            color={color}
            bold={focused && !picker}
            wrap={singleLine ? "truncate" : undefined}
          >
            {children}
          </ThemedText>
        </Box>
        {!picker && focused && (showScrollUp || showScrollDown) && (
          <Box width={2} flexShrink={0}>
            <ThemedText
              dimColor
              wrap="truncate"
            >{`${showScrollUp ? "↑" : ""}${showScrollDown ? "↓" : ""}`}</ThemedText>
          </Box>
        )}
      </Box>
      {description && (
        <Box paddingLeft={2}>
          <ThemedText color="inactive" wrap="truncate">
            {description}
          </ThemedText>
        </Box>
      )}
    </ThemedBox>
  );
}
