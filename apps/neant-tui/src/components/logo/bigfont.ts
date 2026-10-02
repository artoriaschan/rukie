// Adapted from https://github.com/ccch1mneyyy/dsh-TUI
// src/components/bigfont.ts and src/components/Spinner/spinnerUtils.ts (interpolateColor)
// at commit 646740f12c34546d6c195f5b7031be0dc67421a5.
// Source provenance and accepted risks: docs/adr/0005-own-tui-renderer.md.
import { bold } from "./splash-font";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

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

function interpolateColor(color1: Rgb, color2: Rgb, t: number): Rgb {
  const blend = (from: number, to: number) => Math.round(from + (to - from) * t);
  return {
    r: blend(color1.r, color2.r),
    g: blend(color1.g, color2.g),
    b: blend(color1.b, color2.b),
  };
}

function rgb(hex: `#${string}`): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function hex({ r, g, b }: Rgb): `#${string}` {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
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
