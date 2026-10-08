import { randomUUID } from "node:crypto";
import type { JsonValue, Context } from "@earendil-works/chord";
import type { HookApi, TaskRecord } from "@earendil-works/pi-durable";

/** Stable native request identity plus one invocation's callback ownership. */
export interface InteractionIdentity {
  requestId: string;
  taskId: number;
  conversationId: number;
  epoch: string;
}

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
  const aborted = Promise.withResolvers<Reply>();
  const abort = () => aborted.resolve(cancelled);
  signal.addEventListener("abort", abort, { once: true });
  try {
    // Notifications are side effects and never delay or fail the interaction.
    try {
      void Promise.resolve(start?.notify?.(start.notification, signal)).catch(() => {});
    } catch {
      /* A synchronous notification failure cannot suppress the frontend request. */
    }
    if (signal.aborted) return cancelled;
    const reply = await Promise.race([respond(request), aborted.promise]);
    return signal.aborted ? cancelled : reply;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Native phase/terminal receipt is authoritative; this immutable memo identifies its pending interaction. */
export async function createInteractionIdentity(
  api: Pick<HookApi, "taskId" | "conversationId" | "memo">,
  kind: string,
  context: Context,
): Promise<InteractionIdentity> {
  const expected = {
    version: 1,
    kind,
    phase: "pending",
    taskId: Number(api.taskId),
    conversationId: Number(api.conversationId),
    requestId: `interaction:${Number(api.taskId)}:${kind}`,
  };
  const stored = await api.memo(`rukie.interaction.${kind}`, expected, context);
  if (
    !stored ||
    typeof stored !== "object" ||
    Array.isArray(stored) ||
    stored.version !== 1 ||
    stored.kind !== expected.kind ||
    stored.phase !== "pending" ||
    stored.taskId !== expected.taskId ||
    stored.conversationId !== expected.conversationId ||
    stored.requestId !== expected.requestId
  )
    throw new Error("Invalid native interaction identity.");
  context.abortSignal?.throwIfAborted();
  return {
    requestId: expected.requestId,
    taskId: expected.taskId,
    conversationId: expected.conversationId,
    epoch: randomUUID(),
  };
}

/** Only a live, unexecuted native authentication request may require transport declarations before resume. */
export function hasPendingMcpInteraction(
  task: TaskRecord<JsonValue, JsonValue, JsonValue>,
): boolean {
  if (
    task.kind !== "pi.tool" ||
    task.abortRequested ||
    task.state.status === "terminal" ||
    task.state.status === "completing"
  )
    return false;
  const checkpoint = task.state.checkpoint;
  if (
    !checkpoint ||
    typeof checkpoint !== "object" ||
    Array.isArray(checkpoint) ||
    checkpoint.phase !== "call"
  )
    return false;
  return Object.entries(task.memos ?? {}).some(([name, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const kind = value.kind;
    return (
      typeof kind === "string" &&
      kind.startsWith("mcp__") &&
      kind.endsWith("__authenticate") &&
      name === `rukie.interaction.${kind}` &&
      value.version === 1 &&
      value.phase === "pending" &&
      value.taskId === Number(task.id) &&
      value.conversationId === Number(task.conversationId) &&
      value.requestId === `interaction:${Number(task.id)}:${kind}`
    );
  });
}
