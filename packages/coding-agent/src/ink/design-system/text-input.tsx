import { useLayoutEffect, useRef, useState } from "react";
import Box from "../components/Box";
import measureElement from "../measure-element";
import type { DOMElement } from "../dom";
import Text from "../components/Text";
import { useDeclaredCursor } from "../hooks/use-declared-cursor";
import useInput from "../hooks/use-input";
import { useTerminalSize } from "../hooks/use-terminal-size";
import { textCursor, textLines, type TextStyle, type TextSpan, type Glyph } from "./text";
import type { InputEvent } from "../events/input-event";

export interface TextInputProps extends TextStyle {
  value: string;
  /** Read the owner value before each event when a native input batch includes external resets. */
  getValue?(): string;
  /** Edits report the replaced UTF-16 range before the new value is applied. */
  onChange(value: string, edit?: { start: number; end: number; text: string }): void;
  onSubmit?(value: string): void;
  /** Reports the snapped UTF-16 caret offset when it changes, including owner resets. */
  onCursorChange?(offset: number): void;
  /** Opt in to primary clicks on atomic glyphs: move to the unit start and notify, even at the same caret. */
  onAtomicRangeClick?(offset: number): void;
  isActive?: boolean;
  /** Exclude editor cells from root text selection; editable composers can opt in. */
  noSelect?: boolean;
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
  getValue,
  onChange,
  onSubmit,
  onCursorChange,
  onAtomicRangeClick,
  isActive = true,
  noSelect = true,
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
  const [measuredWidth, setMeasuredWidth] = useState<number>();
  const node = useRef<DOMElement | null>(null);
  const width = Math.max(1, columns ?? measuredWidth ?? size.columns);
  useLayoutEffect(() => {
    if (columns !== undefined || !node.current) return;
    const next = Math.max(1, Math.floor(measureElement(node.current).width));
    if (next !== measuredWidth) setMeasuredWidth(next);
  });
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
  const move = (offset: number, select = false) => {
    const current = editing.current;
    offset = snap(offset, Math.sign(offset - current.cursor));
    current.anchor = select ? (current.anchor ?? current.cursor) : undefined;
    setAnchor(current.anchor);
    current.cursor = offset;
    setCursor(offset);
    if (reportedCursor.current !== offset) {
      reportedCursor.current = offset;
      onCursorChange?.(offset);
    }
  };
  useInput(
    (input, key, event) => {
      const current = editing.current;
      const owned = getValue?.();
      if (owned !== undefined && owned !== current.value) { current.value = owned; current.cursor = owned.length; current.anchor = undefined; current.ranges = []; history?.reset(); }
      const boundaries = graphemeBoundaries(current.value);
      const before = boundaries.findLast((offset) => offset < current.cursor) ?? 0;
      const after = boundaries.find((offset) => offset > current.cursor) ?? current.value.length;
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
      if (key.wheelUp || key.wheelDown || key.wheelLeft || key.wheelRight) return;
      if (event.isPasted) {
        if (onPaste) onPaste(event.input, insert);
        else insert(event.input);
        return;
      }
      if (key.ctrl || key.meta) return;
      if (key.leftArrow)
        move(
          !key.shift && current.anchor !== undefined
            ? Math.min(current.anchor, current.cursor)
            : before,
          key.shift,
        );
      else if (key.rightArrow)
        move(
          !key.shift && current.anchor !== undefined
            ? Math.max(current.anchor, current.cursor)
            : after,
          key.shift,
        );
      else if (key.home)
        move(
          current.cursor === 0 ? 0 : current.value.lastIndexOf("\n", current.cursor - 1) + 1,
          key.shift,
        );
      else if (key.end) {
        const end = current.value.indexOf("\n", current.cursor);
        move(end < 0 ? current.value.length : end, key.shift);
      } else if (key.upArrow || key.downArrow) {
        const spans = [{ text: current.value + " ", style: {} }];
        const caret = textCursor(spans, width, current.cursor, current.ranges);
        const lines = textLines(spans, width, true, true, current.ranges);
        const row = caret.y + (key.upArrow ? -1 : 1);
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
          const recalled = history?.recall(
            key.upArrow ? "up" : "down",
            current.value,
            current.cursor,
          );
          if (recalled) {
            onHistoryRecall?.();
            current.value = recalled.value;
            current.ranges = [];
            move(recalled.cursor);
            onChange(current.value);
          }
        }
      } else if (key.backspace && (current.cursor > 0 || current.anchor !== undefined))
        replace(before, current.cursor, "");
      else if (
        key.delete &&
        (current.cursor < current.value.length || current.anchor !== undefined)
      )
        replace(current.cursor, after, "");
      else if (key.return) {
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
  // Product wrapping preserves whitespace and indivisible editing units. The
  // runtime receives real Text/Box nodes, never a renderer-specific editor host.
  const spans: TextSpan[] = edges.slice(0, -1).map((start, index) => {
    const highlight = highlightRanges?.find((range) => range.start <= start && start < range.end);
    return {
      text: value.slice(start, edges[index + 1]),
      style: {
        ...style,
        color: highlight?.color ?? style.color,
        inverse:
          selection && selection.start <= start && start < selection.end
            ? true
            : (highlight?.inverse ?? style.inverse),
      },
    };
  });
  spans.push({ text: " ", style });
  const lines = textLines(spans, width, true, true, atomicRanges);
  const caret = textCursor(spans, width, position, atomicRanges);
  const limit = Math.max(1, maxLines ?? lines.length);
  const viewport = useRef(0);
  const height = Math.min(limit, lines.length);
  viewport.current = Math.max(0, Math.min(viewport.current, lines.length - height));
  if (readOnly && !isActive) viewport.current = 0;
  else {
    if (caret.y < viewport.current) viewport.current = caret.y;
    if (caret.y >= viewport.current + height) viewport.current = caret.y - height + 1;
  }
  const cursorRef = useDeclaredCursor({
    line: caret.y - viewport.current,
    column: caret.x,
    active: isActive,
  });
  return (
    <Box
      ref={(element) => {
        node.current = element;
        cursorRef(element);
      }}
      noSelect={readOnly || noSelect}
      flexDirection="column"
      width={columns ?? "100%"}
      height={height}
      flexShrink={0}
      onClick={isActive && !readOnly ? (event) => {
        const line = lines[viewport.current + event.localRow];
        if (!line || event.pressLocalRow !== event.localRow) return;
        const offsetAt = (target: number) => {
          let column = 0;
          let offset = line.at(-1)?.offset ?? value.length;
          for (const glyph of line) {
            offset = glyph.offset;
            if (target < column + glyph.width || glyph.lineBreak) break;
            column += glyph.width;
            offset = glyph.offset + glyph.text.length;
          }
          return Math.min(value.length, offset);
        };
        const offset = offsetAt(event.localCol);
        if (offsetAt(event.pressLocalCol) !== offset) return;
        history?.reset();
        move(Math.min(value.length, offset));
        event.stopImmediatePropagation();
      } : undefined}
    >
      {lines.slice(viewport.current, viewport.current + height).map((line, index) => {
        let column = 0;
        const row = viewport.current + index;
        const groups: Glyph[][] = [];
        for (const glyph of line) {
          const previous = groups.at(-1);
          if (previous && previous[0]?.atomic === glyph.atomic) previous.push(glyph);
          else groups.push([glyph]);
        }
        return (
          <Box key={row} height={1} flexShrink={0} width={width}
            softWrapContinuation={row > 0 && !lines[row - 1]?.some((glyph) => glyph.lineBreak)
              ? lines[row - 1]!.reduce((sum, glyph) => sum + glyph.width, 0) : undefined}>
            {groups.map((group, groupIndex) => {
              const atomic = group[0]?.atomic;
              const groupWidth = group.reduce((sum, glyph) => sum + glyph.width, 0);
              const painted = group.map((glyph, glyphIndex) => {
                const atCaret = row === caret.y && column === caret.x;
                column += glyph.width;
                if (!glyph.text) return null;
                const { bold, dim, ...glyphStyle } = glyph.style;
                return (
                  <Text
                    key={glyphIndex}
                    {...glyphStyle}
                    {...(bold !== undefined ? { bold } : { dim: dim ?? false })}
                    inverse={
                      isActive && cursorStyle === "block" && atCaret ? true : glyph.style.inverse
                    }
                  >
                    {glyph.text}
                  </Text>
                );
              });
              return (
                <Box
                  key={groupIndex}
                  width={groupWidth}
                  flexShrink={0}
                  onClick={
                    atomic !== undefined && onAtomicRangeClick && isActive && !readOnly
                      ? (event) => {
                          if (
                            event.pressLocalRow !== 0 ||
                            event.pressLocalCol < 0 ||
                            event.pressLocalCol >= groupWidth
                          )
                            return;
                          const range = editing.current.ranges.find(
                            (range) => range.start === atomic,
                          );
                          if (!range) return;
                          history?.reset();
                          move(range.start);
                          onAtomicRangeClick(range.start);
                          event.stopImmediatePropagation();
                        }
                      : undefined
                  }
                >
                  <Text wrap="truncate">{painted}</Text>
                </Box>
              );
            })}
            {isActive && cursorStyle === "block" && row === caret.y && column === caret.x ? (
              <Text inverse> </Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
