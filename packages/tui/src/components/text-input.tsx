import { createElement, useLayoutEffect, useRef, useState } from "react";
import { useInput, useTerminalSize } from "../hooks";
import { textCursor, textLines, type TextStyle } from "../text";
import type { InputEvent } from "../input";

export interface TextInputProps extends TextStyle {
  value: string;
  onChange(value: string): void;
  onSubmit?(value: string): void;
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
  /** Intercept a paste; call insert to place accepted text at the live caret. */
  onPaste?(text: string, insert: (text: string) => void): void;
  /** Ordered, non-overlapping UTF-16 ranges to paint with a distinct foreground. */
  highlightRanges?: readonly { start: number; end: number; color: TextStyle["color"] }[];
  /** Let a screen reserve navigation keys for a completion menu. */
  filterInput?(event: InputEvent, insert: (text: string) => void): boolean;
}

/** Browse oldest-first inputs while retaining the draft and its UTF-16 caret. */
export function createTextInputHistory(entries: readonly string[]) {
  let walk: { index: number; value: string; cursor: number } | undefined;
  return {
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
  isActive = true,
  maxLines,
  columns,
  cursorStyle,
  readOnly = false,
  cursorOffset,
  history,
  filterInput,
  onPaste,
  highlightRanges,
  ...style
}: TextInputProps) {
  const size = useTerminalSize();
  const width = Math.max(1, columns ?? size.columns);
  const [cursor, setCursor] = useState(value.length);
  const editing = useRef({ value, cursor: value.length });
  const position =
    graphemeBoundaries(value).findLast((offset) => offset <= (cursorOffset ?? cursor)) ?? 0;
  useLayoutEffect(() => {
    // An owner reset (submit, clear, or external fill) ends the history walk.
    if (editing.current.value !== value) history?.reset();
    editing.current.value = value;
    editing.current.cursor = position;
    if (cursor !== position) setCursor(position);
  });
  useInput(
    (event) => {
      const current = editing.current;
      const boundaries = graphemeBoundaries(current.value);
      const before = boundaries.findLast((offset) => offset < current.cursor) ?? 0;
      const after = boundaries.find((offset) => offset > current.cursor) ?? current.value.length;
      const move = (offset: number) => {
        current.cursor = offset;
        setCursor(offset);
      };
      const replace = (start: number, end: number, text: string) => {
        current.value = current.value.slice(0, start) + text + current.value.slice(end);
        move(start + text.length);
        onChange(current.value);
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
      if (key.name === "left") move(before);
      else if (key.name === "right") move(after);
      else if (key.name === "home")
        move(current.cursor === 0 ? 0 : current.value.lastIndexOf("\n", current.cursor - 1) + 1);
      else if (key.name === "end") {
        const end = current.value.indexOf("\n", current.cursor);
        move(end < 0 ? current.value.length : end);
      } else if (key.name === "up" || key.name === "down") {
        const spans = [{ text: current.value + " ", style: {} }];
        const caret = textCursor(spans, width, current.cursor);
        const lines = textLines(spans, width, true, true);
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
          move(Math.min(current.value.length, offset));
        } else {
          const recalled = history?.recall(key.name, current.value, current.cursor);
          if (recalled) {
            current.value = recalled.value;
            move(recalled.cursor);
            onChange(current.value);
          }
        }
      } else if (key.name === "backspace" && current.cursor > 0)
        replace(before, current.cursor, "");
      else if (key.name === "delete" && current.cursor < current.value.length)
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
  const children = [];
  let offset = 0;
  for (const range of highlightRanges ?? []) {
    children.push(value.slice(offset, range.start));
    children.push(
      createElement(
        "tui-text",
        { key: range.start, color: range.color },
        value.slice(range.start, range.end),
      ),
    );
    offset = range.end;
  }
  children.push(value.slice(offset) + " ");
  return createElement(
    "tui-text",
    {
      ...style,
      input: true,
      width: columns,
      maxLines,
      cursorStyle,
      cursorOffset: isActive ? position : undefined,
    },
    ...children,
  );
}
