import { useComponentText } from "@/lib/i18n";
import type { ReactNode } from "react";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { cn } from "@/lib/utils";

export interface ThinkingShimmerProps {
  /** Loading message shown to the user. */
  children?: ReactNode;
  /** Seconds taken for one shimmer pass. */
  duration?: number;
  className?: string;
}

export function ThinkingShimmer({
  children: childrenProp,
  duration = 1.8,
  className,
}: ThinkingShimmerProps) {
  const componentText = useComponentText();
  const children = childrenProp ?? componentText("component.thinking");

  return (
    <TextShimmer as="span" duration={duration} className={cn("font-medium", className)}>
      {children}
    </TextShimmer>
  );
}
