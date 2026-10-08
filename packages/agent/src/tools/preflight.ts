import { createInteractionIdentity, type InteractionIdentity } from "../interaction/index.ts";
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
  const identity = await createInteractionIdentity(api, tool.name, context);
  // Registrations with this capability declare the same schema for execute and preflight.
  await (tool as PreflightTool).preflight(args, api, context, callId, identity);
  context.abortSignal?.throwIfAborted();
}
