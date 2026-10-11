import { OVERLAY_LAYER } from "@/lib/overlay";
import { useComponentText } from "@/lib/i18n";
// beui.dev/components/motion/morphing-modal

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";
import { EASE_OUT } from "@/lib/ease";
import { PresenceGate } from "@/lib/presence-gate";
import { useModalFocus } from "@/lib/hooks/use-modal-focus";
import { cn } from "@/lib/utils";

export interface MorphingModalProps {
  /** Which view is currently shown. `null` closes the modal. */
  viewId: string | null;
  onClose: () => void;
  children: ReactNode;
  /** "bottom" anchors to the viewport bottom (mobile-like). "center" centers vertically. */
  placement?: "bottom" | "center";
  className?: string;
  label?: string;
}

export function MorphingModal({
  viewId,
  onClose,
  children,
  placement = "bottom",
  className,
  label,
}: MorphingModalProps) {
  const componentText = useComponentText();

  const open = viewId !== null;
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(open, panel);
  const reduce = useReducedMotion();
  const enterY = reduce ? 0 : placement === "bottom" ? 4 : 4;
  const enterScale = reduce ? 1 : 0.98;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Mounted only while open, and while open the chrome is two fixed siblings
  // rather than one wrapper: the backdrop spans the viewport edges but carries
  // the scrim colour, and the layer positioning the panel sits inset off every
  // edge (`inset-4`, with the bottom placement's `pb-4` on top of it). Both hang
  // off `PresenceGate`, so interaction releases in the same commit that starts
  // the exit rather than when it ends — `open` is already false for those
  // frames.
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <PresenceGate key="backdrop">
          {({ gate }) => (
            <motion.button
              type="button"
              aria-label={componentText("component.close-modal")}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.16, ease: EASE_OUT }}
              {...gate}
              onClick={onClose}
              className={cn(
                OVERLAY_LAYER.modal,
                "pointer-events-auto fixed inset-0 bg-foreground/20",
              )}
            />
          )}
        </PresenceGate>
      ) : null}

      {open ? (
        <PresenceGate key="panel-layer">
          {({ isPresent, gate }) => (
            // The layer itself never takes pointer events, so it carries
            // `inert` alone rather than the gate's pointer-events value.
            <div
              inert={!isPresent}
              className={cn(
                OVERLAY_LAYER.modal,
                "pointer-events-none fixed inset-4 flex justify-center",
                placement === "bottom" ? "items-end pb-4" : "items-center",
              )}
            >
              <motion.div
                key="panel"
                ref={panel}
                role="dialog"
                aria-modal="true"
                aria-label={label ?? componentText("component.close-modal")}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onClose();
                  }
                }}
                layout
                initial={{ opacity: 0, y: enterY, scale: enterScale }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  y: enterY,
                  scale: reduce ? 1 : 0.98,
                  transition: { duration: 0.12, ease: EASE_OUT },
                }}
                transition={{ duration: reduce ? 0 : 0.16, ease: EASE_OUT }}
                {...gate}
                className={cn(
                  "pointer-events-auto relative w-full max-w-[480px] max-h-[calc(100dvh-32px)] flex flex-col overflow-hidden rounded-2xl border border-popover-border bg-popover shadow-md will-change-transform",
                  className,
                )}
              >
                <motion.div layout="position" className="flex min-h-0 flex-col p-4">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                      key={viewId}
                      className="flex min-h-0 flex-col"
                      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
                      animate={
                        reduce
                          ? {
                              opacity: 1,
                              transition: {
                                duration: 0.12,
                                ease: EASE_OUT,
                              },
                            }
                          : {
                              opacity: 1,
                              y: 0,

                              transition: {
                                duration: 0.16,
                                ease: EASE_OUT,
                              },
                            }
                      }
                      exit={
                        reduce
                          ? {
                              opacity: 0,
                              transition: {
                                duration: 0.14,
                                ease: EASE_OUT,
                              },
                            }
                          : {
                              opacity: 0,
                              y: -4,
                              transition: {
                                duration: 0.16,
                                ease: EASE_OUT,
                              },
                            }
                      }
                    >
                      {children}
                    </motion.div>
                  </AnimatePresence>
                </motion.div>
              </motion.div>
            </div>
          )}
        </PresenceGate>
      ) : null}
    </AnimatePresence>
  );
}
