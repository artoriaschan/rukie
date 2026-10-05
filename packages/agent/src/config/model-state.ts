import type { ToolStateDefinition } from "../tool-state/index.ts";

export const modelState: ToolStateDefinition = {
  name: "model",
  version: 1,
  parse(version, value) {
    if (version !== 1 || typeof value !== "string" || !/^[^/]+\/.+$/.test(value))
      throw new Error("Invalid model selection snapshot.");
    return value;
  },
};
