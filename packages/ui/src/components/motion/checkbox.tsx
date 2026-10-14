import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

const CHECK_PATH = "M5 13l4 4L19 7";
const INDETERMINATE_PATH = "M6 12h12";

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  indeterminate?: boolean;
  label?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
  /** Associates an external message (e.g. a form error) with the control. */
  "aria-describedby"?: string;
}

export function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  indeterminate,
  label,
  className,
  id: idProp,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: CheckboxProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const reduce = useReducedMotion();
  const showMark = checked || indeterminate;
  const path = indeterminate ? INDETERMINATE_PATH : CHECK_PATH;

  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex min-h-6 items-center gap-2",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      <motion.button
        id={id}
        type="button"
        role="checkbox"
        aria-checked={indeterminate ? "mixed" : checked}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange(!checked)}
        transition={{ duration: reduce ? 0 : 0.12, ease: EASE_OUT }}
        data-state={checked ? "checked" : indeterminate ? "indeterminate" : "unchecked"}
        className={cn(
          "relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border outline-none before:absolute before:-inset-1 before:content-[''] transition-colors duration-120",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "not-disabled:not-focus-visible:hover:ring-1 not-disabled:not-focus-visible:hover:ring-inset not-disabled:not-focus-visible:hover:ring-ring not-disabled:active:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
          showMark
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input-border bg-transparent not-disabled:hover:border-input-border-hover",
        )}
      >
        <AnimatePresence initial={false}>
          {showMark ? (
            <motion.svg
              key={indeterminate ? "indeterminate" : "checked"}
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.12, ease: EASE_OUT }}
              aria-hidden
            >
              <title>{indeterminate ? "Partially selected" : "Selected"}</title>
              <motion.path
                d={path}
                initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : {
                        duration: 0.12,
                        ease: EASE_OUT,
                      }
                }
              />
            </motion.svg>
          ) : null}
        </AnimatePresence>
      </motion.button>
      {label ? (
        <span className={cn("select-none text-ui-base text-foreground", disabled && "opacity-50")}>
          {label}
        </span>
      ) : null}
    </label>
  );
}
