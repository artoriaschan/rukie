// Adapted from dsh-TUI: src/ink/components/ClockContext.tsx and
// src/ink/hooks/use-animation-frame.ts (installed @deepseek-harness-tui/dsh-tui).
// https://github.com/ccch1mneyyy/dsh-TUI
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

function createClock() {
  const subscribers = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let startedAt: number | undefined;
  let tickTime = 0;
  return {
    now() {
      startedAt ??= Date.now();
      return timer === undefined ? Date.now() - startedAt : tickTime;
    },
    subscribe(onChange: () => void) {
      subscribers.add(onChange);
      if (timer === undefined) {
        startedAt ??= Date.now();
        tickTime = Date.now() - startedAt;
        timer = setInterval(() => {
          tickTime = Date.now() - startedAt!;
          for (const notify of subscribers) notify();
        }, 16);
      }
      return () => {
        subscribers.delete(onChange);
        if (subscribers.size === 0) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
  };
}

const ClockContext = createContext<ReturnType<typeof createClock> | null>(null);

/** One clock per rendered tree; it runs only while an animation is subscribed. */
export function ClockProvider({ children }: { children?: ReactNode }) {
  const [clock] = useState(createClock);
  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}

/** Elapsed milliseconds shared by animations; null freezes time and releases the subscription. */
export function useAnimationFrame(intervalMs: number | null) {
  const clock = useContext(ClockContext);
  if (!clock) throw new Error("useAnimationFrame must be used inside ClockProvider or render()");
  // Reserved for a host element; inline rendering does not need viewport detection.
  const ref = useRef<unknown>(null);
  const [time, setTime] = useState(() => clock.now());
  useEffect(() => {
    if (intervalMs === null) return;
    let lastUpdate = clock.now();
    return clock.subscribe(() => {
      const now = clock.now();
      if (now - lastUpdate >= intervalMs) {
        lastUpdate = now;
        setTime(now);
      }
    });
  }, [clock, intervalMs]);
  return [ref, time] as const;
}
