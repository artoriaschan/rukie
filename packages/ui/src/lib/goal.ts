import type { GoalView } from "@rukie/agent";

/** Published Tool State is untrusted; only the current Goal shape can drive controls. */
export function readGoal(value: unknown): GoalView | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const fields = [
    "id",
    "objective",
    "attachments",
    "elapsedMs",
    "activeSince",
    "phase",
    "roundsStarted",
    "maxRounds",
    "blockedReason",
    "armed",
  ];
  if (Object.keys(value).some((key) => !fields.includes(key))) return;
  // The non-array object check above establishes the record invariant; every consumed value is narrowed below.
  const {
    id,
    objective,
    attachments,
    elapsedMs,
    activeSince,
    phase,
    roundsStarted,
    maxRounds,
    blockedReason,
    armed,
  } = value as Record<string, unknown>;
  if (
    typeof id !== "string" ||
    !id.trim() ||
    typeof objective !== "string" ||
    typeof attachments !== "number" ||
    !Number.isSafeInteger(attachments) ||
    attachments < 0 ||
    (!objective.trim() && !attachments) ||
    typeof elapsedMs !== "number" ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0 ||
    typeof armed !== "boolean" ||
    (phase !== "active" && phase !== "paused" && phase !== "blocked" && phase !== "complete") ||
    typeof roundsStarted !== "number" ||
    !Number.isSafeInteger(roundsStarted) ||
    roundsStarted < 0 ||
    typeof maxRounds !== "number" ||
    !Number.isSafeInteger(maxRounds) ||
    maxRounds < 1 ||
    roundsStarted > maxRounds ||
    (activeSince !== undefined &&
      (typeof activeSince !== "number" ||
        !Number.isFinite(activeSince) ||
        activeSince < 0 ||
        !armed ||
        phase !== "active")) ||
    (armed && phase !== "active") ||
    (phase === "blocked"
      ? typeof blockedReason !== "string" || !blockedReason.trim()
      : blockedReason !== undefined)
  )
    return;
  return {
    id,
    objective,
    attachments,
    elapsedMs,
    phase,
    roundsStarted,
    maxRounds,
    armed,
    ...(typeof activeSince === "number" ? { activeSince } : {}),
    ...(typeof blockedReason === "string" ? { blockedReason } : {}),
  };
}
