import type { HostNode } from "../layout";
import { sanitizeText } from "../text";
import type { TextStyle } from "../text";

export type TextSelectionResult = "copied" | "sent" | "unavailable" | "stale";
/** The frontend owns clipboard transport and feedback; the renderer owns selected bytes. */
export interface TextSelectionOptions {
  key?: string;
  backgroundColor?: TextStyle["backgroundColor"];
  onCopy(text: string): Promise<boolean | "sent">;
  onResult(result: TextSelectionResult): void;
}
/** Measured innermost scroll viewport belonging to painted cells; bounds are half-open. */
export interface SelectionViewport {
  owner: HostNode;
  top: number;
  bottom: number;
  left: number;
  right: number;
  scrollTop: number;
}
export interface SelectionMetadata {
  region: HostNode;
  options: TextSelectionOptions;
  selectable?: boolean;
  owner?: HostNode;
  source?: string;
  offset?: number;
  softWrap?: boolean;
  viewport?: SelectionViewport;
}
export interface SelectionCell {
  text: string;
  width: number;
  selection?: SelectionMetadata;
}
type Point = { x: number; y: number };

/** Selection is based solely on the most recently painted, clipped glyph cells. */
export function createSelection(redraw: () => void) {
  let grid: readonly (readonly SelectionCell[])[] = [];
  let current:
    | {
        anchor: Point;
        focus?: Point;
        region: HostNode;
        key?: string;
        baseline: string;
        stale: boolean;
        dragged: boolean;
        viewport?: SelectionViewport;
        captured: Map<number, readonly SelectionCell[]>;
        span?: { start: Point; end: Point; mode: "word" | "line" };
      }
    | undefined;
  let alive = true;
  let clicks:
    | {
        x: number;
        y: number;
        at: number;
        count: number;
        region: HostNode;
        key?: string;
        owner?: HostNode;
      }
    | undefined;
  const regions = new Map<HostNode, TextSelectionOptions>();
  function ordered() {
    if (!current?.focus) return undefined;
    const { anchor, focus } = current;
    return anchor.y < focus.y || (anchor.y === focus.y && anchor.x <= focus.x)
      ? { start: anchor, end: focus }
      : { start: focus, end: anchor };
  }
  function included(x: number, y: number) {
    const range = ordered();
    return (
      !!range &&
      y >= range.start.y &&
      y <= range.end.y &&
      (y !== range.start.y || x >= range.start.x) &&
      (y !== range.end.y || x <= range.end.x)
    );
  }
  function eligible(cell: SelectionCell | undefined) {
    return (
      !!cell?.selection &&
      cell.selection.region === current?.region &&
      cell.selection.options.key === current?.key
    );
  }
  function cellsAt(y: number) {
    const viewport = current?.viewport;
    return viewport && (y < viewport.top || y >= viewport.bottom)
      ? current?.captured.get(viewport.scrollTop + y - viewport.top)
      : grid[y];
  }
  /** Captured glyphs remain copyable only while their source still owns the same bytes. */
  function sourcesUnchanged() {
    const range = ordered();
    if (!range) return true;
    const sources = new Map<HostNode, string | undefined>();
    for (let y = range.start.y; y <= range.end.y; y++) {
      for (const [x, cell] of (cellsAt(y) ?? []).entries()) {
        const metadata = cell.selection;
        if (
          !(included(x, y) || (cell.width === 2 && included(x + 1, y))) ||
          !eligible(cell) ||
          metadata?.selectable === false ||
          !metadata?.owner ||
          cell.width === 0
        )
          continue;
        const owner = metadata.owner;
        let parent: HostNode | undefined = owner;
        while (parent && parent !== current?.region) parent = parent.parent;
        if (!parent) return false;
        if (!sources.has(owner)) {
          const text = (node: HostNode): string =>
            node.type === "raw" ? node.text : node.children.map(text).join("");
          sources.set(owner, sanitizeText(text(owner)));
        }
        const source = sources.get(owner);
        if (
          source === undefined ||
          metadata.offset === undefined ||
          metadata.source === undefined ||
          source.slice(metadata.offset, metadata.offset + cell.text.length) !==
            metadata.source.slice(metadata.offset, metadata.offset + cell.text.length)
        )
          return false;
      }
    }
    return true;
  }
  function extract() {
    const range = ordered();
    if (!range) return "";
    let trailing = "";
    let result = "",
      previous: SelectionCell | undefined;
    for (let y = range.start.y; y <= range.end.y; y++) {
      let row = "",
        first: SelectionCell | undefined,
        last: SelectionCell | undefined;
      const cells = cellsAt(y);
      for (let x = 0; x < (cells?.length ?? 0); x++) {
        const cell = cells![x]!;
        const within =
          included(x, y) ||
          (cell.width === 2 && included(x + 1, y)) ||
          (cell.width === 0 && included(x - 1, y));
        if (
          !within ||
          !eligible(cell) ||
          cell.selection?.selectable === false ||
          !cell.selection?.owner
        )
          continue;
        // Both cells of a wide glyph select the same complete grapheme once.
        if (cell.width === 0) continue;
        row += cell.text;
        first ??= cell;
        last = cell;
      }
      const whitespace = row.slice(row.trimEnd().length);
      row = row.trimEnd();
      if (result) {
        const left = previous?.selection,
          right = first?.selection;
        const sameText = left?.owner === right?.owner;
        const gap =
          sameText && left?.source
            ? left.source.slice(
                (left.offset ?? 0) + (previous?.text.length ?? 0),
                right?.offset ?? 0,
              )
            : "";
        const softWrap = right?.softWrap && (sameText || right.owner !== undefined);
        result += softWrap ? trailing + (/^[ \t]*$/.test(gap) ? gap : "") : "\n";
      }
      result += row;
      trailing = whitespace;
      if (last) previous = last;
    }
    return result;
  }
  function bounds(x: number, y: number, mode: "word" | "line") {
    const row = grid[y] ?? [];
    let start = x,
      end = x;
    if (mode === "line") {
      start = 0;
      end = row.length - 1;
    } else {
      const category = (at: number) => {
        const cell = row[at];
        if (!eligible(cell) || cell?.selection?.selectable === false || !cell?.selection?.owner)
          return -1;
        const text = cell.width === 0 ? (row[at - 1]?.text ?? "") : cell.text;
        if (!text.trim()) return 0;
        return /[\p{L}\p{N}_/.\-+~\\]/u.test(text) ? 1 : 2;
      };
      const target = category(x);
      if (target >= 0) {
        while (start > 0 && category(start - 1) === target) start--;
        while (end + 1 < row.length && category(end + 1) === target) end++;
      }
    }
    return { start: { x: start, y }, end: { x: end, y } };
  }
  function clear() {
    if (current) {
      current = undefined;
      redraw();
    }
  }
  return {
    record(next: readonly (readonly SelectionCell[])[]) {
      const viewports = new Map<HostNode, SelectionViewport>();
      for (const row of next)
        for (const cell of row)
          if (cell.selection?.viewport)
            viewports.set(cell.selection.viewport.owner, cell.selection.viewport);
      let coordinated = false;
      if (current?.focus && !sourcesUnchanged()) current.stale = true;
      if (current?.viewport) {
        const previous = current.viewport;
        const viewport = viewports.get(previous.owner);
        if (!viewport) clear();
        else {
          // Scroll notifications may coalesce while layout anchors settle. Prefer the
          // painted source position over a snapshot delta when it remains visible.
          const anchorCell = grid[current.anchor.y]?.[current.anchor.x]?.selection;
          const paintedRow = anchorCell?.owner
            ? next.findIndex((row) =>
                row.some(
                  (cell) =>
                    cell.selection?.owner === anchorCell.owner &&
                    cell.selection?.offset === anchorCell.offset,
                ),
              )
            : -1;
          const shift =
            paintedRow >= 0
              ? paintedRow - current.anchor.y
              : viewport.top - previous.top - (viewport.scrollTop - previous.scrollTop);
          if (shift || viewport.bottom !== previous.bottom) {
            // Capture from the previous painted frame before translated rows are replaced.
            for (let y = previous.top; y < previous.bottom; y++) {
              const translated = y + shift;
              if (
                (translated < viewport.top || translated >= viewport.bottom) &&
                grid[y]?.some((cell, x) => included(x, y) && eligible(cell))
              )
                current.captured.set(previous.scrollTop + y - previous.top, grid[y]!);
            }
            current.anchor.y += shift;
            if (current.focus) current.focus.y += shift;
            if (current.span) {
              current.span.start.y += shift;
              current.span.end.y += shift;
            }
            coordinated = true;
          }
          current.viewport = viewport;
        }
      }
      grid = next;
      regions.clear();
      for (const row of grid)
        for (const cell of row)
          if (cell.selection) regions.set(cell.selection.region, cell.selection.options);
      if (clicks && (!regions.has(clicks.region) || regions.get(clicks.region)?.key !== clicks.key))
        clicks = undefined;
      if (current) {
        const region = regions.get(current.region);
        if (!region || region.key !== current.key) clear();
        else if (current.focus) {
          if (coordinated) current.baseline = extract();
          else if (extract() !== current.baseline) current.stale = true;
        }
      }
    },
    press(x: number, y: number, modified = false) {
      clear();
      const meta = grid[y]?.[x]?.selection;
      if (meta)
        current = {
          anchor: { x, y },
          region: meta.region,
          key: meta.options.key,
          baseline: "",
          stale: false,
          dragged: false,
          viewport: meta.viewport,
          captured: new Map(),
        };
      const now = Date.now();
      if (!current || modified) {
        clicks = undefined;
        return;
      }
      const count =
        clicks &&
        clicks.region === current.region &&
        clicks.key === current.key &&
        clicks.owner === meta?.owner &&
        now - clicks.at < 500 &&
        Math.abs(x - clicks.x) <= 1 &&
        Math.abs(y - clicks.y) <= 1
          ? clicks.count + 1
          : 1;
      clicks = {
        x,
        y,
        at: now,
        count,
        region: current.region,
        key: current.key,
        owner: meta?.owner,
      };
      if (count > 1) {
        const mode = count === 2 ? "word" : "line";
        const span = bounds(x, y, mode);
        current.span = { ...span, mode };
        current.anchor = span.start;
        current.focus = span.end;
        current.dragged = true;
        current.baseline = extract();
        redraw();
      }
    },
    move(x: number, y: number) {
      if (!current) return false;
      const focus = {
        x: Math.max(0, Math.min((grid[0]?.length ?? 1) - 1, x)),
        y: Math.max(0, Math.min(grid.length - 1, y)),
      };
      if (focus.x === current.anchor.x && focus.y === current.anchor.y && !current.dragged)
        return false;
      if (current.focus?.x === focus.x && current.focus.y === focus.y) return current.dragged;
      if (current.span) {
        const span = bounds(focus.x, focus.y, current.span.mode);
        const backwards =
          focus.y < current.span.start.y ||
          (focus.y === current.span.start.y && focus.x < current.span.start.x);
        current.anchor = backwards ? current.span.end : current.span.start;
        current.focus = backwards ? span.start : span.end;
      } else current.focus = focus;
      current.dragged = true;
      current.stale = false;
      current.baseline = extract();
      redraw();
      return true;
    },
    extend(name: string) {
      if (!current || !["left", "right", "up", "down", "home", "end"].includes(name)) return false;
      const point = current.focus ?? current.anchor;
      const maxX = (grid[0]?.length ?? 1) - 1,
        maxY = grid.length - 1;
      let { x, y } = point;
      if (name === "left") {
        if (x > 0) x--;
        else if (y > 0) {
          y--;
          x = maxX;
        }
      }
      if (name === "right") {
        if (x < maxX) x++;
        else if (y < maxY) {
          y++;
          x = 0;
        }
      }
      if (name === "up") y = Math.max(0, y - 1);
      if (name === "down") y = Math.min(maxY, y + 1);
      if (name === "home") x = 0;
      if (name === "end") x = maxX;
      current.span = undefined;
      if (x !== point.x || y !== point.y) this.move(x, y);
      return true;
    },
    release() {
      if (!current) return false;
      const selected = current;
      const viewport = selected.viewport;
      const fullyOutside =
        viewport &&
        selected.focus &&
        ((selected.anchor.y < viewport.top && selected.focus.y < viewport.top) ||
          (selected.anchor.y >= viewport.bottom && selected.focus.y >= viewport.bottom));
      const text = fullyOutside ? "" : extract();
      const options = regions.get(selected.region);
      const unchanged = sourcesUnchanged();
      clear();
      if (!selected.dragged) return false;
      if (fullyOutside) return true;
      if (!options || options.key !== selected.key) return true;
      if (selected.stale || !unchanged || text !== selected.baseline) {
        options.onResult("stale");
        return true;
      }
      if (!text) return true;
      void Promise.resolve()
        .then(() => options.onCopy(text))
        .catch(() => false)
        .then((copied) => {
          const latest = regions.get(selected.region);
          if (alive && latest && latest.key === selected.key)
            latest.onResult(copied === "sent" ? "sent" : copied ? "copied" : "unavailable");
        });
      return true;
    },
    selected(x: number, y: number, cell: SelectionCell) {
      const within =
        included(x, y) ||
        (cell.width === 2 && included(x + 1, y)) ||
        (cell.width === 0 && included(x - 1, y));
      if (
        !within ||
        !eligible(cell) ||
        cell.selection?.selectable === false ||
        !cell.selection?.owner
      )
        return undefined;
      return cell.selection.options.backgroundColor ?? "#394867";
    },
    hasSelection: () => !!current,
    clear() {
      clicks = undefined;
      clear();
    },
    dispose() {
      alive = false;
      current = undefined;
      grid = [];
      regions.clear();
    },
  };
}
