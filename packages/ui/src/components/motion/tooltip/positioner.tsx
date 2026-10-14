import { OVERLAY_LAYER } from "@/lib/overlay";
import { cn } from "@/lib/utils";
import { useIsPresent } from "motion/react";
import { useCallback, useState, type ReactNode } from "react";
import { useTooltipPosition } from "./use-position";

type PositionProps = Parameters<typeof useTooltipPosition>[0];

/** Readiness lives with the mounted overlay, not a trigger ref's attach/detach cycle. */
export function TooltipPositioner({
  children,
  layer = "hint",
  ...position
}: Omit<PositionProps, "open" | "onPosition"> & {
  children: (ready: boolean, present: boolean) => ReactNode;
  layer?: "hint" | "modalHint";
}) {
  const present = useIsPresent();
  const [ready, setReady] = useState(false);
  const onPosition = useCallback(() => setReady(true), []);
  useTooltipPosition({ ...position, open: present, onPosition });
  return (
    <span
      ref={position.floatingRef}
      inert={!present}
      aria-hidden={!present || undefined}
      className={cn(OVERLAY_LAYER[layer], "pointer-events-none fixed left-0 top-0 w-max")}
      style={{ visibility: "hidden", maxWidth: "calc(100vw - 16px)" }}
    >
      {children(ready, present)}
    </span>
  );
}
