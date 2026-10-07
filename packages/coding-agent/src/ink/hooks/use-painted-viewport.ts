import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { DOMElement } from "../dom.js";

import useApp from "./use-app.js";
import { useTerminalSize } from "./use-terminal-size.js";

/** Reactive painted visibility, initially false; includes enclosing scroll/hidden clips. */
function bounds(node: DOMElement) {
  let x = node.yogaNode?.getComputedLeft() ?? 0;
  let y = node.yogaNode?.getComputedTop() ?? 0;
  let parent = node.parentNode;
  while (parent) {
    x += parent.yogaNode?.getComputedLeft() ?? 0;
    y += (parent.yogaNode?.getComputedTop() ?? 0) - (parent.scrollTop ?? 0);
    parent = parent.parentNode;
  }
  return { x, y, width: node.yogaNode?.getComputedWidth() ?? 0, height: node.yogaNode?.getComputedHeight() ?? 0 };
}

export function usePaintedViewport(): [(element: DOMElement | null) => void, boolean] {
  const { renderer } = useApp();
  const { columns, rows } = useTerminalSize();
  const element = useRef<DOMElement | null>(null);
  const [visible, setVisible] = useState(false);
  const observed = useRef(false);
  const ref = useCallback((next: DOMElement | null) => { element.current = next; }, []);
  useLayoutEffect(() => {
    const observe = () => {
      const node = element.current;
      const rect = node?.yogaNode && bounds(node);
      if (!node || !rect) { if (observed.current) { observed.current = false; setVisible(false); } return; }
      let left = Math.max(0, rect.x), top = Math.max(0, rect.y);
      let right = Math.min(columns, rect.x + rect.width), bottom = Math.min(rows, rect.y + rect.height);
      let parent = node.parentNode;
      while (parent) {
        const clip = parent.yogaNode && bounds(parent);
        if (clip) {
          const x = parent.style.overflowX ?? parent.style.overflow;
          const y = parent.style.overflowY ?? parent.style.overflow;
          if (x === "hidden" || x === "scroll") { left = Math.max(left, clip.x); right = Math.min(right, clip.x + clip.width); }
          if (y === "hidden" || y === "scroll") { top = Math.max(top, clip.y); bottom = Math.min(bottom, clip.y + clip.height); }
        }
        parent = parent.parentNode;
      }
      const next = !node.isHidden && right > left && bottom > top;
      if (observed.current !== next) { observed.current = next; setVisible(next); }
    };
    observe();
    return renderer?.subscribeFrame(observe);
  }, [renderer, columns, rows]);
  return [ref, visible];
}
