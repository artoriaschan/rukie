import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { InputEvent } from "@neant/tui";

export type WindowMove = number | "first" | "last";
interface WindowOwner {
  id: string;
  move(direction: WindowMove): void;
}
interface WindowNavigation {
  active?: string;
  focus(owner: WindowOwner): void;
  clear(id?: string): void;
  handle(event: InputEvent): boolean;
}
const WindowContext = createContext<WindowNavigation | undefined>(undefined);

/** Session-scoped keyboard ownership. Pointer controls opt one card into window navigation. */
export function ToolWindowProvider({ children }: { children: ReactNode }) {
  const owner = useRef<WindowOwner | undefined>(undefined);
  const [active, setActive] = useState<string>();
  const navigation = useMemo<WindowNavigation>(
    () => ({
      active,
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
        if (event.type !== "key") {
          if (
            (event.type === "mouse" && event.action === "press") ||
            (event.type === "move" && event.button === 0) ||
            event.type === "wheel" ||
            event.type === "paste" ||
            (event.type === "focus" && !event.focused)
          ) {
            owner.current = undefined;
            setActive(undefined);
          }
          return false;
        }
        const { key } = event;
        if (key.name === "escape") {
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
        const direction = moves[key.name];
        if (!key.ctrl && !key.alt && !key.shift && direction !== undefined) {
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
