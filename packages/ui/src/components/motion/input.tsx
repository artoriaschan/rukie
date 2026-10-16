import { AnimatePresence, motion } from "motion/react";
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type InputClassNames = {
  root?: string;
  label?: string;
  field?: string;
  input?: string;
  leftIcon?: string;
  rightIcon?: string;
  successIcon?: string;
  errorMessage?: string;
};

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "size"
> {
  label?: string;
  size?: "standard" | "scoped";
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Truthy error shows a semantic border and (if a string) a message. */
  error?: string | boolean;
  /** Reserve one message line so validation does not shift nearby content. */
  reserveErrorLine?: boolean;
  success?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  className?: string;
  classNames?: InputClassNames;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    size = "standard",
    value: valueProp,
    defaultValue,
    onChange,
    onFocus,
    onBlur,
    error,
    reserveErrorLine = false,
    success,
    leftIcon,
    rightIcon,
    className,
    classNames,
    disabled,
    id: idProp,
    type,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const id = idProp ?? reactId;

  const controlled = valueProp !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const value = controlled ? (valueProp ?? "") : internal;

  const [focused, setFocused] = useState(false);

  const hasError = Boolean(error);
  const errorMessage = typeof error === "string" ? error : null;

  // Right edge shows the success check, otherwise the caller's right icon.
  const rightSlot = success ? null : rightIcon;

  const handleChange = (next: string) => {
    if (!controlled) setInternal(next);
    onChange?.(next);
  };

  return (
    <div className={cn("flex flex-col gap-1", className, classNames?.root)}>
      {label ? (
        <label
          htmlFor={id}
          className={cn("px-1 text-ui-base font-normal text-foreground", classNames?.label)}
        >
          {label}
        </label>
      ) : null}

      <div
        data-state={hasError ? "error" : success ? "success" : focused ? "focused" : "idle"}
        className={cn(
          "relative flex items-center border ring-inset",
          size === "scoped" ? "min-h-8 rounded-lg" : "min-h-9 rounded-xl",
          "border-input-border bg-input-surface",
          !focused && !hasError && !disabled && "hover:border-input-border-hover",
          focused && !hasError && "border-input-border-focused bg-input-focused ring-2 ring-ring",
          hasError && "border-destructive ring-2 ring-destructive/25",
          disabled && "opacity-50",
          classNames?.field,
        )}
      >
        {leftIcon ? (
          <span
            className={cn(
              "pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center text-muted-foreground [&_svg]:size-3",
              classNames?.leftIcon,
            )}
          >
            {leftIcon}
          </span>
        ) : null}

        <input
          ref={ref}
          id={id}
          type={type}
          value={value}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={errorMessage ? `${id}-error` : undefined}
          {...rest}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          className={cn(
            "peer min-h-0 w-full bg-transparent py-1 text-foreground caret-foreground outline-none",
            "placeholder:text-foreground-subtlest",
            size === "scoped" ? "min-h-[30px] text-ui-base" : "min-h-[34px] text-ui-sm",
            leftIcon ? "pl-10" : "pl-3",
            rightSlot || success ? "pr-10" : "pr-3",
            disabled && "cursor-not-allowed",
            classNames?.input,
          )}
        />

        {success ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className={cn(
              "absolute right-3 top-1/2 size-3 -translate-y-1/2 text-(--color-success)",
              classNames?.successIcon,
            )}
          >
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : rightSlot ? (
          <span
            className={cn(
              "absolute right-0 top-0 flex h-full items-center text-muted-foreground [&_button]:grid [&_button]:size-6 [&_button]:place-items-center [&_svg]:size-3",
              classNames?.rightIcon,
            )}
          >
            {rightSlot}
          </span>
        ) : null}
      </div>

      <div className={reserveErrorLine ? "min-h-4" : "contents"}>
        <AnimatePresence initial={false}>
          {errorMessage ? (
            <motion.p
              id={`${id}-error`}
              role="alert"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className={cn("px-1 text-ui-sm text-destructive", classNames?.errorMessage)}
            >
              {errorMessage}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
});
