import { createElement, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useInput, useTerminalSize } from "../hooks";
import { textCursor, textLines, type TextStyle } from "../text";
import type { InputEvent } from "../input";

export interface TextInputProps extends TextStyle {
  value: string;
  /** Edits report the replaced UTF-16 range before the new value is applied. */
  onChange(value: string, edit?: { start: number; end: number; text: string }): void;
  onSubmit?(value: string): void;
  /** Reports the snapped UTF-16 caret offset when it changes, including owner resets. */
  onCursorChange?(offset: number): void;
  isActive?: boolean;
  maxLines?: number;
  columns?: number;
  cursorStyle?: "block";
  /** Present a screen-owned editor without subscribing to input. */
  readOnly?: boolean;
  /** UTF-16 caret offset supplied by the owner of a read-only editor. */
  cursorOffset?: number;
  /** Owner-created history survives temporary editor unmounts. */
  history?: ReturnType<typeof createTextInputHistory>;
  /** Notify the owner before a text-only history replacement. */
  onHistoryRecall?(): void;
  /** Intercept a paste; call insert to place accepted text at the live caret. */
  onPaste?(text: string, insert: (text: string) => void): void;
  /** Ordered, non-overlapping UTF-16 ranges with foreground and inverse emphasis. */
  highlightRanges?: readonly {
    start: number;
    end: number;
    color?: TextStyle["color"];
    inverse?: boolean;
  }[];
  /** Ordered UTF-16 ranges that form indivisible editing and wrapping units. */
  atomicRanges?: readonly { start: number; end: number }[];
  /** Let a screen reserve navigation keys for a completion menu. */
  filterInput?(event: InputEvent, insert: (text: string) => void): boolean;
}

/** Browse oldest-first inputs while retaining the draft and its UTF-16 caret. */
export function createTextInputHistory(entries: readonly string[]) {
  let walk: { index: number; value: string; cursor: number } | undefined;
  return {
    isBrowsing() {
      return walk !== undefined;
    },
    reset() {
      walk = undefined;
    },
    recall(direction: "up" | "down", value: string, cursor: number) {
      if (!entries.length) return;
      if (direction === "up") {
        walk ??= { index: entries.length, value, cursor };
        walk.index = Math.max(0, walk.index - 1);
      } else if (!walk) return;
      else walk.index += 1;
      if (walk.index >= entries.length) {
        const draft = { value: walk.value, cursor: walk.cursor };
        walk = undefined;
        return draft;
      }
      const recalled = entries[walk.index]!;
      return { value: recalled, cursor: recalled.length };
    },
  };
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function graphemeBoundaries(text: string) {
  return [
    0,
    ...Array.from(segmenter.segment(text), ({ index, segment }) => index + segment.length),
  ];
}

/** Controlled multiline editor. Cursor offsets follow graphemes, rather than code units. */
export function TextInput({
  value,
  onChange,
  onSubmit,
  onCursorChange,
  isActive = true,
  maxLines,
  columns,
  cursorStyle,
  readOnly = false,
  cursorOffset,
  history,
  onHistoryRecall,
  filterInput,
  onPaste,
  highlightRanges,
  atomicRanges = [],
  ...style
}: TextInputProps) {
  const size = useTerminalSize();
  const width = Math.max(1, columns ?? size.columns);
  const [cursor, setCursor] = useState(value.length);
  const editing = useRef<{
    value: string;
    cursor: number;
    anchor?: number;
    ranges: readonly { start: number; end: number }[];
  }>({
    value,
    cursor: value.length,
    ranges: atomicRanges,
  });
  const [anchor, setAnchor] = useState<number>();
  const snap = (offset: number, direction = 0, ranges = editing.current.ranges) => {
    const range = ranges.find((range) => range.start < offset && offset < range.end);
    if (!range) return offset;
    return direction < 0 || (direction === 0 && offset - range.start < range.end - offset)
      ? range.start
      : range.end;
  };
  const position = snap(
    graphemeBoundaries(value).findLast((offset) => offset <= (cursorOffset ?? cursor)) ?? 0,
    0,
    atomicRanges,
  );
  useLayoutEffect(() => {
    // An owner reset (submit, clear, or external fill) ends the history walk.
    if (editing.current.value !== value) {
      history?.reset();
      editing.current.anchor = undefined;
      setAnchor(undefined);
    }
    editing.current.value = value;
    editing.current.ranges = atomicRanges;
    editing.current.cursor = position;
    if (cursor !== position) setCursor(position);
  });
  const reportedCursor = useRef<number>(undefined);
  useLayoutEffect(() => {
    if (reportedCursor.current === position) return;
    reportedCursor.current = position;
    onCursorChange?.(position);
  }, [position, onCursorChange]);
  useInput(
    (event) => {
      const current = editing.current;
      const boundaries = graphemeBoundaries(current.value);
      const before = boundaries.findLast((offset) => offset < current.cursor) ?? 0;
      const after = boundaries.find((offset) => offset > current.cursor) ?? current.value.length;
      const move = (offset: number, select = false) => {
        offset = snap(offset, Math.sign(offset - current.cursor));
        current.anchor = select ? (current.anchor ?? current.cursor) : undefined;
        setAnchor(current.anchor);
        current.cursor = offset;
        setCursor(offset);
      };
      const replace = (start: number, end: number, text: string) => {
        if (current.anchor !== undefined) {
          start = Math.min(current.anchor, current.cursor);
          end = Math.max(current.anchor, current.cursor);
        }
        start = snap(start, -1);
        end = snap(end, 1);
        current.ranges = current.ranges.flatMap((range) => {
          if (range.end <= start) return [range];
          if (range.start < end) return [];
          const shift = text.length - (end - start);
          return [{ start: range.start + shift, end: range.end + shift }];
        });
        current.value = current.value.slice(0, start) + text + current.value.slice(end);
        move(start + text.length);
        onChange(current.value, { start, end, text });
      };
      const insert = (text: string) =>
        replace(current.cursor, current.cursor, text.replace(/\r\n?/g, "\n"));
      if (filterInput && !filterInput(event, insert)) return;
      if (event.type !== "key" && event.type !== "paste") return;
      if (event.type === "paste") {
        if (onPaste) onPaste(event.input, insert);
        else insert(event.input);
        return;
      }
      const { key, input } = event;
      if (key.ctrl || key.alt) return;
      if (key.name === "left")
        move(
          !key.shift && current.anchor !== undefined
            ? Math.min(current.anchor, current.cursor)
            : before,
          key.shift,
        );
      else if (key.name === "right")
        move(
          !key.shift && current.anchor !== undefined
            ? Math.max(current.anchor, current.cursor)
            : after,
          key.shift,
        );
      else if (key.name === "home")
        move(
          current.cursor === 0 ? 0 : current.value.lastIndexOf("\n", current.cursor - 1) + 1,
          key.shift,
        );
      else if (key.name === "end") {
        const end = current.value.indexOf("\n", current.cursor);
        move(end < 0 ? current.value.length : end, key.shift);
      } else if (key.name === "up" || key.name === "down") {
        const spans = [{ text: current.value + " ", style: {} }];
        const caret = textCursor(spans, width, current.cursor, current.ranges);
        const lines = textLines(spans, width, true, true, current.ranges);
        const row = caret.y + (key.name === "up" ? -1 : 1);
        const line = lines[row];
        if (line) {
          let x = 0;
          let offset = line[0]?.offset ?? current.cursor;
          for (const glyph of line) {
            if (x > caret.x) break;
            offset = glyph.offset;
            x += glyph.width;
          }
          move(Math.min(current.value.length, offset), key.shift);
        } else {
          const recalled = history?.recall(key.name, current.value, current.cursor);
          if (recalled) {
            onHistoryRecall?.();
            current.value = recalled.value;
            current.ranges = [];
            move(recalled.cursor);
            onChange(current.value);
          }
        }
      } else if (key.name === "backspace" && (current.cursor > 0 || current.anchor !== undefined))
        replace(before, current.cursor, "");
      else if (
        key.name === "delete" &&
        (current.cursor < current.value.length || current.anchor !== undefined)
      )
        replace(current.cursor, after, "");
      else if (key.name === "enter") {
        const atLineEnd =
          current.cursor === current.value.length || current.value[current.cursor] === "\n";
        if (key.shift) replace(current.cursor, current.cursor, "\n");
        else if (atLineEnd && current.value[current.cursor - 1] === "\\")
          replace(current.cursor - 1, current.cursor, "\n");
        else onSubmit?.(current.value);
      } else if (input) replace(current.cursor, current.cursor, input);
    },
    { isActive: isActive && !readOnly },
  );
  const selection =
    anchor === undefined
      ? undefined
      : {
          start: snap(Math.min(anchor, position), -1),
          end: snap(Math.max(anchor, position), 1),
        };
  const edges = [
    ...new Set([
      0,
      value.length,
      ...(highlightRanges ?? []).flatMap(({ start, end }) => [start, end]),
      ...(selection ? [selection.start, selection.end] : []),
    ]),
  ].sort((a, b) => a - b);
  const children: ReactNode[] = edges.slice(0, -1).map((start, index) => {
    const end = edges[index + 1]!;
    const highlight = highlightRanges?.find((range) => range.start <= start && start < range.end);
    return createElement(
      "tui-text",
      {
        key: start,
        color: highlight?.color,
        inverse:
          selection && selection.start <= start && start < selection.end
            ? true
            : highlight?.inverse,
      },
      value.slice(start, end),
    );
  });
  children.push(createElement("tui-text", { key: "caret" }, " "));
  return createElement(
    "tui-text",
    {
      ...style,
      input: true,
      width: columns,
      maxLines,
      cursorStyle,
      atomicRanges,
      cursorOffset: isActive ? position : undefined,
    },
    ...children,
  );
}
