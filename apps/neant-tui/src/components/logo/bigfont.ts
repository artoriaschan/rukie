// Adapted from https://github.com/ccch1mneyyy/dsh-TUI
// src/components/bigfont.ts and src/components/Spinner/spinnerUtils.ts (interpolateColor)
// at commit 646740f12c34546d6c195f5b7031be0dc67421a5.
// Source provenance and accepted risks: docs/adr/0005-own-tui-renderer.md.
import { hex, interpolateColor, rgb } from "@neant/tui";
import { bold } from "./splash-font";

interface ColoredCell {
  ch: string;
  color: `#${string}`;
}

/** Keep a row's spacing while reducing equal-color neighbors to one text span. */
export function mergeColoredCells(cells: readonly ColoredCell[]) {
  const segments: { text: string; color: `#${string}` }[] = [];
  for (const { ch, color } of cells) {
    const previous = segments.at(-1);
    if (previous?.color === color) previous.text += ch;
    else segments.push({ text: ch, color });
  }
  return segments;
}

/** Five rows of bold cells, with one spacing column between glyphs. */
export function renderBigText(text: string, from: `#${string}`, to: `#${string}`): ColoredCell[][] {
  const characters = Array.from(text);
  const start = rgb(from);
  const end = rgb(to);
  return Array.from({ length: 5 }, (_, row) => {
    const painted = characters
      .map((ch) => (ch === " " ? "  " : `${(bold.glyphs[ch] ?? bold.fallback)[row]} `))
      .join("");
    // Exclude final spacing so the rightmost colored column reaches `to`.
    const line = painted.slice(0, characters.at(-1) === " " ? -2 : -1);
    return Array.from(line, (ch, x) => ({
      ch: ch === "·" ? " " : ch,
      color: hex(interpolateColor(start, end, line.length <= 1 ? 0 : x / (line.length - 1))),
    }));
  });
}
