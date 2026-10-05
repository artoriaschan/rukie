import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import type { SessionStore } from "../store/index.ts";
import { createToolState } from "../tool-state/index.ts";
import { subagentRunState, type SubagentIdentity, type SubagentRun } from "../subagents/index.ts";

interface RecoveredSubagent {
  id: string;
  description: string;
  type: string;
  runId?: string;
  outcome: NonNullable<SubagentRun["outcome"]> | "unknown" | "interrupted";
  reason?: string;
  diagnostic?: "unconfirmed";
}

export interface SessionRecovery {
  readonly subagents: readonly RecoveredSubagent[];
  /** Current-branch history, including completed Runs confirmed during observation. */
  readonly history?: readonly RecoveredSubagent[];
}

export async function reconcileSubagents(
  identities: readonly SubagentIdentity[] | undefined,
  store: SessionStore,
  cwd: string,
  parentId: string,
): Promise<SessionRecovery> {
  const history: RecoveredSubagent[] = [];
  for (const child of identities ?? []) {
    const pending = child.latestRun;
    let run = pending;
    let outcome: RecoveredSubagent["outcome"] = run?.outcome ?? "unknown";
    let diagnostic: RecoveredSubagent["diagnostic"];
    if (pending && !pending.outcome) {
      try {
        if (!store.openReadonly || !store.find)
          throw new Error("Store has no read-only observation capability.");
        const metadata = await store.find(child.id, { cwd }, BACKGROUND_CONTEXT);
        if (!metadata || metadata.cwd !== cwd || metadata.parentSessionId !== parentId)
          throw new Error("Child Session ownership could not be confirmed.");
        const observed = await store.openReadonly(metadata, BACKGROUND_CONTEXT);
        try {
          const branch = await observed.branch("main", BACKGROUND_CONTEXT);
          if (!branch) throw new Error("Child has no current branch.");
          const entries = await branch.findEntries(
            { type: "custom", customType: "tool-state/subagent-run", order: "oldestFirst" },
            BACKGROUND_CONTEXT,
          );
          const facts = createToolState([subagentRunState], entries, (warning) => {
            throw new Error(warning);
          });
          const fact = facts.get("subagent-run") as SubagentRun | undefined;
          if (
            !fact ||
            fact.id !== pending.id ||
            fact.sessionId !== child.id ||
            fact.parentSessionId !== parentId ||
            fact.startedAt !== pending.startedAt
          )
            throw new Error("Child Run association could not be confirmed.");
          run = fact;
          outcome = fact.outcome ?? "interrupted";
        } finally {
          await observed.close(BACKGROUND_CONTEXT);
        }
      } catch {
        outcome = "unknown";
        diagnostic = "unconfirmed";
      }
    }
    history.push({
      id: child.id,
      description: child.description,
      type: child.type,
      ...(pending && { runId: pending.id }),
      outcome,
      ...((run?.reason ?? run?.error) && { reason: run?.reason ?? run?.error }),
      ...(diagnostic && { diagnostic }),
    });
  }
  return { history, subagents: history.filter((child) => child.outcome !== "completed") };
}

export function recoverySummary(recovery: SessionRecovery): string {
  return (
    "Session Resume: these historical subagent Runs need attention. They were not automatically resumed. An ended Run does not mean the delegated task is completed. Check the saved work and actual state; use send_message with the original subagent id if you decide to continue.\n" +
    recovery.subagents
      .map(
        (child) =>
          `${child.id} (${child.description}): ${child.outcome}${child.reason ? ` — ${child.reason}` : ""}${child.diagnostic ? " — unable to confirm the saved child Run" : ""}`,
      )
      .join("\n")
  );
}
