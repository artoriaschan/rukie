import { defineToolState, type ToolStateDefinition } from "../../tool-state/index.ts";

/** Strict version-1 Plan Mode snapshot: `active` is the only stored fact. */
export type PlanSnapshot = { active: boolean };

export const planState: ToolStateDefinition = defineToolState({
  history: "rewindable",
  fork: "asOf",
  name: "plan",
  version: 1,
  parse(version, value) {
    if (version !== 1) throw new Error(`Unsupported plan version: ${version}`);
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !("active" in value) ||
      typeof value.active !== "boolean" ||
      Object.keys(value).length !== 1
    )
      throw new Error("Invalid Plan Mode snapshot.");
    return { active: value.active };
  },
});

/** Guidance follows the tool set available to this session, including headless resumes. */
export function planModeReminder(canSubmit: boolean): string {
  return (
    "You are in Plan Mode. Explore the code and context first; do not make changes yet. " +
    "Write a markdown plan explaining the changes, steps, and validation. " +
    (canSubmit
      ? "When ready, submit the plan with exit_plan_mode for user review. "
      : "When ready, give the plan directly as text in your final response. ") +
    "Permissions still apply as usual; Plan Mode does not restrict tools or change Permission Mode."
  );
}
