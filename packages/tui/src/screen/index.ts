import type { LayoutNode } from "../layout";
import { textCursor, textLines, type TextStyle } from "../text";

interface Cell {
  text: string;
  width: number;
  style: string;
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

function paintGrid(root: LayoutNode, columns: number, rows: number): Cell[][] {
  const grid: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => ({ text: " ", width: 1, style: sgr({}) })),
  );
  function put(x: number, y: number, text: string, width = 1, style: TextStyle = {}) {
    if (x < 0 || y < 0 || y >= rows || x + width > columns) return;
    const codes = sgr(style);
    grid[y]![x] = { text, width, style: codes };
    if (width === 2) grid[y]![x + 1] = { text: "", width: 0, style: codes };
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
      textLines(node.spans, width, node.props.wrap !== "truncate", node.props.input)
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
  return grid;
}

/** Each mounted renderer owns its previous viewport; only changed cells are written. */
export function createScreen() {
  let previous: Cell[][] | undefined;
  let previousColumns = 0;
  let previousRows = 0;
  return (root: LayoutNode, columns: number, rows: number): string => {
    const grid = paintGrid(root, columns, rows);
    const full = !previous || columns !== previousColumns || rows !== previousRows;
    let ansi = "\x1b[0m\x1b[?7l" + (full ? "\x1b[2J" : "");
    let style = sgr({});
    grid.forEach((line, y) => {
      let nextColumn = -1;
      for (let x = 0; x < line.length; x++) {
        const cell = line[x]!;
        // A wide glyph writes both cells; never address its continuation separately.
        if (cell.width === 0) continue;
        const old = previous?.[y]?.[x];
        if (
          !full &&
          old?.text === cell.text &&
          old.width === cell.width &&
          old.style === cell.style
        )
          continue;
        if (x !== nextColumn) ansi += `\x1b[${y + 1};${x + 1}H`;
        if (cell.style !== style) ansi += cell.style;
        ansi += cell.text;
        style = cell.style;
        nextColumn = x + cell.width;
      }
    });
    previous = grid;
    previousColumns = columns;
    previousRows = rows;
    let cursor = { x: 0, y: Math.min(root.height, rows - 1) };
    let visible = false;
    function findCursor(node: LayoutNode) {
      if (node.props.cursorOffset !== undefined) {
        const { x, y } = textCursor(node.spans, node.width, node.props.cursorOffset);
        cursor = { x: node.x + x, y: node.y + y };
        visible = cursor.x >= 0 && cursor.x < columns && cursor.y >= 0 && cursor.y < rows;
      }
      node.children.forEach(findCursor);
    }
    findCursor(root);
    return (
      ansi +
      `\x1b[0m\x1b[?7h\x1b[${Math.max(0, Math.min(cursor.y, rows - 1)) + 1};${Math.max(0, Math.min(cursor.x, columns - 1)) + 1}H\x1b[?25${visible ? "h" : "l"}`
    );
  };
}
