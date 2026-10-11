import { OVERLAY_LAYER } from "@/lib/overlay";
import { useComponentText } from "@/lib/i18n";
// beui.dev/components/motion/drawer

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { EASE_OUT } from "@/lib/ease";
import { PresenceGate } from "@/lib/presence-gate";
import { cn } from "@/lib/utils";

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "left" | "right";
  children: ReactNode;
  /** Class for the panel surface. */
  className?: string;
  /** Class for the backdrop. */
  backdropClassName?: string;
  ariaLabel?: string;
  /** Close when the backdrop is clicked. Default true. */
  dismissable?: boolean;
}

export function Drawer({
  open,
  onOpenChange,
  side = "right",
  children,
  className,
  backdropClassName,
  ariaLabel,
  dismissable = true,
}: DrawerProps) {
  const componentText = useComponentText();

  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onOpenChange]);

  const offscreen = side === "right" ? 4 : -4;

  // Two fixed siblings, no wrapper: the backdrop spans the viewport edges but
  // paints the scrim, and the panel is inset off one side and paints its own
  // surface, so neither is a transparent edge-spanning layer. Both hang off
  // `PresenceGate`, so interaction releases in the same commit that starts the
  // exit rather than when it ends.
  return (
    <AnimatePresence>
      {open ? (
        <PresenceGate key="backdrop">
          {({ gate }) => (
            <motion.button
              type="button"
              aria-label={componentText("component.close")}
              tabIndex={dismissable ? 0 : -1}
              onClick={() => dismissable && onOpenChange(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.16, ease: EASE_OUT }}
              {...gate}
              className={cn(
                OVERLAY_LAYER.modal,
                "fixed inset-0 h-full w-full cursor-default bg-foreground/20",
                backdropClassName,
              )}
            />
          )}
        </PresenceGate>
      ) : null}
      {open ? (
        <PresenceGate key="panel">
          {({ gate }) => (
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel}
              initial={reduce ? { opacity: 0 } : { x: offscreen, opacity: 0 }}
              animate={reduce ? { opacity: 1 } : { x: 0, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { x: offscreen, opacity: 0 }}
              transition={
                reduce ? { duration: 0, ease: EASE_OUT } : { duration: 0.16, ease: EASE_OUT }
              }
              {...gate}
              className={cn(
                OVERLAY_LAYER.modal,
                "fixed inset-y-0 flex w-80 max-w-[calc(100vw-32px)] flex-col overflow-y-auto bg-popover shadow-md",
                side === "right"
                  ? "right-0 border-l border-border"
                  : "left-0 border-r border-border",
                className,
              )}
            >
              {children}
            </motion.aside>
          )}
        </PresenceGate>
      ) : null}
    </AnimatePresence>
  );
}
