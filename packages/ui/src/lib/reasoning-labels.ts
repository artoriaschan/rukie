import type { ThinkingLevel } from "@rukie/shared";

// Pencil names remain identical in model settings, details and the selected-model trigger.
export const reasoningLabels: Record<ThinkingLevel, string> = {
  off: "关闭",
  automatic: "自动",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};
