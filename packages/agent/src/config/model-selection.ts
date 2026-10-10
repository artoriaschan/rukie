import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import { THINKING_LEVELS, type ThinkingLevel } from "@rukie/shared";

/** Choose the highest supported level no higher than requested, falling back to the minimum. */
export function supportedThinkingLevel(model: Model<Api>, requested: ThinkingLevel): ThinkingLevel {
  const supported = getSupportedThinkingLevels(model);
  const maximum = THINKING_LEVELS.indexOf(requested);
  return (
    [...supported].reverse().find((level) => THINKING_LEVELS.indexOf(level) <= maximum) ??
    supported[0] ??
    "off"
  );
}
