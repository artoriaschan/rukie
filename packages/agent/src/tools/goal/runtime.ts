import type { Context } from "@earendil-works/chord";
import type { Harness, Storage, Conversation, CommitChange } from "@earendil-works/pi-durable";
import {
  goalRoundNumber,
  isGoalRound,
  requestIds,
  requestKind,
  type createRequestLedger,
} from "../../requests/index.ts";
import {
  createGoalDriver,
  GoalActivationDoc,
  readGoalActivation,
  placedGoalRound,
  preservePlacedGoalRounds,
  revokeGoalActivation,
} from "./driver.ts";
import { goalState, type GoalSnapshot } from "./state.ts";

/** Goal owns continuation facts; Session supplies admission and receipt adapters at its fixed hook positions. */
export function createGoalRuntime(
  options: {
    harness: Harness;
    storage: Storage;
    conversation(): Conversation;
    context: Context;
    ledger(): Pick<
      ReturnType<typeof createRequestLedger>,
      "bind" | "registerSubmission" | "currentRequestId" | "setForeground"
    >;
  } & Omit<Parameters<typeof createGoalDriver>[0], "recoverSubmission">,
) {
  const { harness, storage, context } = options;
  const conversation = () => options.conversation();
  let activationTask: number | null = null;
  // The last accepted Request remains addressable after its activation is disarmed.
  let acceptedRequest: string | undefined;
  let wrapup: string | undefined;
  const driver = createGoalDriver({
    submit: options.submit,
    settle: options.settle,
    settleCancelled: options.settleCancelled,
    recoverSubmission: async (requestId, ctx) => {
      const inputs = await storage.scanSubmissions({}, 100000, undefined, ctx);
      const found = inputs.items.find(
        (input) => input.conversationId === conversation().id && input.requestId === requestId,
      );
      if (!found) return undefined;
      await options.ledger().registerSubmission(requestId, found.id);
      if (found.entry)
        await conversation().commit(
          (tx) =>
            tx.appendEntry(conversation().id, {
              kind: "rukie.message-facts",
              model: [],
              data: { entryId: Number(found.entry), source: "goal" },
            }),
          ctx,
        );
      return found.id;
    },
  });
  async function abort(ctx: Context = context) {
    const active = await harness.snapshot(GoalActivationDoc, conversation().id, ctx);
    if (!active?.taskId) return;
    const tasks = (await storage.scanTasks({}, 100000, undefined, ctx)).items;
    const task = tasks.find(
      (task) => Number(task.id) === active.taskId && task.kind === "rukie.goal-driver",
    );
    if (task) await harness.abortTask(task.id, ctx);
  }
  return {
    extension: { name: "rukie.goal-runtime", tasks: [driver] },
    get activation() {
      return { taskId: activationTask, requestId: acceptedRequest };
    },
    isArmed: () => activationTask !== null,
    async restore(goalFact: unknown) {
      const activation = readGoalActivation(
        await harness.snapshot(GoalActivationDoc, conversation().id, context),
      );
      if (activation.taskId !== null) {
        const tasks = (await storage.scanTasks({}, 100000, undefined, context)).items;
        const accepted = tasks.find((task) => Number(task.id) === activation.taskId);
        const input = accepted?.input;
        if (
          !accepted ||
          accepted.kind !== "rukie.goal-driver" ||
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          input.requestId !== activation.requestId ||
          !goalFact ||
          typeof goalFact !== "object" ||
          Array.isArray(goalFact) ||
          !("id" in goalFact) ||
          input.goalId !== goalFact.id
        )
          throw new Error("Invalid Goal activation task.");
        if (accepted.state.status === "terminal") {
          await conversation().commit(async (tx) => {
            (await tx.doc(GoalActivationDoc, conversation().id)).taskId = null;
          }, context);
          activation.taskId = null;
        }
      }
      activationTask = activation.taskId;
      acceptedRequest = activation.requestId ?? undefined;
    },
    observe(change: CommitChange) {
      if (
        change.type === "document" &&
        change.conversationId === conversation().id &&
        change.record.kind === "rukie.goal-activation"
      ) {
        const task = change.value?.taskId;
        activationTask = typeof task === "number" ? task : null;
      }
    },
    async persist(value: GoalSnapshot | null, armed: boolean) {
      const ledger = options.ledger();
      const humanCause =
        requestKind(ledger.currentRequestId) === "human" ? ledger.currentRequestId : undefined;
      let created: string | undefined;
      if (!armed && (value === null || value.phase === "paused")) await abort();
      activationTask = await conversation().commit(async (tx) => {
        const active = await tx.doc(GoalActivationDoc, conversation().id);
        const snapshot = await tx.doc(goalState.document, conversation().id);
        snapshot.value = preservePlacedGoalRounds(snapshot.value, value);
        if (armed && value && active.taskId === null) {
          const requestId = requestIds.goalActivation(value.id);
          const taskId = await tx.createTask(
            driver,
            { goalId: value.id, requestId, initialRound: value.roundsStarted + 1 },
            { ownership: { kind: "conversation" }, conversationId: conversation().id },
          );
          active.taskId = Number(taskId);
          active.requestId = requestId;
          active.countedRound = value.roundsStarted;
          await ledger.bind(tx, requestId, { taskId: Number(taskId), replace: true });
          if (humanCause)
            await ledger.bind(tx, humanCause, { taskId: Number(taskId), onlyExisting: true });
          created = requestId;
        } else if (!armed) await revokeGoalActivation(tx, conversation().id);
        return active.taskId;
      }, context);
      if (created) {
        acceptedRequest = created;
        if (!humanCause) ledger.setForeground(created);
      }
    },
    async beforeRequest(inputs: readonly ({ requestId?: string } | undefined)[], ctx: Context) {
      const isRound = inputs.some((record) => requestKind(record?.requestId) === "goal-round");
      const activation = await harness.snapshot(GoalActivationDoc, conversation().id, ctx);
      const input =
        activation?.taskId && activation.requestId
          ? inputs.find((record) =>
              isGoalRound(record?.requestId, activation.requestId!, activation.taskId!),
            )
          : undefined;
      if (input?.requestId) {
        const round = goalRoundNumber(input.requestId);
        if (!Number.isSafeInteger(round) || round < 1)
          throw new Error("Invalid accepted Goal round identity.");
        await conversation().commit(async (tx) => {
          const active = await tx.doc(GoalActivationDoc, conversation().id);
          const snapshot = await tx.doc(goalState.document, conversation().id);
          if (
            active.taskId === activation!.taskId &&
            active.countedRound < round &&
            snapshot.value &&
            typeof snapshot.value === "object" &&
            !Array.isArray(snapshot.value)
          ) {
            snapshot.value = placedGoalRound(snapshot.value, round);
            active.countedRound = round;
          }
        }, ctx);
      }
      return isRound;
    },
    queueWrapup(text: string) {
      wrapup = text;
    },
    async prepareWrapup(ctx: Context) {
      if (!wrapup) return;
      const content = wrapup;
      await conversation().commit(async (tx) => {
        const placed = await tx.appendEntry(conversation().id, {
          kind: "rukie.goal-wrapup",
          model: [
            { role: "user", content: [{ type: "text", text: content }], timestamp: Date.now() },
          ],
        });
        await tx.appendEntry(conversation().id, {
          kind: "rukie.message-facts",
          data: { entryId: Number(placed.id), source: "goal" },
        });
      }, ctx);
      wrapup = undefined;
    },
    async yieldWrapup(taskId: number, ctx: Context) {
      if (!wrapup) return undefined;
      const content = wrapup;
      wrapup = undefined;
      await conversation().commit(
        (tx) =>
          tx.appendEntry(conversation().id, {
            kind: "rukie.message-facts",
            data: { taskId, content, source: "goal" },
          }),
        ctx,
      );
      return { continue: content };
    },
    async clearActivation(ctx: Context) {
      await conversation().commit(async (tx) => {
        const active = await tx.doc(GoalActivationDoc, conversation().id);
        active.taskId = null;
        active.requestId = null;
      }, ctx);
      activationTask = null;
    },
    abort,
  };
}
