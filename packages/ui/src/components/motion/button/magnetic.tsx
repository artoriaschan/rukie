import { forwardRef } from "react";
import { Magnetic } from "../magnetic";
import { Button, type ButtonProps } from "./base";

export interface MagneticButtonProps extends ButtonProps {
  /** Magnetic pull strength. Off by default. */
  strength?: number;
  /** Class applied to the magnetic wrapper. */
  magneticClassName?: string;
}

export const MagneticButton = forwardRef<HTMLButtonElement, MagneticButtonProps>(
  function MagneticButton({ strength = 0, magneticClassName, children, ...rest }, ref) {
    return (
      <Magnetic strength={strength} className={magneticClassName}>
        <Button size="standard" ref={ref} {...rest}>
          {children}
        </Button>
      </Magnetic>
    );
  },
);
