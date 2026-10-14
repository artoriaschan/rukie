import { useComponentText } from "@/lib/i18n";

import { Check, Loader2, X } from "lucide-react";
import { motion } from "motion/react";
import { forwardRef, type ReactNode } from "react";
import { Button, type ButtonProps } from "./base";

export type ButtonState = "idle" | "loading" | "success" | "error";

export interface StatefulButtonProps extends Omit<ButtonProps, "children"> {
  state?: ButtonState;
  children: ReactNode;
  loadingText?: ReactNode;
  successText?: ReactNode;
  errorText?: ReactNode;
  icon?: ReactNode;
}

export const StatefulButton = forwardRef<HTMLButtonElement, StatefulButtonProps>(
  function StatefulButton(
    {
      state = "idle",
      children,
      loadingText: loadingTextProp,
      successText: successTextProp,
      errorText: errorTextProp,
      icon,
      disabled,
      ...rest
    },
    ref,
  ) {
    const componentText = useComponentText();
    const loadingText = loadingTextProp ?? componentText("component.loading");
    const successText = successTextProp ?? componentText("component.done");
    const errorText = errorTextProp ?? componentText("component.try-again");

    const isBusy = state === "loading";
    const stateText =
      state === "loading"
        ? loadingText
        : state === "success"
          ? successText
          : state === "error"
            ? errorText
            : children;
    const textKey = typeof stateText === "string" ? `${state}-${stateText}` : state;

    return (
      <Button
        ref={ref}
        disabled={disabled || isBusy}
        aria-busy={isBusy}
        whileHover={undefined}
        {...rest}
      >
        <motion.span
          key={textKey}
          aria-live="polite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12 }}
          className="inline-flex min-w-0 items-center justify-center gap-[inherit]"
        >
          {state === "loading" ? <Loader2 className="size-4 shrink-0 animate-spin" /> : null}
          {state === "success" ? <Check className="size-4 shrink-0" /> : null}
          {state === "error" ? <X className="size-4 shrink-0" /> : null}
          <span>{stateText}</span>
          {state === "idle" ? icon : null}
        </motion.span>
      </Button>
    );
  },
);
