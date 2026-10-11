import { AnimatePresence, type HTMLMotionProps, motion, useReducedMotion } from "motion/react";
import {
  forwardRef,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressScale?: number;
  /** Spawn a Material-style ripple from the press point. Off by default. */
  ripple?: boolean;
  children?: ReactNode;
}

export interface ButtonLinkProps extends Omit<HTMLMotionProps<"a">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressScale?: number;
  children?: ReactNode;
}

type Ripple = { id: number; x: number; y: number; size: number };

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border border-border bg-card text-foreground hover:border-border",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-muted/60",
  outline: "border border-border bg-transparent text-foreground hover:bg-muted/60",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "min-h-7 px-2 py-1 text-ui-base gap-1 rounded-lg",
  md: "min-h-8 px-3 py-1 text-ui-base gap-2 rounded-lg",
  lg: "min-h-9 px-4 py-2 text-ui-base gap-2 rounded-lg",
  icon: "min-h-8 min-w-8 p-1 text-ui-base rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    pressScale = 1,
    ripple = false,
    className,
    children,
    onPointerDown,
    ...rest
  },
  ref,
) {
  const reduce = useReducedMotion();
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextId = useRef(0);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (ripple && !reduce) {
        const rect = event.currentTarget.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2;
        const id = nextId.current++;
        setRipples((prev) => [
          ...prev,
          {
            id,
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            size,
          },
        ]);
      }
      onPointerDown?.(event);
    },
    [ripple, reduce, onPointerDown],
  );

  return (
    <motion.button
      ref={ref}
      type="button"
      whileTap={reduce || pressScale === 1 ? undefined : { scale: pressScale }}
      transition={{ duration: reduce ? 0 : 0.12, ease: EASE_OUT }}
      onPointerDown={handlePointerDown}
      className={cn(
        "inline-flex items-center justify-center font-normal select-none",
        "transition-colors duration-120",
        "disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground",
        ripple && "relative overflow-hidden",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {ripple && !reduce ? (
        <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <AnimatePresence>
            {ripples.map((r) => (
              <motion.span
                key={r.id}
                className="absolute rounded-full bg-current"
                style={{
                  left: r.x,
                  top: r.y,
                  width: r.size,
                  height: r.size,
                  x: "-50%",
                  y: "-50%",
                }}
                initial={{ scale: 0.05, opacity: 0.3 }}
                animate={{ scale: 1, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: EASE_OUT }}
                onAnimationComplete={() => setRipples((prev) => prev.filter((x) => x.id !== r.id))}
              />
            ))}
          </AnimatePresence>
        </span>
      ) : null}
      {children}
    </motion.button>
  );
});

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = "primary", size = "md", pressScale = 1, className, children, ...rest },
  ref,
) {
  const reduce = useReducedMotion();

  return (
    <motion.a
      ref={ref}
      whileTap={reduce || pressScale === 1 ? undefined : { scale: pressScale }}
      transition={{ duration: reduce ? 0 : 0.12, ease: EASE_OUT }}
      className={cn(
        "inline-flex items-center justify-center font-normal select-none",
        "transition-colors duration-120",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {children}
    </motion.a>
  );
});
