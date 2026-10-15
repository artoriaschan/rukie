import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type RadioCtx = {
  value: string;
  setValue: (value: string) => void;
};

const RadioCtx = createContext<RadioCtx | null>(null);

function useRadioGroup() {
  const ctx = useContext(RadioCtx);
  if (!ctx) {
    throw new Error("RadioGroupItem must be used inside <RadioGroup>");
  }
  return ctx;
}

export interface RadioGroupProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
  orientation?: "vertical" | "horizontal";
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function RadioGroup({
  value,
  defaultValue = "",
  onValueChange,
  children,
  className,
  orientation = "vertical",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
}: RadioGroupProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [internal, setInternal] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const setValue = useCallback(
    (next: string) => {
      if (!controlled) setInternal(next);
      onValueChange?.(next);
    },
    [controlled, onValueChange],
  );
  const contextValue = useMemo(() => ({ value: current, setValue }), [current, setValue]);

  useEffect(() => {
    const items = Array.from(
      groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? [],
    );
    const active = items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0];
    for (const item of items) item.tabIndex = item === active ? 0 : -1;
  }, [current, children]);

  return (
    <RadioCtx.Provider value={contextValue}>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-orientation={orientation}
        onKeyDown={(event) => {
          const direction = ["ArrowRight", "ArrowDown"].includes(event.key)
            ? 1
            : ["ArrowLeft", "ArrowUp"].includes(event.key)
              ? -1
              : 0;
          if (!direction) return;
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="radio"]:not(:disabled)',
            ),
          );
          const index = items.findIndex((item) => item === event.target);
          if (index < 0 || !items.length) return;
          event.preventDefault();
          const next = items[(index + direction + items.length) % items.length]!;
          next.focus();
          next.click();
        }}
        className={cn(
          "flex gap-2",
          orientation === "vertical" ? "flex-col" : "flex-row flex-wrap",
          className,
        )}
      >
        {children}
      </div>
    </RadioCtx.Provider>
  );
}

export interface RadioGroupItemProps {
  value: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function RadioGroupItem({
  value,
  label,
  disabled,
  className,
  id: idProp,
}: RadioGroupItemProps) {
  const { value: groupValue, setValue } = useRadioGroup();
  const autoId = useId();
  const id = idProp ?? autoId;
  const selected = groupValue === value;

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
        role="radio"
        aria-checked={selected}
        tabIndex={selected && !disabled ? 0 : -1}
        disabled={disabled}
        onClick={() => !disabled && setValue(value)}
        data-state={selected ? "checked" : "unchecked"}
        className={cn(
          "relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border outline-none before:absolute before:-inset-1 before:content-['']",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "not-disabled:not-focus-visible:hover:ring-1 not-disabled:not-focus-visible:hover:ring-inset not-disabled:not-focus-visible:hover:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          selected
            ? "border-primary"
            : "border-input-border not-disabled:hover:border-input-border-hover",
        )}
      >
        {selected ? <span className="absolute size-2 rounded-full bg-primary" /> : null}
      </button>
      {label ? (
        <span className={cn("select-none text-ui-base text-foreground", disabled && "opacity-50")}>
          {label}
        </span>
      ) : null}
    </label>
  );
}
