import { createContext, useContext } from "react";
import Box, { type Props as BoxProps } from "../components/Box";
import Text, { type Props as TextProps } from "../components/Text";
import { TextInput, type TextInputProps } from "./text-input";
import type { ReactNode } from "react";
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
  children?: ReactNode;
}

export function ThemedText({ color, backgroundColor, bold, dim, ...props }: ThemedTextProps) {
  const resolved = useColor(color);
  const theme = useTheme();
  const background = resolveColor(theme, backgroundColor);
  return (
    <ColorContext.Provider value={resolved}>
      <Text
        {...props}
        {...(bold !== undefined ? { bold } : dim !== undefined ? { dim } : {})}
        color={resolved}
        backgroundColor={background}
      />
    </ColorContext.Provider>
  );
}

export interface ThemedTextInputProps extends Omit<TextInputProps, "color"> {
  color?: ThemeColor;
}

export function ThemedTextInput({ color, ...props }: ThemedTextInputProps) {
  return <TextInput {...props} color={useColor(color)} />;
}

export interface ThemedBoxProps extends Omit<BoxProps, "backgroundColor" | "borderColor"> {
  color?: ThemeColor;
  backgroundColor?: ThemeColor;
  borderColor?: ThemeColor;
  children?: ReactNode;
}

/** Resolve a box's theme background and scope the foreground for descendant themed text. */
export function ThemedBox({ color, backgroundColor, borderColor, ...props }: ThemedBoxProps) {
  const resolved = useColor(color);
  const theme = useTheme();
  const background = resolveColor(theme, backgroundColor);
  return (
    <ColorContext.Provider value={resolved}>
      <Box {...props} backgroundColor={background} borderColor={resolveColor(theme, borderColor)} />
    </ColorContext.Provider>
  );
}
