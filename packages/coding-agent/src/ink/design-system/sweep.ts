// Adapted from dsh-TUI: src/components/shimmer.ts (sweep), installed as
// @deepseek-harness-tui/dsh-tui/lib/types/components/shimmer.js.
// https://github.com/ccch1mneyyy/dsh-TUI
import { hex, interpolateColor, type Rgb } from "./color";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** A ten-column sweeping highlight, returned as merged text spans without ANSI. */
export function sweep(text: string, time: number, base: Rgb, highlight: Rgb, stepMs = 60) {
  const cycle = Bun.stringWidth(text) + 20;
  const start = (Math.floor(time / stepMs) % cycle) - 10;
  const segments: { text: string; color: `#${string}` }[] = [];
  let column = 0;
  for (const { segment } of segmenter.segment(text)) {
    const width = Bun.stringWidth(segment);
    const highlighted = column >= start && column + width <= start + 10;
    const opacity = highlighted ? (Math.sin(time / (stepMs * 2)) + 1) / 2 : 0;
    const color = hex(highlighted ? interpolateColor(base, highlight, opacity) : base);
    const previous = segments.at(-1);
    if (previous?.color === color) previous.text += segment;
    else segments.push({ text: segment, color });
    column += width;
  }
  return segments;
}
