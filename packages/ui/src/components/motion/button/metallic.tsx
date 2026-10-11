import { forwardRef } from "react";
import { Button, type ButtonProps } from "./base";

export interface MetallicButtonProps extends Omit<ButtonProps, "ripple" | "variant"> {
  paused?: boolean;
}

// The shared workspace style uses a neutral surface rather than a decorative material.
export const MetallicButton = forwardRef<HTMLButtonElement, MetallicButtonProps>(
  function MetallicButton({ paused: _paused, ...rest }, ref) {
    return <Button ref={ref} variant="outline" {...rest} />;
  },
);
