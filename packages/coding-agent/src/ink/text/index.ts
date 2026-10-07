type Color =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"
  | `#${string}`;

export interface TextStyle {
  color?: Color;
  backgroundColor?: Color;
  bold?: boolean;
  dimColor?: boolean;
  inverse?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

export interface TextSpan {
  selectable?: boolean;
  text: string;
  style: TextStyle;
}

export interface Glyph {
  selectable?: boolean;
  text: string;
  width: number;
  style: TextStyle;
  offset: number;
  cursorMarker?: boolean;
  lineBreak?: boolean;
  atomic?: number;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function fitLine(glyphs: Glyph[], columns: number, wrap: boolean): Glyph[][] {
  const lines: Glyph[][] = [[]];
  let width = 0;
  for (const [index, glyph] of glyphs.entries()) {
    // A caret uses the next visible glyph's cell, or a blank cell at line end.
    const groupStart = glyph.atomic !== undefined && glyphs[index - 1]?.atomic !== glyph.atomic;
    let requiredWidth = glyph.cursorMarker ? glyphs[index + 1]?.width || 1 : glyph.width;
    if (groupStart) {
      requiredWidth = 0;
      for (let next = index; glyphs[next]?.atomic === glyph.atomic; next++)
        requiredWidth += glyphs[next]!.width;
    }
    if (width + requiredWidth > columns && (glyph.atomic === undefined || groupStart)) {
      if (!wrap) break;
      lines.push([]);
      width = 0;
    }
    lines[lines.length - 1]!.push(glyph);
    width += glyph.width;
  }
  return lines;
}

export function sanitizeText(text: string) {
  // oxlint-disable-next-line no-control-regex -- literal control bytes must not reach the terminal
  return text.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "");
}

function layoutText(
  spans: TextSpan[],
  columns = Infinity,
  wrap = true,
  preserveWhitespace = false,
  cursorOffset?: number,
  atomicRanges: readonly { start: number; end: number }[] = [],
): Glyph[][] {
  // Terminal commands and other control characters are never emitted as text.
  const explicit: Glyph[][] = [[]];
  const original = spans.map((span) => span.text).join("");
  const sanitizedRanges = atomicRanges.map(({ start, end }) => ({
    start: sanitizeText(original.slice(0, start)).length,
    end: sanitizeText(original.slice(0, end)).length,
  }));
  const sanitized = spans.map((span) => ({
    ...span,
    text: sanitizeText(span.text),
  }));
  let cursorIndex =
    cursorOffset === undefined
      ? undefined
      : sanitizeText(
          spans
            .map((span) => span.text)
            .join("")
            .slice(0, cursorOffset),
        ).length;
  let spanIndex = 0;
  let spanEnd = sanitized[0]?.text.length ?? 0;
  // Segment the complete text: React child boundaries can split a single grapheme.
  // A terminal glyph has one style, inherited from its first code point.
  for (const { segment, index } of segmenter.segment(sanitized.map((span) => span.text).join(""))) {
    const atomic = sanitizedRanges.find(
      (range) => range.start <= index && index < range.end,
    )?.start;
    if (cursorIndex !== undefined && index >= cursorIndex) {
      explicit[explicit.length - 1]!.push({
        text: "",
        width: 0,
        style: {},
        offset: index,
        cursorMarker: true,
        atomic,
      });
      cursorIndex = undefined;
    }
    while (spanIndex < sanitized.length - 1 && index >= spanEnd) {
      spanEnd += sanitized[++spanIndex]!.text.length;
    }
    if (segment === "\n") {
      explicit[explicit.length - 1]!.push({
        text: "",
        width: 0,
        style: {},
        offset: index,
        atomic,
        lineBreak: true,
      });
      explicit.push([]);
    } else {
      explicit[explicit.length - 1]!.push({
        text: segment,
        width: Bun.stringWidth(segment),
        style: sanitized[spanIndex]!.style,
        selectable: sanitized[spanIndex]!.selectable,
        offset: index,
        atomic,
      });
    }
  }
  if (cursorIndex !== undefined)
    explicit[explicit.length - 1]!.push({
      text: "",
      width: 0,
      style: {},
      offset: cursorIndex,
      cursorMarker: true,
    });
  if (explicit[explicit.length - 1]!.length === 0) {
    explicit[explicit.length - 1]!.push({
      text: "",
      width: 0,
      style: {},
      offset: sanitized.reduce((length, span) => length + span.text.length, 0),
      lineBreak: true,
    });
  }
  const lines: Glyph[][] = [];
  for (const line of explicit) {
    const fitting = line.filter(
      (glyph) =>
        glyph.cursorMarker || glyph.lineBreak || (glyph.width > 0 && glyph.width <= columns),
    );
    if (wrap && !preserveWhitespace && Number.isFinite(columns) && columns > 0) {
      // Use Bun for word boundaries, but split overlong words ourselves: its
      // hard mode can insert a break inside an emoji/combining grapheme.
      const wrapped = Bun.wrapAnsi(fitting.map((glyph) => glyph.text).join(""), columns);
      let offset = 0;
      for (const part of wrapped.split("\n")) {
        const current: Glyph[] = [];
        for (const { segment } of segmenter.segment(part)) {
          // wrapAnsi may omit whitespace at a word boundary. Reuse the original
          // glyphs so wrapping cannot discard their inherited styles.
          while (fitting[offset]?.text !== segment && offset < fitting.length) offset++;
          const glyph = fitting[offset++];
          if (glyph) current.push(glyph);
        }
        if (current.length === 0) {
          const empty = fitting.find((glyph) => glyph.lineBreak);
          if (empty) current.push(empty);
        }
        lines.push(...fitLine(current, columns, true));
      }
    } else {
      lines.push(...fitLine(fitting, columns, wrap));
    }
  }
  return lines;
}

export function textLines(
  spans: TextSpan[],
  columns = Infinity,
  wrap = true,
  preserveWhitespace = false,
  atomicRanges: readonly { start: number; end: number }[] = [],
): Glyph[][] {
  return layoutText(spans, columns, wrap, preserveWhitespace, undefined, atomicRanges);
}

/** Use the same sanitization, wide-glyph filtering and hard wrapping as input painting. */
export function textCursor(
  spans: TextSpan[],
  columns: number,
  cursorOffset: number,
  atomicRanges: readonly { start: number; end: number }[] = [],
) {
  const lines = layoutText(spans, columns, true, true, cursorOffset, atomicRanges);
  for (const [y, line] of lines.entries()) {
    let x = 0;
    for (const glyph of line) {
      if (glyph.cursorMarker) return { x, y };
      x += glyph.width;
    }
  }
  return { x: 0, y: 0 };
}

export function lineWidth(line: Glyph[]): number {
  return line.reduce((width, glyph) => width + glyph.width, 0);
}
