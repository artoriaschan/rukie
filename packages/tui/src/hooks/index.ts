import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { InputEvent } from "../input";
import { useTerminal } from "../terminal";
export { ClockProvider, useAnimationFrame } from "./animation-frame";

export function useInput(handler: (event: InputEvent) => void, { isActive = true } = {}) {
  const terminal = useTerminal();
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  useLayoutEffect(() => {
    if (isActive) return terminal.subscribeInput((event) => latest.current(event));
  }, [terminal, isActive]);
}

export function useTerminalSize() {
  const terminal = useTerminal();
  return useSyncExternalStore(terminal.subscribeSize, terminal.getSize);
}

export function useTerminalGraphics() {
  const terminal = useTerminal();
  return useSyncExternalStore(terminal.subscribeGraphics, terminal.getGraphics);
}
