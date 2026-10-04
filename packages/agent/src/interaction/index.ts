export interface InteractionNotification {
  message: string;
  title: string;
  notification_type: "permission_prompt" | "question" | "plan_review" | "mcp_auth";
}
export type OnInteractionStart = (
  notification: InteractionNotification,
  signal: AbortSignal,
) => void | Promise<void>;

/** Wait for a frontend reply until the Run aborts, then discard any late reply. */
export async function requestInteraction<Request extends { signal: AbortSignal }, Reply>(
  request: Request,
  respond: (request: Request) => Promise<Reply>,
  cancelled: Reply,
  start?: { notification: InteractionNotification; notify?: OnInteractionStart },
): Promise<Reply> {
  const { signal } = request;
  if (signal.aborted) return cancelled;
  // Notifications are side effects and never delay or fail the interaction.
  try {
    void Promise.resolve(start?.notify?.(start.notification, signal)).catch(() => {});
  } catch {
    /* A synchronous notification failure cannot suppress the frontend request. */
  }
  const aborted = Promise.withResolvers<Reply>();
  const abort = () => aborted.resolve(cancelled);
  signal.addEventListener("abort", abort, { once: true });
  try {
    const reply = await Promise.race([respond(request), aborted.promise]);
    return signal.aborted ? cancelled : reply;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
