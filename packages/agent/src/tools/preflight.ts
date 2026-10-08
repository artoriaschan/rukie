import { randomUUID } from "node:crypto";
import type { InteractionIdentity } from "../interaction/index.ts";
import type { Context } from "@earendil-works/chord";
import type { HookApi, ToolRegistration } from "@earendil-works/pi-durable";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

/** Interaction collection after authorization, before native execution intent. */
export type PreflightTool<T extends TSchema = TSchema> = ToolRegistration<T> & {
  preflight(
    args: Static<T>,
    api: HookApi,
    context: Context,
    callId: string,
    identity: InteractionIdentity,
  ): Promise<void>;
};

/** Native validation still owns invalid calls; do not ask a frontend about invalid rewritten input. */
export async function preflightTool(
  tool: ToolRegistration | undefined,
  args: unknown,
  api: HookApi,
  context: Context,
  callId: string,
) {
  if (
    !tool ||
    !("preflight" in tool) ||
    typeof tool.preflight !== "function" ||
    !Value.Check(tool.parameters, args)
  )
    return;
  const expected = {
    version: 1,
    kind: tool.name,
    phase: "pending",
    taskId: Number(api.taskId),
    conversationId: Number(api.conversationId),
    requestId: `interaction:${Number(api.taskId)}`,
  };
  const stored = await api.memo("rukie.interaction", expected, context);
  // Memo data is persisted JSON, not trusted merely because this writer has a schema.
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
  const identity: InteractionIdentity = {
    requestId: expected.requestId,
    taskId: expected.taskId,
    conversationId: expected.conversationId,
    epoch: randomUUID(),
  };
  context.abortSignal?.throwIfAborted();
  // Registrations with this capability declare the same schema for execute and preflight.
  await (tool as PreflightTool).preflight(args, api, context, callId, identity);
  context.abortSignal?.throwIfAborted();
}
