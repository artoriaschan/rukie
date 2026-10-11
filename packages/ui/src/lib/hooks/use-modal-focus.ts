import { useEffect, type RefObject } from "react";
/** A modal owns focus while mounted, then restores the element that opened it. */
export function useModalFocus(open: boolean, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ) ?? [],
      ).filter((element) => !element.closest("[inert]"));
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = focusables();
      const first = elements[0],
        last = elements.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || !ref.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !ref.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target))
        focusables()[0]?.focus();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("focusin", focus);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("focusin", focus);
      previous?.focus();
    };
  }, [open, ref]);
}
