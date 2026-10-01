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
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function fitLine(glyphs: Glyph[], columns: number, wrap: boolean): Glyph[][] {
  const lines: Glyph[][] = [[]];
  let width = 0;
  for (const glyph of glyphs) {
    if (width + glyph.width > columns) {
      if (!wrap) break;
      lines.push([]);
      width = 0;
    }
    lines[lines.length - 1]!.push(glyph);
    width += glyph.width;
  }
  return lines;
}

export function textLines(spans: TextSpan[], columns = Infinity, wrap = true): Glyph[][] {
  // Terminal commands and other control characters are never emitted as text.
  const explicit: Glyph[][] = [[]];
  const sanitized = spans.map((span) => ({
    ...span,
    // oxlint-disable-next-line no-control-regex -- literal control bytes must not reach the terminal
    text: span.text.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, ""),
  }));
  let spanIndex = 0;
  let spanEnd = sanitized[0]?.text.length ?? 0;
  // Segment the complete text: React child boundaries can split a single grapheme.
  // A terminal glyph has one style, inherited from its first code point.
  for (const { segment, index } of segmenter.segment(sanitized.map((span) => span.text).join(""))) {
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
  const lines: Glyph[][] = [];
  for (const line of explicit) {
    const fitting = line.filter((glyph) => glyph.width > 0 && glyph.width <= columns);
    if (wrap && Number.isFinite(columns) && columns > 0) {
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
      lines.push(...fitLine(fitting, columns, false));
    }
  }
  return lines;
}

export function lineWidth(line: Glyph[]): number {
  return line.reduce((width, glyph) => width + glyph.width, 0);
}
