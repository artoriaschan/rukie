import { createElement, type ReactNode } from "react";
import type { TextStyle } from "../text";

export interface BoxProps {
  children?: ReactNode;
  flexDirection?: "row" | "column";
  width?: number;
  height?: number;
  flexGrow?: number;
  flexShrink?: number;
  padding?: number;
  paddingX?: number;
  paddingY?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  margin?: number;
  marginX?: number;
  marginY?: number;
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  marginBottom?: number;
  gap?: number;
  borderStyle?: "single";
}

export interface TextProps extends TextStyle {
  children?: ReactNode;
  /** Word wrap, splitting long words by display columns, or clip each explicit line. */
  wrap?: "wrap" | "truncate";
}

/** Flex container measured in terminal cells; rows are the default direction. */
export function Box(props: BoxProps) {
  return createElement("tui-box", props);
}

/** Text is measured and painted in display columns, rather than UTF-16 units. */
export function Text(props: TextProps) {
  return createElement("tui-text", props);
}
