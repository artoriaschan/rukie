"use client";
// beui.dev/components/motion/switch

import { useId } from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  ariaLabel,
  className,
}: SwitchProps) {
  const id = useId();

  return (
    <span className={cn("inline-flex min-h-6 items-center gap-3", className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange(!checked)}
        data-state={checked ? "checked" : "unchecked"}
        className={cn(
          "group peer relative before:absolute before:-inset-y-1 before:inset-x-0 before:content-[''] inline-flex h-5 w-9 shrink-0 cursor-pointer items-center px-0.5 rounded-full outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "not-disabled:not-focus-visible:hover:ring-1 not-disabled:not-focus-visible:hover:ring-inset not-disabled:not-focus-visible:hover:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "justify-end bg-primary" : "justify-start bg-secondary",
        )}
      >
        <div
          className={cn(
            "pointer-events-none block size-4 rounded-full",
            checked ? "bg-primary-foreground" : "bg-foreground",
          )}
        ></div>
      </button>
      {label ? (
        <label
          htmlFor={id}
          className={cn(
            "text-ui-base text-foreground",
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          )}
        >
          {label}
        </label>
      ) : null}
    </span>
  );
}
