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
import { createScrollState, type ScrollHandle, type ScrollSnapshot } from "../scroll";
import type { BoxProps } from ".";

export interface ScrollBoxProps extends BoxProps {
  ref?: Ref<ScrollHandle>;
  onScroll?(snapshot: ScrollSnapshot): void;
  initialFollow?: boolean;
  /** Restore a reading position before the first painted frame. */
  initialTop?: number;
}

/** An independently clipped column; content is measured outside the viewport's flex layout. */
export function ScrollBox({
  ref,
  onScroll,
  initialFollow = true,
  initialTop = 0,
  ...props
}: ScrollBoxProps) {
  const terminal = useTerminal();
  const scroll = useMemo(() => createScrollState(initialFollow, initialTop), []);
  const snapshot = useSyncExternalStore(scroll.subscribe, scroll.getSnapshot);
  useImperativeHandle(ref, () => scroll, [scroll]);
  useLayoutEffect(() => scroll.connect(terminal.redraw), [scroll, terminal]);
  useEffect(() => {
    onScroll?.(snapshot);
  }, [snapshot, onScroll]);
  return createElement("tui-scroll", { flexGrow: 1, flexShrink: 1, ...props, scroll });
}
