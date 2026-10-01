import type { LayoutNode } from "../layout";
import { textLines, type TextStyle } from "../text";

interface Cell {
  text: string;
  width: number;
  style: TextStyle;
}

const colors = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
};

function sgr(style: TextStyle): string {
  const codes = ["0"];
  if (style.bold) codes.push("1");
  if (style.dimColor) codes.push("2");
  if (style.color?.startsWith("#")) {
    if (!/^#[0-9a-f]{6}$/i.test(style.color)) throw new Error(`Invalid text color: ${style.color}`);
    const rgb = Number.parseInt(style.color.slice(1), 16);
    codes.push(`38;2;${rgb >> 16};${(rgb >> 8) & 255};${rgb & 255}`);
  } else if (style.color) {
    codes.push(String(colors[style.color as keyof typeof colors]));
  }
  return `\x1b[${codes.join(";")}m`;
}

/** Paint a fresh cell grid and serialize the whole viewport, without scrolling. */
export function fullFrame(root: LayoutNode, columns: number, rows: number): string {
  const grid: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => ({ text: " ", width: 1, style: {} })),
  );
  function put(x: number, y: number, text: string, width = 1, style: TextStyle = {}) {
    if (x < 0 || y < 0 || y >= rows || x + width > columns) return;
    grid[y]![x] = { text, width, style };
    if (width === 2) grid[y]![x + 1] = { text: "", width: 0, style };
  }
  function paint(node: LayoutNode) {
    const { x, y, width, height } = node;
    if (node.props.borderStyle && width >= 2 && height >= 2) {
      for (let col = 1; col < width - 1; col++) {
        put(x + col, y, "─");
        put(x + col, y + height - 1, "─");
      }
      for (let row = 1; row < height - 1; row++) {
        put(x, y + row, "│");
        put(x + width - 1, y + row, "│");
      }
      put(x, y, "┌");
      put(x + width - 1, y, "┐");
      put(x, y + height - 1, "└");
      put(x + width - 1, y + height - 1, "┘");
    }
    if (node.type === "tui-text") {
      textLines(node.spans, width, node.props.wrap !== "truncate")
        .slice(0, height)
        .forEach((line, row) => {
          let col = 0;
          for (const glyph of line) {
            if (col + glyph.width > width) break;
            put(x + col, y + row, glyph.text, glyph.width, glyph.style);
            col += glyph.width;
          }
        });
    }
    node.children.forEach(paint);
  }
  paint(root);
  let ansi = "\x1b[0m\x1b[?7l\x1b[2J";
  grid.forEach((line, y) => {
    ansi += `\x1b[${y + 1};1H`;
    let previous = "";
    for (const cell of line) {
      if (cell.width === 0) continue;
      const style = sgr(cell.style);
      if (style !== previous) ansi += style;
      ansi += cell.text;
      previous = style;
    }
  });
  return ansi + `\x1b[0m\x1b[?7h\x1b[${Math.min(root.height + 1, rows)};1H`;
}
