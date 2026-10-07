import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const FRAME_MS = 1000 / 30;
type Cursor = {
  key: string;
  total: number;
  shown: number;
  listeners: Set<() => void>;
  memory: Set<string>;
};
const active = new Set<Cursor>();
const RevealMemory = createContext<Set<string> | null>(null);
/** Reveal identity belongs to the displayed Session, not a process-global tool-call ID. */
export function SmoothRevealProvider({ children }: { children: ReactNode }) {
  const [memory] = useState(() => new Set<string>());
  return <RevealMemory value={memory}>{children}</RevealMemory>;
}
let timer: ReturnType<typeof setInterval> | undefined;

function stopIfIdle() {
  if (!active.size && timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}
function complete(cursor: Cursor) {
  cursor.shown = cursor.total;
  active.delete(cursor);
  // Older rows render through the replay path. Bound the cross-mount identity cache.
  const completed = cursor.memory;
  if (!completed.has(cursor.key)) {
    if (completed.size >= 2048) completed.delete(completed.values().next().value!);
    completed.add(cursor.key);
  }
  stopIfIdle();
}
function schedule() {
  if (timer !== undefined || !active.size) return;
  // Unlike the renderer's 16ms paint clock this interval is shared by all cards
  // and advances once per 30fps tick, without quantizing 33ms into 48ms updates.
  timer = setInterval(() => {
    for (const cursor of active) {
      const backlog = Math.max(0, cursor.total - cursor.shown);
      cursor.shown = Math.min(cursor.total, cursor.shown + Math.max(3, Math.ceil(backlog / 8)));
      if (cursor.shown >= cursor.total) complete(cursor);
      for (const notify of cursor.listeners) notify();
    }
    stopIfIdle();
  }, FRAME_MS);
  timer.unref?.();
}

/** Pending call rows only. Snapped/completed identities never restart when a card collapses. */
export function useSmoothReveal(key: string, total: number, enabled: boolean): number {
  const scoped = useContext(RevealMemory);
  const local = useMemo(() => new Set<string>(), []);
  const completed = scoped ?? local;
  const cursor = useMemo<Cursor>(
    () => ({
      key,
      total,
      shown: completed.has(key) ? total : 0,
      listeners: new Set(),
      memory: completed,
    }),
    [key, completed],
  );
  const subscribe = useCallback(
    (notify: () => void) => {
      cursor.listeners.add(notify);
      return () => {
        cursor.listeners.delete(notify);
      };
    },
    [cursor],
  );
  const snapshot = useCallback(
    () => (enabled && !completed.has(key) ? Math.min(cursor.shown, total) : total),
    [cursor, enabled, key, total, completed],
  );
  const shown = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    cursor.total = total;
    if (!enabled || completed.has(key) || total <= cursor.shown) complete(cursor);
    else {
      active.add(cursor);
      schedule();
    }
    return () => {
      active.delete(cursor);
      stopIfIdle();
    };
  }, [cursor, enabled, key, total, completed]);
  return shown;
}
