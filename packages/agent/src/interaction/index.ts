import { randomUUID } from "node:crypto";
import type { Context, JsonValue } from "@earendil-works/chord";
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

function pendingIdentity(taskId: number, conversationId: number, kind: string) {
  return {
    version: 1,
    kind,
    phase: "pending",
    taskId,
    conversationId,
    requestId: `interaction:${taskId}:${kind}`,
  };
}

function matchesPendingIdentity(
  value: JsonValue | undefined,
  expected: ReturnType<typeof pendingIdentity>,
): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.version === expected.version &&
    value.kind === expected.kind &&
    value.phase === expected.phase &&
    value.taskId === expected.taskId &&
    value.conversationId === expected.conversationId &&
    value.requestId === expected.requestId
  );
}

/** Native phase and terminal receipt override the immutable interaction memo. */
export function hasPendingInteraction(
  task: TaskRecord<JsonValue, JsonValue, JsonValue>,
  matchesKind: (kind: string) => boolean,
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
      matchesKind(kind) &&
      name === `rukie.interaction.${kind}` &&
      matchesPendingIdentity(
        value,
        pendingIdentity(Number(task.id), Number(task.conversationId), kind),
      )
    );
  });
}

/** Native phase/terminal receipt is authoritative; this immutable memo identifies its pending interaction. */
export async function createInteractionIdentity(
  api: Pick<HookApi, "taskId" | "conversationId" | "memo">,
  kind: string,
  context: Context,
): Promise<InteractionIdentity> {
  const expected = pendingIdentity(Number(api.taskId), Number(api.conversationId), kind);
  const stored = await api.memo(`rukie.interaction.${kind}`, expected, context);
  if (!matchesPendingIdentity(stored, expected))
    throw new Error("Invalid native interaction identity.");
  context.abortSignal?.throwIfAborted();
  return {
    requestId: expected.requestId,
    taskId: expected.taskId,
    conversationId: expected.conversationId,
    epoch: randomUUID(),
  };
}
