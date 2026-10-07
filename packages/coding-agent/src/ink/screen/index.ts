import type { createSelection, SelectionMetadata, SelectionViewport } from "../selection";
import type { LayoutNode } from "../layout";
import { textCursor, textLines, sanitizeText, type TextStyle } from "../text";

interface Cell {
  text: string;
  width: number;
  style: string;
  paintStyle?: TextStyle;
  selection?: SelectionMetadata;
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

function colorCode(color: TextStyle["color"], background = false) {
  if (!color) return undefined;
  if (color.startsWith("#")) {
    if (!/^#[0-9a-f]{6}$/i.test(color))
      throw new Error(`Invalid text ${background ? "background color" : "color"}: ${color}`);
    const rgb = Number.parseInt(color.slice(1), 16);
    return `${background ? 48 : 38};2;${rgb >> 16};${(rgb >> 8) & 255};${rgb & 255}`;
  }
  return String(colors[color as keyof typeof colors] + (background ? 10 : 0));
}

function sgr(style: TextStyle): string {
  const codes = ["0"];
  if (style.bold) codes.push("1");
  if (style.dimColor) codes.push("2");
  if (style.italic) codes.push("3");
  if (style.underline) codes.push("4");
  if (style.strikethrough) codes.push("9");
  if (style.inverse) codes.push("7");
  if (!process.env.NO_COLOR) {
    const foreground = colorCode(style.color);
    const background = colorCode(style.backgroundColor, true);
    if (foreground) codes.push(foreground);
    if (background) codes.push(background);
  }
  return `\x1b[${codes.join(";")}m`;
}

function contentLength(line: Cell[]): number {
  let length = line.length;
  while (length && line[length - 1]!.text === " " && line[length - 1]!.style === sgr({})) length--;
  return length;
}

function paintGrid(root: LayoutNode, columns: number, rows: number): Cell[][] {
  const grid: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => ({ text: " ", width: 1, style: sgr({}) })),
  );
  let clip = { left: 0, top: 0, right: columns, bottom: rows };
  let background: TextStyle["backgroundColor"];
  let region:
    | {
        source: LayoutNode["source"];
        options: NonNullable<Exclude<LayoutNode["props"]["textSelection"], false>>;
      }
    | undefined;
  let selectable = true;
  let viewport: SelectionViewport | undefined;
  let textSearch: LayoutNode["props"]["textSearch"];
  function put(
    x: number,
    y: number,
    text: string,
    width = 1,
    style: TextStyle = {},
    selection?: SelectionMetadata,
  ) {
    if (x < clip.left || y < clip.top || y >= clip.bottom || x + width > clip.right) return;
    const codes = sgr(
      background && style.backgroundColor === undefined
        ? { ...style, backgroundColor: background }
        : style,
    );
    const paintStyle =
      background && style.backgroundColor === undefined
        ? { ...style, backgroundColor: background }
        : style;
    const metadata =
      selection ??
      (region
        ? { region: region.source, options: region.options, selectable: false, viewport }
        : undefined);
    grid[y]![x] = { text, width, style: codes, paintStyle, selection: metadata };
    if (width === 2)
      grid[y]![x + 1] = { text: "", width: 0, style: codes, paintStyle, selection: metadata };
  }
  function paint(node: LayoutNode) {
    const { x, width, height } = node;
    const y = node.y - Math.max(0, root.height - rows);
    if (y + height <= clip.top || y >= clip.bottom || x + width <= clip.left || x >= clip.right)
      return;
    const previousRegion = region,
      previousSelectable = selectable,
      previousViewport = viewport;
    if (node.type === "tui-scroll" && node.props.scroll)
      viewport = {
        owner: node.source,
        top: Math.max(clip.top, y),
        bottom: Math.min(clip.bottom, y + height),
        left: Math.max(clip.left, x),
        right: Math.min(clip.right, x + width),
        scrollTop: node.props.scroll.getSnapshot().top,
      };
    if (node.props.textSelection !== undefined)
      region =
        node.props.textSelection === false
          ? undefined
          : { source: node.source, options: node.props.textSelection };
    selectable = node.props.selectable ?? selectable;
    if (node.props.textSelection !== undefined)
      for (let row = Math.max(y, clip.top); row < Math.min(y + height, clip.bottom); row++)
        for (let col = Math.max(x, clip.left); col < Math.min(x + width, clip.right); col++)
          grid[row]![col]!.selection = region
            ? {
                region: region.source,
                options: region.options,
                selectable: false,
                viewport,
              }
            : undefined;
    const previousSearch = textSearch;
    textSearch = node.props.textSearch ?? textSearch;
    const previousBackground = background;
    background = node.props.backgroundColor ?? background;
    if (node.type !== "tui-text" && node.props.backgroundColor) {
      for (let row = Math.max(y, clip.top); row < Math.min(y + height, clip.bottom); row++)
        for (let col = Math.max(x, clip.left); col < Math.min(x + width, clip.right); col++)
          put(col, row, " ");
    }
    if (node.props.borderStyle && width >= 2 && height >= 2) {
      const style = { color: node.props.borderColor };
      for (let col = 1; col < width - 1; col++) {
        put(x + col, y, "─", 1, style);
        put(x + col, y + height - 1, "─", 1, style);
      }
      for (
        let row = Math.max(1, clip.top - y);
        row < Math.min(height - 1, clip.bottom - y);
        row++
      ) {
        put(x, y + row, "│", 1, style);
        put(x + width - 1, y + row, "│", 1, style);
      }
      const round = node.props.borderStyle === "round";
      put(x, y, round ? "╭" : "┌", 1, style);
      put(x + width - 1, y, round ? "╮" : "┐", 1, style);
      put(x, y + height - 1, round ? "╰" : "└", 1, style);
      put(x + width - 1, y + height - 1, round ? "╯" : "┘", 1, style);
    }
    if (node.type === "tui-text") {
      const matches: { start: number; end: number }[] = [];
      const query = textSearch?.query.toLowerCase();
      const sourceText = sanitizeText(node.spans.map((span) => span.text).join(""));
      const original = sourceText.toLowerCase();
      if (query)
        for (
          let at = original.indexOf(query);
          at !== -1;
          at = original.indexOf(query, at + query.length)
        )
          matches.push({ start: at, end: at + query.length });
      const top = node.textTop ?? 0;
      const caret =
        node.props.cursorStyle === "block" && node.props.cursorOffset !== undefined
          ? textCursor(node.spans, width, node.props.cursorOffset, node.props.atomicRanges)
          : undefined;
      const first = Math.max(0, clip.top - y);
      const end = Math.min(height, clip.bottom - y);
      (
        node.lines ??
        textLines(
          node.spans,
          width,
          node.props.wrap !== "truncate",
          node.props.input || node.props.preserveWhitespace,
          node.props.atomicRanges,
        )
      )
        .slice(top + first, top + end)
        .forEach((line, row) => {
          const previousGlyph = node.lines?.[top + first + row - 1]?.findLast(
            (glyph) => glyph.width > 0,
          );
          const firstGlyph = line.find((glyph) => glyph.width > 0);
          const softWrap =
            top + first + row > 0
              ? !!previousGlyph &&
                !!firstGlyph &&
                !sourceText
                  .slice(previousGlyph.offset + previousGlyph.text.length, firstGlyph.offset)
                  .includes("\n")
              : node.props.softWrap;
          let col = 0;
          for (const glyph of line) {
            if (!glyph.width) continue;
            if (col + glyph.width > width) break;
            const match = matches.some(
              (range) => glyph.offset >= range.start && glyph.offset < range.end,
            );
            const highlighted = match
              ? {
                  ...glyph.style,
                  ...(textSearch?.color !== undefined ? { color: textSearch.color } : {}),
                  ...(textSearch?.backgroundColor !== undefined
                    ? { backgroundColor: textSearch.backgroundColor }
                    : {}),
                  dimColor: false,
                }
              : glyph.style;
            const atCaret = caret?.x === col && caret.y === top + first + row;
            put(
              x + col,
              y + first + row,
              glyph.text,
              glyph.width,
              atCaret ? { ...highlighted, inverse: true } : highlighted,
              region
                ? {
                    region: region.source,
                    options: region.options,
                    selectable: selectable && glyph.selectable !== false,
                    owner: node.source,
                    source: sourceText,
                    offset: glyph.offset,
                    softWrap,
                    viewport,
                  }
                : undefined,
            );
            col += glyph.width;
          }
          if (caret?.x === col && caret.y === top + first + row && col < width)
            put(x + col, y + first + row, " ", 1, {
              color: node.props.color,
              backgroundColor: node.props.backgroundColor,
              inverse: true,
            });
        });
    }
    const previousClip = clip;
    if (node.type === "tui-scroll") {
      clip = {
        left: Math.max(clip.left, x),
        top: Math.max(clip.top, y),
        right: Math.min(clip.right, x + width),
        bottom: Math.min(clip.bottom, y + height),
      };
    }
    node.children.forEach(paint);
    clip = previousClip;
    background = previousBackground;
    textSearch = previousSearch;
    region = previousRegion;
    selectable = previousSelectable;
    viewport = previousViewport;
  }
  paint(root);
  return grid;
}

/** Each mounted renderer owns its previous viewport; only changed cells are written. */
export function createScreen(fullscreen = false, selection?: ReturnType<typeof createSelection>) {
  let previous: Cell[][] | undefined;
  let previousColumns = 0;
  let previousRows = 0;
  let cursorRow = 0;
  let invalidated = false;
  const screen = (
    root: LayoutNode,
    columns: number,
    rows: number,
    completed: LayoutNode[] = [],
  ): string => {
    const height = fullscreen ? rows : Math.min(root.height, rows);
    const endRow = Math.min(height, rows - 1);
    let ansi = "\x1b[0m\x1b[?7l" + (fullscreen ? "\x1b[H" : "\r");
    if (invalidated && !fullscreen) {
      ansi += "\x1b[u";
      // Native reflow shifts the saved position for expanded active lines too.
      // Keep that adjustment for history, but move back over the active expansion.
      const expanded =
        columns < previousColumns
          ? (previous?.reduce(
              (total, line, y) =>
                total +
                (y === cursorRow ? 0 : Math.max(0, Math.ceil(contentLength(line) / columns) - 1)),
              0,
            ) ?? 0)
          : 0;
      if (expanded) ansi += `\x1b[${expanded}A`;
    } else if (cursorRow && !fullscreen) ansi += `\x1b[${cursorRow}A`;
    let currentRow = 0;
    const resized = columns !== previousColumns || rows !== previousRows;
    if (!fullscreen && (completed.length || invalidated || (previous && resized))) {
      ansi += "\x1b[J";
      for (const item of completed) {
        for (const line of paintGrid(item, columns, item.height)) {
          let style = sgr({});
          for (const cell of line.slice(0, contentLength(line))) {
            if (!cell.width) continue;
            if (cell.style !== style) ansi += cell.style;
            ansi += cell.text;
            style = cell.style;
          }
          ansi += "\x1b[0m\r\n";
        }
      }
      previous = undefined;
    }
    invalidated = false;
    const reserved = Math.min(previous?.length ?? 0, rows - 1);
    if (!fullscreen && endRow > reserved) {
      if (reserved) ansi += `\x1b[${reserved}B`;
      ansi += "\r\n".repeat(endRow - reserved);
      currentRow = endRow;
    }
    const grid = paintGrid(root, columns, height);
    selection?.record(grid);
    for (let y = 0; y < grid.length; y++)
      for (let x = 0; x < grid[y]!.length; x++) {
        const cell = grid[y]![x]!;
        const highlight = selection?.selected(x, y, cell);
        if (highlight) cell.style = sgr({ ...cell.paintStyle, backgroundColor: highlight });
      }
    const full = !previous || resized;
    const move = (y: number, x: number) => {
      if (fullscreen) return `\x1b[${y + 1};${x + 1}H`;
      let codes = "\r";
      if (y !== currentRow)
        codes += `\x1b[${Math.abs(y - currentRow)}${y < currentRow ? "A" : "B"}`;
      if (x) codes += `\x1b[${x}C`;
      currentRow = y;
      return codes;
    };
    ansi += move(0, 0) + (fullscreen ? "" : "\x1b[s");
    let style = sgr({});
    for (let y = 0; y < Math.max(grid.length, previous?.length ?? 0); y++) {
      const line = grid[y];
      if (!line) {
        ansi += move(y, 0) + "\x1b[0m\x1b[2K";
        style = sgr({});
        continue;
      }
      let nextColumn = -1;
      const length = contentLength(line);
      for (let x = 0; x < length; x++) {
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
        if (x !== nextColumn) ansi += move(y, x);
        if (cell.style !== style) ansi += cell.style;
        ansi += cell.text;
        style = cell.style;
        nextColumn = x + cell.width;
      }
      if (
        length < columns &&
        (full ||
          previous?.[y]?.slice(length).some((cell) => cell.text !== " " || cell.style !== sgr({})))
      ) {
        ansi += move(y, length) + "\x1b[0m\x1b[K";
        style = sgr({});
      }
    }
    previous = grid;
    previousColumns = columns;
    previousRows = rows;
    let cursor = { x: 0, y: Math.min(root.height, rows - 1) };
    let visible = false;
    function findCursor(node: LayoutNode) {
      if (node.props.cursorOffset !== undefined) {
        const { x, y } = textCursor(
          node.spans,
          node.width,
          node.props.cursorOffset,
          node.props.atomicRanges,
        );
        cursor = {
          x: node.x + x,
          y: node.y + y - (node.textTop ?? 0) - Math.max(0, root.height - rows),
        };
        visible = cursor.x >= 0 && cursor.x < columns && cursor.y >= 0 && cursor.y < rows;
      }
      node.children.forEach(findCursor);
    }
    findCursor(root);
    cursorRow = Math.max(0, Math.min(cursor.y, rows - 1));
    return (
      ansi +
      "\x1b[0m\x1b[?7h" +
      move(cursorRow, Math.max(0, Math.min(cursor.x, columns - 1))) +
      `\x1b[?25${visible ? "h" : "l"}`
    );
  };
  return Object.assign(screen, {
    invalidate() {
      invalidated = true;
    },
  });
}
