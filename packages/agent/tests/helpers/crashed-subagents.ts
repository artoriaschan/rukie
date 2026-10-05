import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { createJsonlStore, type SubagentRun, type SubagentIdentity } from "../../src/index.ts";

/** Legal durable records at a crash window, independent of Session disposal. */
export async function crashedSubagents(dirs: { cwd: string; homeDir: string }) {
  const store = createJsonlStore(dirs);
  const parent = await store.create({ cwd: dirs.cwd }, context);
  const branch = await parent.createBranch("main", null, context);
  const identities: SubagentIdentity[] = [];
  return {
    store,
    parentId: parent.metadata.id,
    async child(description: string, outcome?: SubagentRun["outcome"]) {
      const child = await store.create(
        { cwd: dirs.cwd, parentSessionId: parent.metadata.id },
        context,
      );
      const childBranch = await child.createBranch("main", null, context);
      const run: SubagentRun = {
        id: crypto.randomUUID(),
        sessionId: child.metadata.id,
        parentSessionId: parent.metadata.id,
        startedAt: 10,
      };
      await childBranch.appendCustomEntry(
        "tool-state/subagent-run",
        { version: 1, value: run },
        context,
      );
      if (outcome)
        await childBranch.appendCustomEntry(
          "tool-state/subagent-run",
          {
            version: 1,
            value: {
              ...run,
              endedAt: 20,
              outcome,
              ...(outcome === "error" && { error: "durable failure" }),
            },
          },
          context,
        );
      identities.push({
        id: child.metadata.id,
        description,
        type: "general-purpose",
        latestRun: run,
      });
      await child.close(context);
      return { metadata: child.metadata, run };
    },
    async save() {
      await branch.appendCustomEntry(
        "tool-state/subagents",
        { version: 2, value: identities },
        context,
      );
      await parent.close(context);
    },
    identities,
  };
}
