import { randomUUID } from "node:crypto";

/**
 * Typed Request identity. The string encoding is persisted in native submissions and the
 * `rukie.requests` document, so every format below must stay readable by Session Resume.
 */
export type RequestIdentity =
  | { kind: "human"; id: string }
  | { kind: "hook"; id: string }
  | { kind: "job"; id: string }
  | { kind: "goal-activation"; id: string }
  | { kind: "goal-round"; id: string; activation: string; taskId: number; round: number }
  | { kind: "subagent-input"; id: string; taskId: number }
  | { kind: "subagent-report"; id: string; taskId: number }
  | { kind: "subagent-send"; id: string; toolTaskId: number }
  | { kind: "unknown"; id: string };
export type RequestKind = RequestIdentity["kind"];

const GOAL_ROUND = /^(goal:.+):round:(\d+):(\d+)$/;
const SUBAGENT = /^subagent:(\d+):(input|report)$/;
const SUBAGENT_SEND = /^subagent-send:(\d+)$/;

export function parseRequestId(id: string): RequestIdentity {
  const round = GOAL_ROUND.exec(id);
  if (round)
    return {
      kind: "goal-round",
      id,
      activation: round[1]!,
      taskId: Number(round[2]),
      round: Number(round[3]),
    };
  if (id.startsWith("goal:")) return { kind: "goal-activation", id };
  if (id.startsWith("human:")) return { kind: "human", id };
  if (id.startsWith("hook:")) return { kind: "hook", id };
  if (id.startsWith("job:")) return { kind: "job", id };
  const subagent = SUBAGENT.exec(id);
  if (subagent)
    return {
      kind: subagent[2] === "input" ? "subagent-input" : "subagent-report",
      id,
      taskId: Number(subagent[1]),
    };
  const send = SUBAGENT_SEND.exec(id);
  if (send) return { kind: "subagent-send", id, toolTaskId: Number(send[1]) };
  return { kind: "unknown", id };
}

/** Kind of an optional native submission identity; absent identities have no kind. */
export function requestKind(id: string | undefined): RequestKind | undefined {
  return id === undefined ? undefined : parseRequestId(id).kind;
}

export const requestIds = {
  human: () => `human:${randomUUID()}`,
  /** A scope separates hook continuations admitted to one child Conversation. */
  hook: (scope?: string) => `hook:${scope === undefined ? "" : `${scope}:`}${randomUUID()}`,
  job: (jobId: string, startedAt: number) => `job:${jobId}:${startedAt}`,
  jobStopped: (jobId: string, startedAt: number) => `job:stopped:${jobId}:${startedAt}`,
  goalActivation: (goalId: string) => `goal:${goalId}:activation:${randomUUID()}`,
  goalRound: (activation: string, taskId: number, round: number) =>
    `${activation}:round:${taskId}:${round}`,
  subagentInput: (taskId: number) => `subagent:${taskId}:input`,
  subagentReport: (taskId: number) => `subagent:${taskId}:report`,
  subagentSend: (toolTaskId: number) => `subagent-send:${toolTaskId}`,
};
