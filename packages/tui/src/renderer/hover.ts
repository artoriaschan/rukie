import type { HostNode, LayoutNode } from "../layout";

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

  function dispatch(next: Set<HostNode>) {
    const previous = hovered;
    hovered = next;
    for (const node of previous) {
      if (!next.has(node)) node.props.onMouseLeave?.();
    }
    for (const node of next) {
      if (!previous.has(node)) node.props.onMouseEnter?.();
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
          node.props.onMouseEnter || node.props.onMouseLeave
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
        for (const child of node.children)
          visit(child, node.type === "tui-scroll" ? rectangle : clip, chain);
      }
      visit(root, { left: 0, top: 0, right: columns, bottom: rows }, []);
    },
    move(x: number, y: number) {
      if (!rectangles.length) return;
      if (position?.x === x && position.y === y) return;
      position = { x, y };
      const hit = rectangles.findLast(
        (rect) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom,
      );
      dispatch(new Set(hit?.ancestors));
    },
    clear() {
      rectangles = [];
      position = undefined;
      dispatch(new Set());
    },
  };
}
