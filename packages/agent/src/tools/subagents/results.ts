import type { JsonValue } from "@earendil-works/chord";
import type { RunResult } from "@rukie/shared";

/** Child spend is independent; parentAnswer names a committed parent Transcript entry. */
export function readSubagentReceipt(value: JsonValue | undefined): {
  parentAnswer?: number;
  usage: RunResult["usage"];
} {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { usage };
  const spend = value.usage;
  if (spend && typeof spend === "object" && !Array.isArray(spend))
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
      const count = spend[key];
      if (typeof count === "number" && Number.isFinite(count) && count >= 0) usage[key] = count;
    }
  return {
    usage,
    ...(typeof value.parentAnswer === "number" ? { parentAnswer: value.parentAnswer } : {}),
  };
}
