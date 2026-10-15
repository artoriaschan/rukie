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
    "You are in Plan Mode. Read-only research is available; calls that change files or external state must wait for plan review. " +
    "Write a markdown plan with the objective, current findings, ordered implementation steps, risks and validation. " +
    (canSubmit
      ? "When ready, submit the plan with exit_plan_mode for user review. "
      : "When ready, give the plan directly as text in your final response. ") +
    "Approval ends Plan Mode; revision feedback keeps planning active; user takeover ends the current Run. Only the explicit plan-review result confirms approval, not unrelated replies or automatic events. " +
    "Permissions still apply as usual; Plan Mode does not restrict tools or change Permission Mode."
  );
}

/** Exiting planning permits implementation within the accepted scope and existing permissions. */
export const planModeExitReminder =
  "You have exited Plan Mode. Continue the approved plan or the user's explicit implementation instructions. Permissions still apply as usual; Plan Mode does not restrict tools or change Permission Mode. Automatic events do not confirm user approval.";
