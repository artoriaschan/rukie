import type { HostNode, LayoutNode } from "../layout";
import type { InputEvent } from "../input";
import { sanitizeText } from "../text";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Hit-test the last painted viewport, including ScrollBox clipping and offsets. */
export function createHover() {
  let rectangles: {
    ancestors: HostNode[];
    atomic?: number;
    cursor?: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  }[] = [];
  let hovered = new Set<HostNode>();
  let position: { x: number; y: number } | undefined;
  let pressed: { node: HostNode; atomic?: number; cursor?: number } | undefined;

  function hit(x: number, y: number) {
    return rectangles.findLast(
      (rect) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom,
    );
  }

  function clickTarget(x: number, y: number) {
    const rect = hit(x, y);
    const node = rect?.ancestors.find(
      (node) =>
        node.props.onClick ||
        (rect.atomic !== undefined && node.props.onAtomicRangeClick) ||
        (rect.cursor !== undefined && node.props.onCursorClick),
    );
    return node
      ? {
          node,
          atomic: node.props.onAtomicRangeClick ? rect?.atomic : undefined,
          cursor: node.props.onCursorClick ? rect?.cursor : undefined,
        }
      : undefined;
  }

  function dispatch(next: Set<HostNode>) {
    const previous = hovered;
    hovered = next;
    for (const node of previous) {
      if (!next.has(node)) node.props.onMouseLeave?.();
    }
    for (const node of next) {
      if (!previous.has(node)) if (position) node.props.onMouseEnter?.(position);
    }
  }

  return {
    record(root: LayoutNode, columns: number, rows: number) {
      rectangles = [];
      const offset = Math.max(0, root.height - rows);
      function visit(
        node: LayoutNode,
        clip: { left: number; top: number; right: number; bottom: number },
        ancestors: HostNode[],
      ) {
        const chain =
          node.props.onMouseEnter ||
          node.props.onMouseLeave ||
          (node.type !== "tui-text" && node.props.onClick) ||
          node.props.onWheel
            ? [node.source, ...ancestors]
            : ancestors;
        const rectangle = {
          ancestors: chain,
          left: Math.max(clip.left, node.x),
          top: Math.max(clip.top, node.y - offset),
          right: Math.min(clip.right, node.x + node.width),
          bottom: Math.min(clip.bottom, node.y - offset + node.height),
        };
        if (rectangle.left >= rectangle.right || rectangle.top >= rectangle.bottom) return;
        rectangles.push(rectangle);
        if (
          node.type === "tui-text" &&
          (node.props.onClick || node.props.onAtomicRangeClick || node.props.onCursorClick)
        ) {
          const text = node.spans.map((span) => span.text).join("");
          const sanitized = sanitizeText(text);
          // Painting strips control bytes; translate its offsets back to editor offsets.
          const offsets = new Map<number, number>();
          let sanitizedOffset = 0;
          if (node.props.onCursorClick)
            for (const { segment, index } of segmenter.segment(text)) {
              offsets.set(sanitizedOffset, index);
              sanitizedOffset += sanitizeText(segment).length;
            }
          // Glyph offsets are sanitized; callbacks retain the original UTF-16 range start.
          const atomicStarts = new Map(
            node.props.onAtomicRangeClick
              ? node.props.atomicRanges?.map(({ start }) => [
                  sanitizeText(text.slice(0, start)).length,
                  start,
                ])
              : [],
          );
          offsets.set(sanitizedOffset, text.length);
          let nextLineOffset = 0;
          for (const [row, line] of (node.lines ?? []).entries()) {
            let column = 0;
            const top = node.y - offset + row - (node.textTop ?? 0);
            const last = line.at(-1);
            const end = last ? last.offset + last.text.length : nextLineOffset;
            nextLineOffset = end + (sanitized[end] === "\n" ? 1 : 0);
            if (node.props.onCursorClick && top >= rectangle.top && top < rectangle.bottom)
              rectangles.push({
                ...rectangle,
                top,
                bottom: top + 1,
                ancestors: [node.source, ...chain],
                cursor: offsets.get(end) ?? text.length,
              });
            for (const glyph of line) {
              const atomic =
                glyph.atomic === undefined ? undefined : atomicStarts.get(glyph.atomic);
              // The painter omits an entire glyph when any of its cells cross the clip.
              const left = node.x + column;
              const right = left + glyph.width;
              if (
                (glyph.text.trim() || atomic !== undefined || node.props.onCursorClick) &&
                glyph.width > 0 &&
                left >= rectangle.left &&
                right <= rectangle.right &&
                top >= rectangle.top &&
                top < rectangle.bottom
              )
                rectangles.push({
                  left,
                  right,
                  top,
                  bottom: top + 1,
                  ancestors: [node.source, ...chain],
                  atomic,
                  cursor: node.props.onCursorClick ? offsets.get(glyph.offset) : undefined,
                });
              column += glyph.width;
            }
          }
        }
        if (node.type === "tui-text") return;
        for (const child of node.children)
          visit(child, node.type === "tui-scroll" ? rectangle : clip, chain);
      }
      visit(root, { left: 0, top: 0, right: columns, bottom: rows }, []);
    },
    move(x: number, y: number) {
      if (!rectangles.length) return;
      if (position?.x === x && position.y === y) return;
      position = { x, y };
      dispatch(new Set(hit(x, y)?.ancestors));
    },
    wheel(event: Extract<InputEvent, { type: "wheel" }>) {
      hit(event.x, event.y)
        ?.ancestors.find((node) => node.props.onWheel)
        ?.props.onWheel?.(event);
    },
    press(x: number, y: number, button: number) {
      pressed = button === 0 ? clickTarget(x, y) : undefined;
    },
    release(x: number, y: number, button: number) {
      const target = pressed;
      pressed = undefined;
      const released = clickTarget(x, y);
      if (
        button !== 0 ||
        !target ||
        target.node !== released?.node ||
        target.atomic !== released.atomic ||
        (target.atomic === undefined && target.cursor !== released.cursor)
      )
        return;
      if (target.atomic !== undefined) target.node.props.onAtomicRangeClick?.(target.atomic);
      else if (target.cursor !== undefined) target.node.props.onCursorClick?.(target.cursor);
      else target.node.props.onClick?.();
    },
    cancelPress() {
      pressed = undefined;
    },
    clear() {
      rectangles = [];
      position = undefined;
      pressed = undefined;
      dispatch(new Set());
    },
  };
}
