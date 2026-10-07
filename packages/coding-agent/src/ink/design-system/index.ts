export { dark, light, type Theme } from "./theme";
export { ThemeProvider, useTheme } from "./theme-provider";
export { figures } from "./figures";
export { rgb, hex, interpolateColor, type Rgb } from "./color";
export { sweep } from "./sweep";
export { StatusIcon, type StatusIconProps } from "./status-icon";
export { Divider, type DividerProps } from "./divider";
export { ListItem, type ListItemProps } from "./list-item";
export { HintLine, type HintLineProps } from "./hint-line";
export {
  ThemedText,
  ThemedBox,
  ThemedTextInput,
  type ThemeColor,
  type ThemedTextProps,
  type ThemedBoxProps,
  type ThemedTextInputProps,
} from "./themed";
export { toolKindColor } from "./tool-kind-color";

export { SyntaxHighlightedText, highlightSyntax, type SyntaxRun } from "./syntax-highlighted-text";

export { Tooltip, TooltipProvider, useDismissTooltip } from "./tooltip";

export { SplitDiffView, alignSplitDiff, type SplitDiffRow } from "./split-diff-view";

export { Markdown, markdownText, markdownProjection } from "./markdown";

export { SmoothRevealProvider, useSmoothReveal, useSmoothText } from "./smooth-reveal";
