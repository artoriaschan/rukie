import { motion, useReducedMotion } from "motion/react";
import type { ComponentProps, ReactNode, Ref } from "react";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

/** Presentation only: the unanimated parent owns measurement and positioning. */
export function TooltipSurface({
  children,
  side: _side = "top",
  className,
  ref,
  ready = true,
  style,
  ...props
}: Omit<ComponentProps<typeof motion.span>, "children"> & {
  children?: ReactNode;
  /** Start the entrance only after the positioning layer has been measured. */
  ready?: boolean;
  side?: "top" | "right" | "bottom" | "left";
  ref?: Ref<HTMLSpanElement>;
}) {
  const reduce = useReducedMotion();
  const closed = { opacity: 0, scale: reduce ? 1 : 0.98 };
  return (
    <motion.span
      ref={ref}
      role="tooltip"
      initial={closed}
      animate={{
        ...(ready ? { opacity: 1, scale: 1 } : closed),
        transition: { duration: reduce ? 0 : 0.16, ease: EASE_OUT },
      }}
      exit={{ ...closed, transition: { duration: reduce ? 0 : 0.12, ease: EASE_OUT } }}
      style={{ transformOrigin: "var(--tooltip-origin, center)", ...style }}
      className={cn(
        "block break-words whitespace-normal rounded-lg border border-border bg-tooltip p-2 text-ui-sm font-normal text-tooltip-foreground shadow-(--shadow-overlay)",
        className,
      )}
      {...props}
    >
      {children}
    </motion.span>
  );
}
