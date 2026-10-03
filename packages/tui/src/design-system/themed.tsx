import { createContext, useContext } from "react";
import {
  Box,
  Text,
  TextInput,
  type BoxProps,
  type TextProps,
  type TextInputProps,
} from "../components";
import type { Theme } from "./theme";
import { useTheme } from "./theme-provider";

export type ThemeColor = keyof Theme | NonNullable<TextProps["color"]>;
const ColorContext = createContext<TextProps["color"]>(undefined);

function resolveColor(theme: Theme, color?: ThemeColor): TextProps["color"] {
  return color !== undefined && color in theme
    ? theme[color as keyof Theme]
    : (color as TextProps["color"]);
}

function useColor(color?: ThemeColor) {
  const theme = useTheme();
  const inherited = useContext(ColorContext);
  return color === undefined ? (inherited ?? theme.text) : resolveColor(theme, color);
}

export interface ThemedTextProps extends Omit<TextProps, "color" | "backgroundColor"> {
  color?: ThemeColor;
  backgroundColor?: ThemeColor;
}

export function ThemedText({ color, backgroundColor, ...props }: ThemedTextProps) {
  const resolved = useColor(color);
  const theme = useTheme();
  const background = resolveColor(theme, backgroundColor);
  return (
    <ColorContext.Provider value={resolved}>
      <Text {...props} color={resolved} backgroundColor={background} />
    </ColorContext.Provider>
  );
}

export interface ThemedTextInputProps extends Omit<TextInputProps, "color"> {
  color?: ThemeColor;
}

export function ThemedTextInput({ color, ...props }: ThemedTextInputProps) {
  return <TextInput {...props} color={useColor(color)} />;
}

export interface ThemedBoxProps extends Omit<BoxProps, "backgroundColor"> {
  color?: ThemeColor;
  backgroundColor?: ThemeColor;
}

/** Resolve a box's theme background and scope the foreground for descendant themed text. */
export function ThemedBox({ color, backgroundColor, ...props }: ThemedBoxProps) {
  const resolved = useColor(color);
  const theme = useTheme();
  const background = resolveColor(theme, backgroundColor);
  return (
    <ColorContext.Provider value={resolved}>
      <Box {...props} backgroundColor={background} />
    </ColorContext.Provider>
  );
}
