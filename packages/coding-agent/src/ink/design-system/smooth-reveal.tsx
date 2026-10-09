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
  text?: string;
};
const active = new Set<Cursor>();
const RevealMemory = createContext<Set<string> | null>(null);
const TextReveals = createContext<Map<string, Cursor> | null>(null);
/** Reveal identity belongs to the displayed Session, not a process-global tool-call ID. */
export function SmoothRevealProvider({ children }: { children: ReactNode }) {
  const [memory] = useState(() => new Set<string>());
  const [texts] = useState(() => new Map<string, Cursor>());
  return (
    <RevealMemory value={memory}>
      <TextReveals value={texts}>{children}</TextReveals>
    </RevealMemory>
  );
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
  }, [cursor, enabled, key, total, completed]);
  // Data updates retain the shared interval's phase; only cursor disposal releases it.
  useEffect(
    () => () => {
      active.delete(cursor);
      stopIfIdle();
    },
    [cursor],
  );
  return shown;
}

/** Live text starts a cursor; settlement keeps it chasing. History paints immediately.
 * A non-prefix replacement snaps, and remounting a settled live row retains its cursor.
 */
export function useSmoothText(
  key: string,
  text: string,
  activeText: boolean,
  enabled = true,
): string {
  const scopedMemory = useContext(RevealMemory);
  const scopedTexts = useContext(TextReveals);
  const localMemory = useMemo(() => new Set<string>(), []);
  const localTexts = useMemo(() => new Map<string, Cursor>(), []);
  const memory = scopedMemory ?? localMemory;
  const texts = scopedTexts ?? localTexts;
  const cursor = useMemo(() => {
    const existing = texts.get(key);
    if (existing) return existing;
    const created: Cursor = {
      key,
      total: text.length,
      shown: activeText && !memory.has(key) ? 0 : text.length,
      text,
      listeners: new Set(),
      memory,
    };
    if (texts.size >= 2048) {
      for (const [oldKey, old] of texts) {
        if (!active.has(old) && !old.listeners.size) {
          texts.delete(oldKey);
          break;
        }
      }
    }
    texts.set(key, created);
    return created;
  }, [key, memory, texts]);
  if (cursor.text !== text) {
    // A paint can expose the caught-up cursor before its passive effect records
    // completion. Preserve that state before a prefix update changes the total.
    if (!text.startsWith(cursor.text ?? "") || (cursor.total > 0 && cursor.shown >= cursor.total))
      complete(cursor);
    cursor.text = text;
    cursor.total = text.length;
  }
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
    () => (!enabled || memory.has(key) ? text.length : Math.min(cursor.shown, text.length)),
    [cursor, memory, key, text, enabled],
  );
  const shown = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (!enabled || memory.has(key) || cursor.shown >= cursor.total) complete(cursor);
    else {
      active.add(cursor);
      schedule();
    }
  }, [cursor, key, memory, text, enabled]);
  useEffect(
    () => () => {
      active.delete(cursor);
      stopIfIdle();
    },
    [cursor],
  );
  // A reveal boundary must never feed an unpaired surrogate to Markdown/layout.
  const end =
    shown > 0 && shown < text.length && /[\uD800-\uDBFF]/.test(text[shown - 1]!)
      ? shown - 1
      : shown;
  return text.slice(0, end);
}
