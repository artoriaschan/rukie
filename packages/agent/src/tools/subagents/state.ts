import type { ToolStateDefinition } from "../../tool-state/index.ts";

/** Durable facts for one child Run; an absent outcome has not been settled. */
export type SubagentRun = {
  id: string;
  sessionId: string;
  parentSessionId: string;
  startedAt: number;
  endedAt?: number;
  model?: string;
  durationMs?: number;
  tokens?: number;
  outcome?: "completed" | "aborted" | "error" | "length" | "hook_stopped" | "hook_blocked";
  error?: string;
  reason?: string;
};

function parseRun(value: unknown): SubagentRun {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("sessionId" in value) ||
    typeof value.sessionId !== "string" ||
    !("parentSessionId" in value) ||
    typeof value.parentSessionId !== "string" ||
    !("startedAt" in value) ||
    typeof value.startedAt !== "number" ||
    !Number.isFinite(value.startedAt)
  )
    throw new Error("Invalid subagent Run fact.");
  const run: SubagentRun = {
    id: value.id,
    sessionId: value.sessionId,
    parentSessionId: value.parentSessionId,
    startedAt: value.startedAt,
  };
  if ("outcome" in value && value.outcome !== undefined) {
    if (
      typeof value.outcome !== "string" ||
      !["completed", "aborted", "error", "length", "hook_stopped", "hook_blocked"].includes(
        String(value.outcome),
      ) ||
      !("endedAt" in value) ||
      typeof value.endedAt !== "number" ||
      !Number.isFinite(value.endedAt)
    )
      throw new Error("Invalid subagent Run outcome.");
    run.outcome = value.outcome as SubagentRun["outcome"];
    run.endedAt = value.endedAt;
  }
  for (const key of ["durationMs", "tokens"] as const) {
    const number = Reflect.get(value, key);
    if (number !== undefined) {
      if (typeof number !== "number" || !Number.isFinite(number) || number < 0)
        throw new Error("Invalid subagent Run metric.");
      run[key] = number;
    }
  }
  const model = Reflect.get(value, "model");
  if (model !== undefined) {
    if (typeof model !== "string") throw new Error("Invalid subagent Run model.");
    run.model = model;
  }
  for (const key of ["error", "reason"] as const) {
    const reason = Reflect.get(value, key);
    if (reason !== undefined) {
      if (typeof reason !== "string") throw new Error("Invalid subagent Run reason.");
      run[key] = reason;
    }
  }
  return run;
}

export const subagentRunState: ToolStateDefinition = {
  name: "subagent-run",
  version: 1,
  parse(version, value) {
    if (version !== 1) throw new Error("Invalid subagent Run version.");
    return { ...parseRun(value) };
  },
};

export function subagentsState(parentSessionId: string): ToolStateDefinition {
  return {
    name: "subagents",
    version: 2,
    parse(version, value) {
      if ((version !== 1 && version !== 2) || !Array.isArray(value))
        throw new Error("Invalid subagents snapshot.");
      return value.map((row) => {
        if (
          !row ||
          typeof row.id !== "string" ||
          typeof row.description !== "string" ||
          typeof row.type !== "string"
        )
          throw new Error("Invalid subagents snapshot.");
        const identity = { id: row.id, description: row.description, type: row.type };
        if (version === 1 || row.latestRun === undefined) return identity;
        const run = parseRun(row.latestRun);
        if (run.sessionId !== row.id) throw new Error("Subagent Run belongs to another Session.");
        return run.parentSessionId === parentSessionId
          ? { ...identity, latestRun: { ...run } }
          : identity;
      });
    },
  };
}

export type SubagentIdentity = {
  id: string;
  description: string;
  type: string;
  latestRun?: SubagentRun;
};
