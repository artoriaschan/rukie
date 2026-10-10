import { resolve } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createSession as createKernel,
  AgentDoc,
  InboxDoc,
  LiveDoc,
  UsageDoc,
  type ConversationId,
} from "@earendil-works/pi-durable";
import { readSessionStorage, SessionMetadataDoc, parseSessionMetadata } from "../store/index.ts";
import { todoState } from "../tools/todo/index.ts";
import { planState } from "../tools/plan-mode/index.ts";
import { subagentsState } from "../tools/subagents/index.ts";
import { goalState } from "../tools/goal/index.ts";
import { PendingInputFactsDoc } from "./queued-inputs.ts";
import { readTranscript, readRunSummaries } from "./history.ts";
import { transcriptMessages } from "./messages.ts";
import { committedSnapshot, projectCommittedOutcomeFacts } from "./observation.ts";

/** One committed, lease-free view. Never recovers tasks, runs hooks, or modifies storage. */
export async function readSessionSnapshot(options: { cwd: string; homeDir: string; id: string }) {
  options = { ...options, cwd: resolve(options.cwd) };
  return readSessionStorage(options, async (storage) => {
    const kernel = createKernel(storage);
    try {
      const metadata = parseSessionMetadata(
        await kernel.snapshot(SessionMetadataDoc, BACKGROUND_CONTEXT),
      );
      if (metadata.id !== options.id || metadata.cwd !== options.cwd)
        throw new Error("Session metadata does not match the requested directory.");
      // Metadata validation checks a positive safe integer; the storage kernel owns this conversation ID.
      const conversationId = metadata.activeConversationId as ConversationId;
      const entries = await readTranscript(storage, conversationId, BACKGROUND_CONTEXT);
      const [agent, inbox, live, usage, pending] = await Promise.all([
        kernel.snapshot(AgentDoc, conversationId, BACKGROUND_CONTEXT),
        kernel.snapshot(InboxDoc, conversationId, BACKGROUND_CONTEXT),
        kernel.snapshot(LiveDoc, conversationId, BACKGROUND_CONTEXT),
        kernel.snapshot(UsageDoc, conversationId, BACKGROUND_CONTEXT),
        kernel.snapshot(PendingInputFactsDoc, conversationId, BACKGROUND_CONTEXT),
      ]);
      const toolStates: Record<string, unknown> = {};
      for (const definition of [todoState, planState, goalState, subagentsState(options.id)]) {
        const state = await kernel.snapshot(
          definition.document,
          conversationId,
          BACKGROUND_CONTEXT,
        );
        if (state && state.value !== null)
          toolStates[definition.name] = definition.parse(definition.version, state.value);
      }
      const plan = toolStates.plan;
      const planMode =
        typeof plan === "object" && plan !== null && "active" in plan && plan.active === true;
      const messages = await projectCommittedOutcomeFacts(
        transcriptMessages(entries),
        entries,
        { getTask: (id, context) => storage.task(id, context) },
        BACKGROUND_CONTEXT,
      );
      return committedSnapshot(
        options.id,
        {
          entries,
          docs: {
            ...(agent && { "pi.agent": agent }),
            ...(inbox && { "pi.inbox": inbox }),
            ...(live && { "pi.live": live }),
            ...(usage && { "pi.usage": usage }),
            ...(pending && { "rukie.pending-input-facts": pending }),
          },
        },
        messages,
        {
          toolStates,
          runSummaries: readRunSummaries(entries),
          model: metadata.model,
          planMode,
          // A read-only observer has no process ownership; process-local child activity is not reconstructed.
          background: [],
        },
      );
    } finally {
      await kernel.close(BACKGROUND_CONTEXT);
    }
  });
}
