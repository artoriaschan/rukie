import { type HTMLMotionProps, motion } from "motion/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { Button } from "./button/base";

export type ActionSwapItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  ariaLabel?: string;
};

export type ActionSwapButtonVariant = "primary" | "secondary" | "outline" | "ghost";
export type ActionSwapButtonSize = "sm" | "md" | "lg" | "icon";
export type ActionSwapAnimation = "blur" | "roll" | "cascade";

export interface ActionSwapButtonProps extends Omit<
  HTMLMotionProps<"button">,
  "children" | "onChange"
> {
  items: ActionSwapItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string, item: ActionSwapItem) => void;
  variant?: ActionSwapButtonVariant;
  size?: ActionSwapButtonSize;
  animation?: ActionSwapAnimation;
  iconOnly?: boolean;
  cycle?: boolean;
}

export interface ActionSwapTextProps {
  value: string;
  children: ReactNode;
  animation?: ActionSwapAnimation;
  className?: string;
}

export interface ActionSwapIconProps {
  value: string;
  children: ReactNode;
  animation?: ActionSwapAnimation;
  className?: string;
}

// Named animation choices retain one calm state transition in workspace controls.
export function ActionSwapText({
  value,
  children,
  animation = "blur",
  className,
}: ActionSwapTextProps) {
  return (
    <motion.span
      key={`${animation}-${value}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: EASE_OUT }}
      className={cn("inline-block min-w-0 max-w-full", className)}
    >
      {children}
    </motion.span>
  );
}

export function ActionSwapIcon({
  value,
  children,
  animation = "blur",
  className,
}: ActionSwapIconProps) {
  return (
    <motion.span
      key={`${animation}-${value}`}
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: EASE_OUT }}
      className={cn("inline-grid shrink-0 place-items-center", className)}
    >
      {children}
    </motion.span>
  );
}

export function ActionSwapButton({
  items,
  value,
  defaultValue,
  onValueChange,
  variant = "secondary",
  size = "md",
  animation = "blur",
  iconOnly = size === "icon",
  cycle = true,
  className,
  disabled,
  onClick,
  ...rest
}: ActionSwapButtonProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? items[0]?.id);
  const currentValue = value ?? internalValue;
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === currentValue),
  );
  const activeItem = items[activeIndex] ?? items[0];
  const hasIcon = items.some((item) => item.icon);
  const nextItem = cycle && items.length > 0 ? items[(activeIndex + 1) % items.length] : undefined;

  if (!activeItem) return null;

  const accessibleLabel =
    activeItem.ariaLabel ??
    (iconOnly && typeof activeItem.label === "string" ? activeItem.label : undefined);

  return (
    <Button
      variant={variant}
      size={size}
      disabled={disabled}
      className={cn(
        "min-w-0",
        "disabled:pointer-events-none disabled:text-muted-foreground",
        className,
      )}
      aria-label={accessibleLabel}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled || !cycle || !nextItem) return;
        if (value === undefined) setInternalValue(nextItem.id);
        onValueChange?.(nextItem.id, nextItem);
      }}
      {...rest}
    >
      {hasIcon ? (
        <ActionSwapIcon value={activeItem.id} animation={animation} className="h-4 w-4">
          {activeItem.icon ?? null}
        </ActionSwapIcon>
      ) : null}
      {!iconOnly ? (
        <ActionSwapText value={activeItem.id} animation={animation}>
          {activeItem.label}
        </ActionSwapText>
      ) : null}
    </Button>
  );
}
