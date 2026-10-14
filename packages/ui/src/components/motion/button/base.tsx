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

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "destructive" | "link";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon";

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
  primary:
    "f01-primary bg-primary text-primary-foreground not-disabled:hover:bg-primary not-disabled:active:bg-primary",
  secondary:
    "bg-secondary text-secondary-foreground not-disabled:hover:bg-secondary/90 not-disabled:active:bg-secondary",
  ghost:
    "text-muted-foreground not-disabled:hover:text-foreground not-disabled:hover:bg-hover not-disabled:active:bg-muted",
  destructive:
    "f01-destructive bg-destructive text-destructive-foreground not-disabled:hover:bg-destructive not-disabled:active:bg-destructive",
  link: "text-foreground underline-offset-4 not-disabled:hover:underline",
  outline:
    "border border-border bg-transparent text-foreground not-disabled:hover:bg-hover not-disabled:hover:border-border-hover not-disabled:active:bg-muted",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  xs: "min-h-6 px-2 py-0 text-ui-sm leading-[1.5] gap-1.5 rounded-md [&>svg]:size-3",
  sm: "min-h-7 px-2 py-0 text-ui-caption leading-[1.5] gap-1.5 rounded-md [&>svg]:size-3.5",
  md: "min-h-[max(32px,calc(var(--ui-font-size)*1.5+8px))] px-2.5 py-0 text-ui-base leading-[1.5] gap-1.5 rounded-lg [&>svg]:size-4",
  lg: "min-h-9 px-3 py-0 text-ui-base leading-[1.5] gap-1.5 rounded-lg [&>svg]:size-4",
  icon: "min-h-8 min-w-8 p-1 text-ui-base leading-[1.5] rounded-lg [&>svg]:size-4",
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
      if (event.currentTarget.disabled) return;
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
      whileTap={rest.disabled || reduce || pressScale === 1 ? undefined : { scale: pressScale }}
      transition={{ duration: reduce ? 0 : 0.12, ease: EASE_OUT }}
      onPointerDown={handlePointerDown}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center font-normal select-none [&_svg]:cursor-inherit [&_span]:cursor-inherit",
        "transition-colors duration-120 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
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
        "inline-flex cursor-pointer items-center justify-center font-normal select-none [&_svg]:cursor-inherit [&_span]:cursor-inherit",
        "transition-colors duration-120 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
