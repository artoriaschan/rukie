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
  bold?: boolean;
  dimColor?: boolean;
}

export interface TextSpan {
  text: string;
  style: TextStyle;
}

export interface Glyph {
  text: string;
  width: number;
  style: TextStyle;
  cursorMarker?: boolean;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function fitLine(glyphs: Glyph[], columns: number, wrap: boolean): Glyph[][] {
  const lines: Glyph[][] = [[]];
  let width = 0;
  for (const [index, glyph] of glyphs.entries()) {
    // A caret uses the next visible glyph's cell, or a blank cell at line end.
    const requiredWidth = glyph.cursorMarker ? (glyphs[index + 1]?.width ?? 1) : glyph.width;
    if (width + requiredWidth > columns) {
      if (!wrap) break;
      lines.push([]);
      width = 0;
    }
    lines[lines.length - 1]!.push(glyph);
    width += glyph.width;
  }
  return lines;
}

function sanitizeText(text: string) {
  // oxlint-disable-next-line no-control-regex -- literal control bytes must not reach the terminal
  return text.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "");
}

function layoutText(
  spans: TextSpan[],
  columns = Infinity,
  wrap = true,
  preserveWhitespace = false,
  cursorOffset?: number,
): Glyph[][] {
  // Terminal commands and other control characters are never emitted as text.
  const explicit: Glyph[][] = [[]];
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
    if (cursorIndex !== undefined && index >= cursorIndex) {
      explicit[explicit.length - 1]!.push({ text: "", width: 0, style: {}, cursorMarker: true });
      cursorIndex = undefined;
    }
    while (spanIndex < sanitized.length - 1 && index >= spanEnd) {
      spanEnd += sanitized[++spanIndex]!.text.length;
    }
    if (segment === "\n") {
      explicit.push([]);
    } else {
      explicit[explicit.length - 1]!.push({
        text: segment,
        width: Bun.stringWidth(segment),
        style: sanitized[spanIndex]!.style,
      });
    }
  }
  if (cursorIndex !== undefined)
    explicit[explicit.length - 1]!.push({ text: "", width: 0, style: {}, cursorMarker: true });
  const lines: Glyph[][] = [];
  for (const line of explicit) {
    const fitting = line.filter(
      (glyph) => glyph.cursorMarker || (glyph.width > 0 && glyph.width <= columns),
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
): Glyph[][] {
  return layoutText(spans, columns, wrap, preserveWhitespace);
}

/** Use the same sanitization, wide-glyph filtering and hard wrapping as input painting. */
export function textCursor(spans: TextSpan[], columns: number, cursorOffset: number) {
  const lines = layoutText(spans, columns, true, true, cursorOffset);
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
