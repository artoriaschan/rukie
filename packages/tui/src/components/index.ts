import {
  Children,
  createElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { TextStyle } from "../text";
export { TextInput, type TextInputProps } from "./text-input";

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

/** An animated text glyph with the same color and emphasis options as Text. */
export function Spinner(props: TextStyle) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((index) => (index + 1) % spinnerFrames.length), 80);
    return () => clearInterval(timer);
  }, []);
  return createElement(Text, props, spinnerFrames[frame]);
}
