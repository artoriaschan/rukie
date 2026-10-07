import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from "react";
import { useApp, textLines, type DOMElement, type ScrollBoxHandle } from "../../ink/index.ts";

/** Product reading facts, including stable source identity independently of renderer lifetime. */
export interface ReadingPosition {
  top: number;
  height: number;
  total: number;
  width: number;
  x: number;
  y: number;
  following: boolean;
  anchor?: { id: string; offset: number; sourceOffset?: number };
  anchors?: readonly { id: string; top: number; height: number }[];
}
export function readPosition(
  handle: ScrollBoxHandle | null | undefined,
  width = 0,
): ReadingPosition | undefined {
  if (!handle) return;
  return {
    top: handle.getScrollTop(),
    height: handle.getViewportHeight(),
    total: handle.getScrollHeight(),
    width,
    x: 0,
    y: handle.getViewportTop(),
    following: handle.isSticky(),
  };
}
export function usePaintedPosition(
  ref: RefObject<ScrollBoxHandle | null>,
  width: number,
  onChange?: (position: ReadingPosition) => void,
) {
  const { renderer } = useApp();
  const callback = useRef(onChange);
  callback.current = onChange;
  useLayoutEffect(() => {
    const update = () => {
      const position = readPosition(ref.current, width);
      if (!position) return;
      callback.current?.(position);
    };
    update();
    const offFrame = renderer?.subscribeFrame(update);
    const offScroll = ref.current?.subscribe(update);
    return () => {
      offFrame?.();
      offScroll?.();
    };
  }, [renderer, ref, width]);
}
export function restorePosition(
  handle: ScrollBoxHandle | null | undefined,
  position?: ReadingPosition,
) {
  if (!handle || !position) return;
  if (position.following) handle.scrollToBottom();
  else handle.scrollTo(position.top);
}
/** Source refs are product identities; native ScrollBox remains the only scroll controller. */
export interface Sources {
  mount(id: string, element: DOMElement | null): void;
  ref(id: string): (element: DOMElement | null) => void;
  elements: Map<string, DOMElement>;
}
export const SourceContext = createContext<Sources | undefined>(undefined);
export function useSources(): Sources {
  const sources = useRef<Sources | undefined>(undefined);
  if (!sources.current) {
    const elements = new Map<string, DOMElement>();
    const callbacks = new Map<string, (element: DOMElement | null) => void>();
    const mount = (id: string, element: DOMElement | null) => {
      if (!id) return;
      if (element) elements.set(id, element);
      else {
        elements.delete(id);
        callbacks.delete(id);
      }
    };
    sources.current = {
      elements,
      mount,
      ref(id) {
        let callback = callbacks.get(id);
        if (!callback) {
          callback = (element) => mount(id, element);
          callbacks.set(id, callback);
        }
        return callback;
      },
    };
  }
  return sources.current;
}
export function useSourceMount() {
  return useContext(SourceContext)?.mount;
}
export function useSourceRef(id?: string) {
  const sources = useContext(SourceContext);
  return id ? sources?.ref(id) : undefined;
}
export function sourceTop(element: DOMElement): number {
  let top = 0;
  let current: DOMElement | undefined = element;
  while (current && current.style.overflowY !== "scroll") {
    top += current.yogaNode?.getComputedTop() ?? 0;
    current = current.parentNode;
  }
  return top;
}
export function sourceLeft(element: DOMElement): number {
  let left = 0;
  let current: DOMElement | undefined = element;
  while (current && current.style.overflowY !== "scroll") {
    left += current.yogaNode?.getComputedLeft() ?? 0;
    current = current.parentNode;
  }
  return left;
}
export function sourcePositions(sources: Sources) {
  return Array.from(sources.elements, ([id, element]) => ({
    id,
    top: sourceTop(element),
    height: element.yogaNode?.getComputedHeight() ?? 0,
  }));
}
/** Wire a product panel's saved reading position and post-paint measurements to its native handle. */
export function usePanelScroll(
  outside: import("react").Ref<ScrollBoxHandle> | undefined,
  initial?: ReadingPosition | number,
  width = 0,
  onPosition?: (position: ReadingPosition) => void,
) {
  const handle = useRef<ScrollBoxHandle | null>(null);
  const saved = useRef(initial);
  saved.current = initial;
  const callback = useRef<((next: ScrollBoxHandle | null) => void) | undefined>(undefined);
  const outsideRef = useRef(outside);
  outsideRef.current = outside;
  if (!callback.current)
    callback.current = (next) => {
      handle.current = next;
      const target = outsideRef.current;
      if (typeof target === "function") target(next);
      else if (target) target.current = next;
      if (next && saved.current !== undefined) {
        if (typeof saved.current === "number") next.scrollTo(saved.current);
        else restorePosition(next, saved.current);
      }
    };
  usePaintedPosition(handle, width, onPosition);
  return callback.current;
}

function sourceText(element: DOMElement): string {
  const parts = element.childNodes.map((child) =>
    child.nodeName === "#text" ? child.nodeValue : sourceText(child),
  );
  return parts.join(element.style.flexDirection === "column" ? "\n" : "");
}
function sourceRows(element: DOMElement) {
  return textLines(
    [{ text: sourceText(element), style: {} }],
    Math.max(1, element.yogaNode?.getComputedWidth() ?? 1),
  );
}
export function captureSourcePosition(
  position: ReadingPosition,
  sources: Sources,
): ReadingPosition {
  const anchors = sourcePositions(sources).sort((a, b) => a.top - b.top);
  const source = anchors.findLast((item) => item.top <= position.top);
  const offset = source ? position.top - source.top : 0;
  const element = source ? sources.elements.get(source.id) : undefined;
  const sourceOffset = element ? sourceRows(element)[offset]?.[0]?.offset : undefined;
  return {
    ...position,
    anchors,
    anchor: source ? { id: source.id, offset, sourceOffset } : undefined,
  };
}
export function restoreSourcePosition(
  handle: ScrollBoxHandle | null,
  sources: Sources,
  position?: ReadingPosition,
): boolean {
  if (!handle || !position) return false;
  if (position.following) {
    handle.scrollToBottom();
    return true;
  }
  const element = position.anchor ? sources.elements.get(position.anchor.id) : undefined;
  if (element && position.anchor) {
    const rows = sourceRows(element);
    const sourceOffset = position.anchor.sourceOffset;
    const offset =
      sourceOffset === undefined
        ? position.anchor.offset
        : Math.max(
            0,
            rows.findLastIndex((row) => (row[0]?.offset ?? Infinity) <= sourceOffset),
          );
    handle.scrollToElement(element, offset);
    return true;
  }
  handle.scrollTo(position.top);
  return true;
}
