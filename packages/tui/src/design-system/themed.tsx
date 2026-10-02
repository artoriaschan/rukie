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

function useColor(color?: ThemeColor) {
  const theme = useTheme();
  const inherited = useContext(ColorContext);
  return color === undefined
    ? (inherited ?? theme.text)
    : color in theme
      ? theme[color as keyof Theme]
      : (color as TextProps["color"]);
}

export interface ThemedTextProps extends Omit<TextProps, "color" | "backgroundColor"> {
  color?: ThemeColor;
  backgroundColor?: ThemeColor;
}

export function ThemedText({ color, backgroundColor, ...props }: ThemedTextProps) {
  const resolved = useColor(color);
  const theme = useTheme();
  const background =
    backgroundColor !== undefined && backgroundColor in theme
      ? theme[backgroundColor as keyof Theme]
      : (backgroundColor as TextProps["backgroundColor"]);
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

export interface ThemedBoxProps extends BoxProps {
  color?: ThemeColor;
}

/** Box is layout-only; scope the foreground color for descendant themed text. */
export function ThemedBox({ color, ...props }: ThemedBoxProps) {
  const resolved = useColor(color);
  return (
    <ColorContext.Provider value={resolved}>
      <Box {...props} />
    </ColorContext.Provider>
  );
}
