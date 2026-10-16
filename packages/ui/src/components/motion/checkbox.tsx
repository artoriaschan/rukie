import { useId } from "react";
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
      <button
        id={id}
        type="button"
        role="checkbox"
        aria-checked={indeterminate ? "mixed" : checked}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange(!checked)}
        data-state={checked ? "checked" : indeterminate ? "indeterminate" : "unchecked"}
        className={cn(
          "relative inline-flex cursor-inherit [&_svg]:cursor-inherit [&_span]:cursor-inherit h-4 w-4 shrink-0 items-center justify-center rounded-sm border outline-none before:absolute before:-inset-1 before:content-['']",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "not-disabled:not-focus-visible:hover:ring-1 not-disabled:not-focus-visible:hover:ring-inset not-disabled:not-focus-visible:hover:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          showMark
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input-border bg-transparent not-disabled:hover:border-input-border-hover",
        )}
      >
        {showMark ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <title>{indeterminate ? "Partially selected" : "Selected"}</title>
            <path d={path} />
          </svg>
        ) : null}
      </button>
      {label ? (
        <span className={cn("select-none text-ui-base text-foreground", disabled && "opacity-50")}>
          {label}
        </span>
      ) : null}
    </label>
  );
}
