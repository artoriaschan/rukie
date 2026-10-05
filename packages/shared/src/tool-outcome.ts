/** Recognize a persisted recovery placeholder, never a real execution result. */
export function isUnknownToolOutcome(details: unknown): boolean {
  if (typeof details !== "object" || details === null || !("recovery" in details)) return false;
  const recovery = details.recovery;
  return (
    typeof recovery === "object" &&
    recovery !== null &&
    "type" in recovery &&
    recovery.type === "unknown-tool-outcome" &&
    "version" in recovery &&
    recovery.version === 1
  );
}
