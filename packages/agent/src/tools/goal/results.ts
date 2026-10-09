import type { JsonValue } from "@earendil-works/chord";
import { storedRequestResult } from "../../requests/index.ts";

/** Interpret this capability's terminal driver result; cancellation has no receipt. */
export function readGoalReceipt(value: JsonValue | undefined, requestId: string) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? storedRequestResult({ ...value, requestId })
    : undefined;
}
