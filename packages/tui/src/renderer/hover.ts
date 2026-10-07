import type { HostNode, LayoutNode } from "../layout";
import type { InputEvent } from "../input";

/** Hit-test the last painted viewport, including ScrollBox clipping and offsets. */
export function createHover() {
  let rectangles: {
    ancestors: HostNode[];
    left: number;
    top: number;
    right: number;
    bottom: number;
  }[] = [];
  let hovered = new Set<HostNode>();
  let position: { x: number; y: number } | undefined;
  let pressed: HostNode | undefined;

  function hit(x: number, y: number) {
    return rectangles.findLast(
      (rect) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom,
    );
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
        if (node.type === "tui-text" && node.props.onClick) {
          for (const [row, line] of (node.lines ?? []).entries()) {
            let column = 0;
            for (const glyph of line) {
              const left = Math.max(rectangle.left, node.x + column);
              const right = Math.min(rectangle.right, node.x + column + glyph.width);
              const top = node.y - offset + row - (node.textTop ?? 0);
              if (
                glyph.text.trim() &&
                left < right &&
                top >= rectangle.top &&
                top < rectangle.bottom
              )
                rectangles.push({
                  left,
                  right,
                  top,
                  bottom: top + 1,
                  ancestors: [node.source, ...chain],
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
      pressed = button === 0 ? hit(x, y)?.ancestors.find((node) => node.props.onClick) : undefined;
    },
    release(x: number, y: number, button: number) {
      const target = pressed;
      pressed = undefined;
      if (
        button === 0 &&
        target &&
        hit(x, y)?.ancestors.find((node) => node.props.onClick) === target
      )
        target.props.onClick?.();
    },
    clear() {
      rectangles = [];
      position = undefined;
      pressed = undefined;
      dispatch(new Set());
    },
  };
}
