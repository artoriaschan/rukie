import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "destructive" | "link";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

export interface ButtonLinkProps extends Omit<ComponentPropsWithoutRef<"a">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

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
  { variant = "primary", size = "md", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "inline-flex cursor-pointer items-center justify-center font-normal select-none [&_svg]:cursor-inherit [&_span]:cursor-inherit",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = "primary", size = "md", className, children, ...rest },
  ref,
) {
  return (
    <a
      ref={ref}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center font-normal select-none [&_svg]:cursor-inherit [&_span]:cursor-inherit",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  );
});
