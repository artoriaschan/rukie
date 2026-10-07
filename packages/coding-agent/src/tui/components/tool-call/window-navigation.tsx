import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { InputEvent } from "../../../ink/index.ts";

export type WindowMove = number | "first" | "last";
interface WindowOwner {
  id: string;
  move(direction: WindowMove): void;
}
interface WindowPresentation {
  expanded: boolean;
  offset: number;
}
interface WindowNavigation {
  active?: string;
  focus(owner: WindowOwner): void;
  clear(id?: string): void;
  handle(event: InputEvent): boolean;
  /** A parent Interaction temporarily unmounts the scene; retain only that round trip. */
  beginSuspend(): void;
  preserveOnUnmount(id: string, state: WindowPresentation): void;
  takePreserved(id: string): WindowPresentation | undefined;
  finishRestore(): void;
}
const WindowContext = createContext<WindowNavigation | undefined>(undefined);

/** Session-scoped keyboard ownership. Pointer controls opt one card into window navigation. */
export function ToolWindowProvider({ children }: { children: ReactNode }) {
  const owner = useRef<WindowOwner | undefined>(undefined);
  const [active, setActive] = useState<string>();
  const suspended = useRef(false);
  const preserved = useRef(new Map<string, WindowPresentation>());
  const navigation = useMemo<WindowNavigation>(
    () => ({
      active,
      beginSuspend() {
        suspended.current = true;
        preserved.current.clear();
      },
      preserveOnUnmount(id, state) {
        if (suspended.current) preserved.current.set(id, state);
      },
      takePreserved(id) {
        const state = preserved.current.get(id);
        preserved.current.delete(id);
        return state;
      },
      finishRestore() {
        suspended.current = false;
        preserved.current.clear();
      },
      focus(next) {
        owner.current = next;
        setActive(next.id);
      },
      clear(id) {
        if (id && owner.current?.id !== id) return;
        owner.current = undefined;
        setActive(undefined);
      },
      handle(event) {
        if (!owner.current) return false;
        if (event.isPasted) {
          owner.current = undefined;
          setActive(undefined);
          return false;
        }
        const { key } = event;
        if (event.keypress.name === "escape") {
          owner.current = undefined;
          setActive(undefined);
          return true;
        }
        const moves: Record<string, WindowMove> = {
          pageup: -400,
          pagedown: 400,
          up: -1,
          down: 1,
          home: "first",
          end: "last",
        };
        const direction = moves[event.keypress.name ?? ""];
        if (!key.ctrl && !key.meta && !key.shift && direction !== undefined) {
          owner.current.move(direction);
          return true;
        }
        owner.current = undefined;
        setActive(undefined);
        return false;
      },
    }),
    [active],
  );
  return <WindowContext.Provider value={navigation}>{children}</WindowContext.Provider>;
}
export function useToolWindowNavigation() {
  return useContext(WindowContext);
}
