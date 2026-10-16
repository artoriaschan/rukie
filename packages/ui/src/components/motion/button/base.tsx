import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "destructive" | "link";
export type ButtonSize =
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "standard"
  | "compact"
  | "contextual"
  | "micro"
  | "icon";

export interface ButtonProps extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
  focus?: "default" | "inset";
  /** Goal confirmation preserves its named 8px action corners. */
  geometry?: "default" | "goal";
}

export interface ButtonLinkProps extends Omit<ComponentPropsWithoutRef<"a">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
  focus?: "default" | "inset";
  /** Goal confirmation preserves its named 8px action corners. */
  geometry?: "default" | "goal";
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "f01-primary bg-primary text-primary-foreground not-disabled:hover:bg-primary",
  secondary: "bg-secondary text-secondary-foreground not-disabled:hover:bg-secondary/90",
  ghost: "text-muted-foreground not-disabled:hover:text-foreground not-disabled:hover:bg-hover",
  destructive:
    "f01-destructive bg-destructive text-destructive-foreground not-disabled:hover:bg-destructive",
  link: "text-foreground underline-offset-4 not-disabled:hover:underline",
  outline:
    "border border-border bg-transparent text-foreground not-disabled:hover:bg-hover not-disabled:hover:border-border-hover",
};

const STANDARD =
  "min-h-[max(36px,calc(var(--ui-font-size)*1.428571+8px))] px-4 py-1 text-ui-base gap-1.5 rounded-xl [&_svg]:size-3";
const COMPACT =
  "min-h-[max(32px,calc(var(--ui-font-size)*1.142857+8px))] px-3 py-1 text-ui-sm gap-1.5 rounded-xl [&_svg]:size-3";
const CONTEXTUAL =
  "min-h-[max(28px,calc(var(--ui-font-size)*1.285714+8px))] px-2 py-0 text-ui-caption gap-1.5 rounded-lg [&_svg]:size-3";
const MICRO = "min-h-6 px-2 py-0 text-ui-sm gap-1.5 rounded-md [&_svg]:size-3";
const SIZE_CLASS: Record<ButtonSize, string> = {
  xs: MICRO,
  sm: CONTEXTUAL,
  md: COMPACT,
  lg: STANDARD,
  standard: STANDARD,
  compact: COMPACT,
  contextual: CONTEXTUAL,
  micro: MICRO,
  // Descendants include glyphs wrapped by stateful/motion adapters.
  icon: "size-6 min-h-6 min-w-6 shrink-0 p-0 text-ui-base rounded-md [&_svg]:size-3",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "standard",
    className,
    children,
    focus = "default",
    geometry = "default",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      data-size={size}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center font-normal select-none [&_svg]:cursor-inherit [&_span]:cursor-inherit",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        focus === "inset" && "focus-visible:ring-inset focus-visible:ring-offset-0",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        geometry === "goal" && "rounded-lg",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  {
    variant = "primary",
    size = "standard",
    className,
    children,
    focus = "default",
    geometry = "default",
    ...rest
  },
  ref,
) {
  return (
    <a
      ref={ref}
      data-size={size}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center font-normal select-none [&_svg]:cursor-inherit [&_span]:cursor-inherit",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        focus === "inset" && "focus-visible:ring-inset focus-visible:ring-offset-0",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        geometry === "goal" && "rounded-lg",
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  );
});
