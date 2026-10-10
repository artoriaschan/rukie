import { motion, useReducedMotion } from "motion/react";
import { forwardRef, useState } from "react";
import { EASE_IN_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./base";

export interface MetallicButtonProps extends Omit<ButtonProps, "ripple" | "variant"> {
  /** Stops the traveling reflection while preserving the chrome rim. */
  paused?: boolean;
}

// The rim and highlight drift separately so the material stays quiet and reflective.
const SILVER_DRIFT = {
  duration: 8,
  ease: EASE_IN_OUT,
  repeat: Infinity,
};

const CHROME_SHIMMER = {
  duration: 2.4,
  ease: EASE_IN_OUT,
};

export const MetallicButton = forwardRef<HTMLButtonElement, MetallicButtonProps>(
  function MetallicButton(
    { size = "md", paused = false, className, children, onHoverStart, onHoverEnd, ...rest },
    ref,
  ) {
    const reduce = useReducedMotion();
    const still = paused || Boolean(reduce);
    const [hovered, setHovered] = useState(false);

    return (
      <Button
        ref={ref}
        variant="ghost"
        size={size}
        onHoverStart={(event, info) => {
          setHovered(true);
          onHoverStart?.(event, info);
        }}
        onHoverEnd={(event, info) => {
          setHovered(false);
          onHoverEnd?.(event, info);
        }}
        className={cn(
          "group relative isolate overflow-hidden border-0 bg-transparent text-foreground",
          "hover:bg-transparent hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "shadow-[0_8px_22px_rgba(0,0,0,0.16)]",
          size === "icon" && "rounded-full",
          className,
        )}
        {...rest}
      >
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-[-18%] z-0 w-[136%] rounded-[inherit] bg-[linear-gradient(105deg,var(--background)_0%,var(--muted-foreground)_14%,var(--foreground)_26%,var(--border-strong)_38%,var(--background)_50%,var(--muted-foreground)_64%,var(--foreground)_75%,var(--border-strong)_87%,var(--background)_100%)]"
          animate={still ? undefined : { x: ["0%", "13%", "0%"] }}
          transition={still ? undefined : SILVER_DRIFT}
        />

        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-[-58%] z-[1] w-[52%] -skew-x-12 bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--foreground)_50%,transparent)_48%,transparent)] opacity-50 blur-[3px] mix-blend-screen"
          animate={still ? undefined : { x: hovered ? "310%" : "0%" }}
          transition={still ? undefined : CHROME_SHIMMER}
        />

        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[2px] z-[2] rounded-[inherit] bg-background transition-colors group-hover:bg-muted/40"
        />

        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[2px] z-[3] rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(0,0,0,0.16)]"
        />

        <span className="relative z-10 inline-flex items-center justify-center gap-2">
          {children}
        </span>
      </Button>
    );
  },
);
