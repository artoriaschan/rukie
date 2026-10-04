export interface ScrollSnapshot {
  top: number;
  total: number;
  height: number;
  x: number;
  y: number;
  width: number;
  following: boolean;
}

export interface ScrollHandle {
  scrollBy(lines: number): void;
  scrollToBottom(): void;
  getSnapshot(): ScrollSnapshot;
}

/** Viewport state shared by a ScrollBox and the layout pass. */
export function createScrollState(initialFollow = true, initialTop = 0) {
  let snapshot: ScrollSnapshot = {
    top: Math.max(0, initialTop),
    total: 0,
    height: 0,
    x: 0,
    y: 0,
    width: 0,
    following: initialFollow,
  };
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
      Object.keys(next).every(
        (key) => next[key as keyof ScrollSnapshot] === snapshot[key as keyof ScrollSnapshot],
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
    layout(viewport: Omit<ScrollSnapshot, "top" | "following">, anchoredTop?: number) {
      const max = Math.max(0, viewport.total - viewport.height);
      const top = snapshot.following
        ? max
        : Math.max(0, Math.min(max, anchoredTop ?? snapshot.top));
      set({ ...viewport, top, following: snapshot.following || top === max });
      return top;
    },
  };
}

export type ScrollState = ReturnType<typeof createScrollState>;
