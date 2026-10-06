/** Stable content identity and text position captured by a ScrollBox layout. */
export interface ScrollAnchor {
  id: string;
  path: readonly number[];
  offset: number;
  inset: number;
}

export interface ScrollSnapshot {
  top: number;
  total: number;
  height: number;
  x: number;
  y: number;
  width: number;
  following: boolean;
  anchor?: ScrollAnchor;
}

export interface ScrollHandle {
  scrollBy(lines: number): void;
  scrollToBottom(): void;
  getSnapshot(): ScrollSnapshot;
}

function sameAnchor(first?: ScrollAnchor, second?: ScrollAnchor) {
  return (
    first === second ||
    (!!first &&
      !!second &&
      first.id === second.id &&
      first.offset === second.offset &&
      first.inset === second.inset &&
      first.path.length === second.path.length &&
      first.path.every((value, index) => value === second.path[index]))
  );
}

/** Viewport state shared by a ScrollBox and the layout pass. */
export function createScrollState(
  initialFollow = true,
  initialTop = 0,
  initialAnchor?: ScrollAnchor,
) {
  let snapshot: ScrollSnapshot = {
    top: Math.max(0, initialTop),
    total: 0,
    height: 0,
    x: 0,
    y: 0,
    width: 0,
    following: initialFollow,
  };
  let pendingAnchor = initialAnchor;
  const listeners = new Set<() => void>();
  let redraw = () => {};
  let scheduled = false;
  const publish = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      listeners.forEach((listener) => listener());
    });
  };
  const set = (next: ScrollSnapshot) => {
    if (
      Object.keys(next).every((key) =>
        key === "anchor"
          ? sameAnchor(next.anchor, snapshot.anchor)
          : next[key as keyof ScrollSnapshot] === snapshot[key as keyof ScrollSnapshot],
      )
    )
      return;
    snapshot = next;
    publish();
  };
  const handle: ScrollHandle = {
    getSnapshot: () => snapshot,
    scrollBy(lines) {
      const max = Math.max(0, snapshot.total - snapshot.height);
      const top = Math.max(0, Math.min(max, snapshot.top + lines));
      set({ ...snapshot, top, following: top === max });
      redraw();
    },
    scrollToBottom() {
      set({ ...snapshot, top: Math.max(0, snapshot.total - snapshot.height), following: true });
      redraw();
    },
  };
  return {
    ...handle,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect(paint: () => void) {
      redraw = paint;
      return () => {
        redraw = () => {};
      };
    },
    takeInitialAnchor() {
      const anchor = pendingAnchor;
      pendingAnchor = undefined;
      return anchor;
    },
    setAnchor(anchor?: ScrollAnchor) {
      set({ ...snapshot, anchor });
    },
    layout(viewport: Omit<ScrollSnapshot, "top" | "following" | "anchor">, anchoredTop?: number) {
      const max = Math.max(0, viewport.total - viewport.height);
      const top = snapshot.following
        ? max
        : Math.max(0, Math.min(max, anchoredTop ?? snapshot.top));
      set({
        ...viewport,
        top,
        following: snapshot.following || top === max,
        anchor: snapshot.anchor,
      });
      return top;
    },
  };
}

export type ScrollState = ReturnType<typeof createScrollState>;
