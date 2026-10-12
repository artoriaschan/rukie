import DeepSeekMono from "@lobehub/icons/es/DeepSeek/components/Mono";
import DeepSeekColor from "@lobehub/icons/es/DeepSeek/components/Color";
import type { ProviderIconKey } from "@rukie/shared";
import { Box } from "lucide-react";
import { cn } from "../lib/utils";

const brands: Record<ProviderIconKey, { mono: typeof DeepSeekMono; color: typeof DeepSeekColor }> =
  {
    deepseek: { mono: DeepSeekMono, color: DeepSeekColor },
  };

/** Decorative: callers provide the service name as adjacent visible text. */
export function ProviderIcon({
  icon,
  variant = "mono",
  className,
}: {
  icon?: ProviderIconKey;
  variant?: "mono" | "color";
  className?: string;
}) {
  const Icon = icon ? brands[icon][variant] : Box;
  return (
    <Icon
      aria-hidden="true"
      data-provider-brand={icon}
      className={cn("size-4 shrink-0", className)}
    />
  );
}
