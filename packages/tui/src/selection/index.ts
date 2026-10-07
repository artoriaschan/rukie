import type { HostNode } from "../layout";
import type { TextStyle } from "../text";

export type TextSelectionResult = "copied" | "unavailable" | "stale";
/** The frontend owns clipboard transport and feedback; the renderer owns selected bytes. */
export interface TextSelectionOptions {
  key?: string;
  backgroundColor?: TextStyle["backgroundColor"];
  onCopy(text: string): Promise<boolean>;
  onResult(result: TextSelectionResult): void;
}
export interface SelectionMetadata {
  region: HostNode;
  options: TextSelectionOptions;
  selectable?: boolean;
  owner?: HostNode;
  source?: string;
  offset?: number;
  softWrap?: boolean;
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
      }
    | undefined;
  let alive = true;
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
      for (let x = 0; x < (grid[y]?.length ?? 0); x++) {
        const cell = grid[y]![x]!;
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
  function clear() {
    if (current) {
      current = undefined;
      redraw();
    }
  }
  return {
    record(next: readonly (readonly SelectionCell[])[]) {
      grid = next;
      regions.clear();
      for (const row of grid)
        for (const cell of row)
          if (cell.selection) regions.set(cell.selection.region, cell.selection.options);
      if (current) {
        const region = regions.get(current.region);
        if (!region || region.key !== current.key) clear();
        else if (current.focus && extract() !== current.baseline) current.stale = true;
      }
    },
    press(x: number, y: number) {
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
        };
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
      current.focus = focus;
      current.dragged = true;
      current.stale = false;
      current.baseline = extract();
      redraw();
      return true;
    },
    release() {
      if (!current) return false;
      const selected = current;
      const text = extract();
      const options = regions.get(selected.region);
      clear();
      if (!selected.dragged) return false;
      if (!options || options.key !== selected.key) return true;
      if (selected.stale || text !== selected.baseline) {
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
            latest.onResult(copied ? "copied" : "unavailable");
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
    clear,
    dispose() {
      alive = false;
      current = undefined;
      grid = [];
      regions.clear();
    },
  };
}
