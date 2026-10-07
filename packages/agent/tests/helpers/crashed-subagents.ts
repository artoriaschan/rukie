import {
  awaitWithContext,
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import {
  createSession,
  createJsonlStore,
  type SubagentRun,
  type SubagentIdentity,
} from "../../src/index.ts";
import { fakeModel } from "./fake-model.ts";

/** Real native driver checkpoints; close suspends them without inventing child records. */
export async function crashedSubagents(dirs: { cwd: string; homeDir: string }) {
  const plans = new Map<
    string,
    {
      outcome?: SubagentRun["outcome"];
      entered: ReturnType<typeof Promise.withResolvers<void>>;
      release: ReturnType<typeof Promise.withResolvers<void>>;
    }
  >();
  const spawned = new Set<string>();
  const response: Parameters<typeof fakeModel>[0][number] = async (context, options) => {
    const isParent = getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
      (tool) => tool.name === "subagent",
    );
    const last = context.messages.findLast((message) => message.role === "user");
    const text =
      last?.role === "user"
        ? typeof last.content === "string"
          ? last.content
          : last.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")
        : "";
    if (isParent) {
      if (text.startsWith("fixture:") && !spawned.has(text)) {
        spawned.add(text);
        const description = text.slice(8);
        return fauxAssistantMessage(
          fauxToolCall("subagent", {
            description,
            prompt: `child:${description}`,
            run_in_background: plans.get(description)?.outcome === undefined,
          }),
          { stopReason: "toolUse" },
        );
      }
      return fauxAssistantMessage("parent idle");
    }
    const plan = plans.get(text.slice(6));
    if (!plan) throw new Error(`Unknown child fixture input: ${text}`);
    plan.entered.resolve();
    if (plan.outcome === undefined)
      await awaitWithContext(
        plan.release.promise,
        options?.signal ? withAbortSignal(options.signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT,
      );
    return fauxAssistantMessage(
      "saved child answer",
      plan.outcome === "error"
        ? { stopReason: "error", errorMessage: "durable failure" }
        : plan.outcome === "aborted"
          ? { stopReason: "aborted" }
          : undefined,
    );
  };
  const fake = fakeModel(Array.from({ length: 200 }, () => response));
  const parent = await createSession({ ...dirs, ...fake });
  const requests: string[] = [];
  return {
    store: createJsonlStore(dirs),
    parentId: parent.id,
    get identities() {
      return parent.toolState("subagents") as SubagentIdentity[];
    },
    async child(description: string, outcome?: SubagentRun["outcome"]) {
      const plan = {
        outcome,
        entered: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>(),
      };
      plans.set(description, plan);
      await parent.run(`fixture:${description}`);
      await plan.entered.promise;
      const requestId = parent.currentRequestId;
      if (!requestId) throw new Error("Fixture request identity missing.");
      requests.push(requestId);
      const row = (parent.toolState("subagents") as SubagentIdentity[]).find(
        (row) => row.description === description,
      );
      if (!row?.latestRun) throw new Error("Fixture child identity missing.");
      return { metadata: { id: row.id }, run: row.latestRun, requestId };
    },
    requests,
    async save() {
      await parent.close();
      for (const plan of plans.values()) plan.release.resolve();
    },
  };
}

/** Preserve observation across the root receipt and the separately owned causal work. */
export async function runRequest(
  session: Awaited<ReturnType<typeof createSession>>,
  prompt: string,
  input: Parameters<Awaited<ReturnType<typeof createSession>>["run"]>[1] = {},
) {
  const off = input.onEvent
    ? session.subscribe((event) => {
        void input.onEvent!(event);
      })
    : () => {};
  try {
    await session.run(prompt, { ...input, onEvent: undefined });
    const id = session.currentRequestId;
    if (!id) throw new Error("Native request identity missing.");
    return await session.waitForRequest(id);
  } finally {
    off();
  }
}
