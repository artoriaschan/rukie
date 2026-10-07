/** Measured wall-clock phase: first observed thinking content through first text/tool,
 * or assistant settlement. Kept on the native assistant message in Transcript.
 */
export function assistantThinkingDuration(message: unknown): number | undefined {
  if (!message || typeof message !== "object" || !("rukieThinkingDurationMs" in message))
    return undefined;
  const duration = message.rukieThinkingDurationMs;
  return typeof duration === "number" && Number.isFinite(duration) && duration >= 0
    ? duration
    : undefined;
}

export function createThinkingTiming(now: () => number) {
  let startedAt: number | undefined;
  let durationMs: number | undefined;
  return {
    duration: () => durationMs,
    start() {
      startedAt = undefined;
      durationMs = undefined;
    },
    update(message: { content: readonly { type: string; text?: string; thinking?: string }[] }) {
      if (durationMs !== undefined) return;
      if (message.content.some((block) => block.type === "thinking" && !!block.thinking))
        startedAt ??= now();
      if (
        startedAt !== undefined &&
        message.content.some(
          (block) => (block.type === "text" && !!block.text) || block.type === "toolCall",
        )
      )
        durationMs = Math.max(0, now() - startedAt);
      if (durationMs !== undefined) Object.assign(message, { rukieThinkingDurationMs: durationMs });
    },
    settle(message: object) {
      if (startedAt !== undefined)
        Object.assign(message, {
          rukieThinkingDurationMs: durationMs ?? Math.max(0, now() - startedAt),
        });
    },
  };
}
