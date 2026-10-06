import {
  createElement,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type Ref,
} from "react";
import { useTerminal } from "../terminal";
import {
  createScrollState,
  type ScrollHandle,
  type ScrollSnapshot,
  type ScrollAnchor,
} from "../scroll";
import type { BoxProps } from ".";

export interface ScrollBoxProps extends BoxProps {
  ref?: Ref<ScrollHandle>;
  onScroll?(snapshot: ScrollSnapshot): void;
  initialFollow?: boolean;
  /** Restore a reading position before the first painted frame. */
  initialTop?: number;
  /** Mount-time policy: false keeps a reader's top anchored when fitting content or bottom reading later grows. */
  followOnReachBottom?: boolean;
  /** Restore captured content; unmatched IDs/paths fall back to initialTop. */
  initialAnchor?: ScrollAnchor;
}

/** An independently clipped column; content is measured outside the viewport's flex layout. */
export function ScrollBox({
  ref,
  onScroll,
  initialFollow = true,
  initialTop = 0,
  followOnReachBottom = true,
  initialAnchor,
  ...props
}: ScrollBoxProps) {
  const terminal = useTerminal();
  const scroll = useMemo(
    () => createScrollState(initialFollow, initialTop, initialAnchor, followOnReachBottom),
    [],
  );
  const snapshot = useSyncExternalStore(scroll.subscribe, scroll.getSnapshot);
  useImperativeHandle(ref, () => scroll, [scroll]);
  useLayoutEffect(() => scroll.connect(terminal.redraw), [scroll, terminal]);
  useEffect(() => {
    onScroll?.(snapshot);
  }, [snapshot, onScroll]);
  return createElement("tui-scroll", { flexGrow: 1, flexShrink: 1, ...props, scroll });
}
