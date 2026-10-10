import { THINKING_LEVELS } from "@rukie/shared";
import { defineToolState, type ToolStateDefinition } from "../tool-state/index.ts";

export const modelState: ToolStateDefinition = defineToolState({
  history: "rewindable",
  fork: "asOf",
  name: "model",
  version: 2,
  migrate(value, version) {
    return this.parse(version, value);
  },
  parse(version, value) {
    if (version === 1 && typeof value === "string" && /^[^/]+\/.+$/.test(value))
      return { model: value, thinkingLevel: "off" };
    if (
      version === 2 &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "model" in value &&
      typeof value.model === "string" &&
      /^[^/]+\/.+$/.test(value.model) &&
      "thinkingLevel" in value &&
      THINKING_LEVELS.some((level) => level === value.thinkingLevel)
    )
      return { model: value.model, thinkingLevel: String(value.thinkingLevel) };
    throw new Error("Invalid model selection snapshot.");
  },
});
