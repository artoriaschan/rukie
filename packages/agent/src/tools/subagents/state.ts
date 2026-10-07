import { defineToolState, type ToolStateDefinition } from "../../tool-state/index.ts";

/** Durable facts for one child Run; an absent outcome has not been settled. */
export type SubagentRun = {
  id: string;
  sessionId: string;
  parentSessionId: string;
  startedAt: number;
  promptEntryId?: number;
  /** The driver's original input was durably admitted before later steering. */
  inputSubmissionId?: number;
  answerEntryId?: number;
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
  for (const key of ["promptEntryId", "answerEntryId", "inputSubmissionId"] as const) {
    const entry = Reflect.get(value, key);
    if (entry !== undefined) {
      if (typeof entry !== "number" || !Number.isSafeInteger(entry))
        throw new Error("Invalid native subagent entry identity.");
      run[key] = entry;
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

export const subagentRunState: ToolStateDefinition = defineToolState({
  history: "rewindable",
  fork: "asOf",
  name: "subagent-run",
  version: 1,
  parse(version, value) {
    if (version !== 1) throw new Error("Invalid subagent Run version.");
    return { ...parseRun(value) };
  },
});

/** One logical child identity; each run has a separately owned native Conversation. */
export type SubagentIdentity = {
  id: string;
  description: string;
  type: string;
  conversationId: number;
  driverTaskId: number;
  originToolTaskId: number;
  active: boolean;
  latestRun?: SubagentRun;
};

export function parseSubagentIdentities(
  value: unknown,
  parentSessionId: string,
): SubagentIdentity[] {
  if (!Array.isArray(value)) throw new Error("Invalid subagent directory.");
  return value.map((row: unknown) => {
    if (
      !row ||
      typeof row !== "object" ||
      !("id" in row) ||
      typeof row.id !== "string" ||
      !("description" in row) ||
      typeof row.description !== "string" ||
      !("type" in row) ||
      typeof row.type !== "string" ||
      !("conversationId" in row) ||
      typeof row.conversationId !== "number" ||
      !Number.isSafeInteger(row.conversationId) ||
      !("driverTaskId" in row) ||
      typeof row.driverTaskId !== "number" ||
      !Number.isSafeInteger(row.driverTaskId) ||
      !("originToolTaskId" in row) ||
      typeof row.originToolTaskId !== "number" ||
      !Number.isSafeInteger(row.originToolTaskId) ||
      !("active" in row) ||
      typeof row.active !== "boolean"
    )
      throw new Error("Invalid subagent directory row.");
    const identity: SubagentIdentity = {
      id: row.id,
      description: row.description,
      type: row.type,
      conversationId: row.conversationId,
      driverTaskId: row.driverTaskId,
      originToolTaskId: row.originToolTaskId,
      active: row.active,
    };
    if ("latestRun" in row && row.latestRun !== undefined) {
      const run = parseRun(row.latestRun);
      if (run.sessionId !== identity.id || run.parentSessionId !== parentSessionId)
        throw new Error("Subagent Run belongs to another parent or identity.");
      identity.latestRun = run;
    }
    return identity;
  });
}

export function subagentsState(parentSessionId: string): ToolStateDefinition {
  return defineToolState({
    history: "latest",
    fork: "initial",
    name: "subagents",
    version: 3,
    parse(version, value) {
      if (version !== 3) throw new Error("Invalid subagent directory version.");
      return parseSubagentIdentities(value, parentSessionId);
    },
  });
}
