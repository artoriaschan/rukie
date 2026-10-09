import { requestIds } from "../../requests/index.ts";
import {
  defineDoc,
  defineTask,
  LiveDoc,
  InboxDoc,
  type SubmissionId,
  type Tx,
  type ConversationId,
} from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import type { RunResult } from "@rukie/shared";
import { Value } from "typebox/value";
import { Type } from "typebox";
import { goalSchema, goalState, type GoalSnapshot } from "./state.ts";
import { renderGoalRoundPrompt } from "./controller.ts";

const activationSchema = Type.Object(
  {
    taskId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    requestId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    countedRound: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export function readGoalActivation(value: unknown) {
  if (value === undefined) return { taskId: null, requestId: null, countedRound: 0 };
  if (!Value.Check(activationSchema, value) || (value.taskId !== null && value.requestId === null))
    throw new Error("Invalid Goal activation.");
  return value;
}
export const GoalActivationDoc = defineDoc<{
  taskId: number | null;
  requestId: string | null;
  countedRound: number;
}>({
  kind: "rukie.goal-activation",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ taskId: null, requestId: null, countedRound: 0 }),
});
/** Count a placed accepted input once; a reservation itself never consumes the budget. */
export function placedGoalRound(value: unknown, round: number) {
  if (
    !Value.Check(goalSchema, value) ||
    !Number.isSafeInteger(round) ||
    round < 1 ||
    round > value.maxRounds ||
    round > value.roundsStarted + 1
  )
    throw new Error("Invalid accepted Goal round placement.");
  return { ...value, roundsStarted: Math.max(round, value.roundsStarted) };
}
/** Human mutations preserve placement facts committed while their callback awaited admission revocation. */
export function preservePlacedGoalRounds(current: unknown, next: GoalSnapshot | null) {
  return next && Value.Check(goalSchema, current) && current.id === next.id
    ? { ...next, roundsStarted: Math.max(next.roundsStarted, current.roundsStarted) }
    : next;
}
/** Revocation and withdrawal share one native transaction; placed work keeps its result boundary. */
export async function revokeGoalActivation(tx: Tx, conversationId: ConversationId) {
  const active = await tx.doc(GoalActivationDoc, conversationId);
  if (active.taskId !== null && active.requestId !== null) {
    const queued = await tx.submissionByRequest(
      conversationId,
      goalRoundRequest(active.requestId, active.taskId, active.countedRound + 1),
    );
    if (queued?.status === "queued") {
      const inbox = await tx.doc(InboxDoc, conversationId);
      inbox.items = inbox.items.filter((item) => item.id !== queued.id);
      tx.settleSubmission(queued.id, {
        status: "unanswered",
        reason: "aborted",
        detail: "Goal continuation cancelled",
      });
    } else if (queued?.type === "input" && queued.entry) {
      const snapshot = await tx.doc(goalState.document, conversationId);
      if (snapshot.value !== null)
        snapshot.value = placedGoalRound(snapshot.value, active.countedRound + 1);
      active.countedRound += 1;
    }
  }
  active.taskId = null;
}
const goalRoundRequest = (requestId: string, taskId: number, round: number) =>
  requestIds.goalRound(requestId, Number(taskId), round);
type Input = { goalId: string; requestId: string; initialRound: number };
type State =
  | { phase: "admit"; round: number; result: RunResult }
  | { phase: "settle"; round: number; submissionId: SubmissionId; result: RunResult };
const emptyResult = (): RunResult => ({
  text: "",
  success: true,
  durationMs: 0,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
});

function appendResult(prior: RunResult, answered: RunResult): RunResult {
  const usage = { ...prior.usage };
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const)
    usage[key] += answered.usage[key];
  return { ...answered, usage, durationMs: prior.durationMs + answered.durationMs };
}

/** Durable admission and causal settlement; native Generation remains the only model executor. */
export function createGoalDriver(options: {
  submit(prompt: string, requestId: string, context: Context): Promise<SubmissionId>;
  settle(requestId: string, context: Context): Promise<RunResult>;
  settleCancelled(
    requestId: string,
    submissionId: SubmissionId,
    context: Context,
  ): Promise<RunResult>;
  recoverSubmission(requestId: string, context: Context): Promise<SubmissionId | undefined>;
}) {
  return defineTask<Input, State, RunResult>({
    name: "rukie.goal-driver",
    version: 1,
    initial: (input) => ({ phase: "admit", round: input.initialRound, result: emptyResult() }),
    phases: {
      async admit(task, runtime, context) {
        const requestId = goalRoundRequest(
          task.input.requestId,
          Number(task.id),
          task.state.checkpoint.round,
        );
        // A placed input still needs its receipt even when that round has since paused/completed the Goal.
        const existing = await options.recoverSubmission(requestId, context);
        if (existing) {
          await runtime.commit(
            () => ({
              status: "running",
              checkpoint: {
                phase: "settle",
                round: task.state.checkpoint.round,
                submissionId: existing,
                result: task.state.checkpoint.result,
              },
            }),
            context,
          );
          return;
        }
        // Do not preempt a Human/Hook Run or cancel a Goal mutation's own ToolResult.
        for (;;) {
          const live = await runtime.snapshot(LiveDoc, runtime.conversationId, context);
          if (!live?.run) break;
          await runtime.waitForTask(live.run.taskId, context);
        }
        const snapshot = await runtime.snapshot(
          goalState.document,
          runtime.conversationId,
          context,
        );
        const activation = readGoalActivation(
          await runtime.snapshot(GoalActivationDoc, runtime.conversationId, context),
        );
        const goal = snapshot?.value;
        if (
          !Value.Check(goalSchema, goal) ||
          goal.id !== task.input.goalId ||
          goal.phase !== "active" ||
          activation?.taskId !== Number(task.id)
        ) {
          await runtime.commit(
            () => ({
              status: "terminal",
              outcome: { status: "completed", result: task.state.checkpoint.result },
            }),
            context,
          );
          return;
        }
        if (task.state.checkpoint.round > goal.maxRounds) {
          await runtime.commit(async (tx) => {
            const owned = await tx.doc(goalState.document, runtime.conversationId);
            const active = await tx.doc(GoalActivationDoc, runtime.conversationId);
            const current = owned.value;
            if (
              !Value.Check(goalSchema, current) ||
              current.id !== task.input.goalId ||
              current.phase !== "active" ||
              active.taskId !== Number(task.id)
            )
              return {
                status: "terminal",
                outcome: { status: "completed", result: task.state.checkpoint.result },
              };
            if (task.state.checkpoint.round <= current.maxRounds)
              return { status: "running", checkpoint: task.state.checkpoint };
            owned.value = {
              ...current,
              phase: "blocked",
              blockedReason: `Goal reached its ${current.maxRounds} round limit. Start a new Goal to continue.`,
            };
            active.taskId = null;
            return {
              status: "terminal",
              outcome: { status: "completed", result: task.state.checkpoint.result },
            };
          }, context);
          return;
        }
        const round = task.state.checkpoint.round;
        const submissionId = await options.submit(
          renderGoalRoundPrompt({ ...goal, roundsStarted: round - 1, armed: true }),
          requestId,
          context,
        );
        await runtime.commit(
          () => ({
            status: "running",
            checkpoint: {
              phase: "settle",
              round,
              submissionId,
              result: task.state.checkpoint.result,
            },
          }),
          context,
        );
      },
      async settle(task, runtime, context) {
        const requestId = goalRoundRequest(
          task.input.requestId,
          Number(task.id),
          task.state.checkpoint.round,
        );
        const answered = await options.settle(requestId, context);
        const result = appendResult(task.state.checkpoint.result, answered);
        await runtime.commit(async (tx) => {
          const active = await tx.doc(GoalActivationDoc, runtime.conversationId);
          const snapshot = await tx.doc(goalState.document, runtime.conversationId);
          const goal = snapshot.value;
          if (
            !answered.success ||
            answered.stopReason ||
            !Value.Check(goalSchema, goal) ||
            goal.phase !== "active" ||
            active.taskId !== Number(task.id)
          ) {
            if (active.taskId === Number(task.id)) active.taskId = null;
            return { status: "terminal", outcome: { status: "completed", result } };
          }
          return {
            status: "running",
            checkpoint: { phase: "admit", round: task.state.checkpoint.round + 1, result },
          };
        }, context);
      },
    },
    async abort(task, runtime, context) {
      const requestId = goalRoundRequest(
        task.input.requestId,
        Number(task.id),
        task.state.checkpoint.round,
      );
      const submission =
        task.state.checkpoint.phase === "settle"
          ? task.state.checkpoint.submissionId
          : await options.recoverSubmission(requestId, context);
      const committed = submission
        ? appendResult(
            task.state.checkpoint.result,
            await options.settleCancelled(requestId, submission, context),
          )
        : task.state.checkpoint.result;
      const result = { ...committed, success: false, error: "Goal continuation cancelled" };
      await runtime.commit(async (tx) => {
        const active = await tx.doc(GoalActivationDoc, runtime.conversationId);
        if (active.taskId === Number(task.id)) active.taskId = null;
        return {
          status: "terminal",
          outcome: { status: "aborted", reason: "Goal continuation cancelled", result },
        };
      }, context);
    },
  });
}
