import {
  Children,
  createElement,
  isValidElement,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import type { TextStyle } from "../text";
import { useAnimationFrame } from "../hooks/animation-frame";
export { TextInput, createTextInputHistory, type TextInputProps } from "./text-input";
export { ScrollBox, type ScrollBoxProps } from "./scroll-box";

export interface BoxProps {
  children?: ReactNode;
  position?: "relative" | "absolute";
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  backgroundColor?: TextStyle["backgroundColor"];
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
  onMouseEnter?(): void;
  onMouseLeave?(): void;
  /** Primary mouse press and release on this box activate it once. */
  onClick?(): void;
}

export interface ImageProps extends Omit<BoxProps, "children"> {
  /** Original PNG bytes encoded as base64. Other media types reserve geometry only. */
  data: string;
  mimeType: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Original source pixel rectangle, before terminal cell scaling and viewport clipping. */
  crop?: { x: number; y: number; width: number; height: number };
}

export function Image(props: ImageProps) {
  return createElement("tui-image", props);
}

export interface TextProps extends TextStyle {
  children?: ReactNode;
  /** Word wrap, splitting long words by display columns, or clip each explicit line. */
  wrap?: "wrap" | "truncate";
  /** Preserve indentation and spaces when wrapping formatted text. */
  preserveWhitespace?: boolean;
}

/** Flex container measured in terminal cells; rows are the default direction. */
export function Box(props: BoxProps) {
  return createElement("tui-box", props);
}

/** Text is measured and painted in display columns, rather than UTF-16 units. */
export function Text(props: TextProps) {
  return createElement("tui-text", props);
}

export interface StaticProps {
  children?: ReactNode;
}

/** Append-only items. Give each child a stable key; completed items are never repainted. */
export function Static({ children }: StaticProps) {
  const completed = useRef(new Set<string>());
  const pending = Children.toArray(children)
    .map((child, index) => ({
      child,
      key: isValidElement(child) ? String(child.key) : String(index),
    }))
    .filter(({ key }) => !completed.current.has(key));
  useLayoutEffect(() => {
    for (const { key } of pending) completed.current.add(key);
  });
  return createElement(
    "tui-static",
    {},
    pending.map(({ child }) => child),
  );
}

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface SpinnerProps extends TextStyle {
  frames?: string[];
}

/** An animated text glyph with the same color and emphasis options as Text. */
export function Spinner({ frames = spinnerFrames, ...props }: SpinnerProps) {
  const [, time] = useAnimationFrame(80);
  const frame = Math.floor(time / 80);
  return createElement(Text, props, frames[frame % frames.length]);
}
