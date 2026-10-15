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
  type GoalInitialInput,
} from "./driver.ts";
import { Value } from "typebox/value";
import { goalState, goalSchema, settleGoalTime, type GoalSnapshot } from "./state.ts";

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
  let humanRequest: string | undefined;
  // The last accepted Request remains addressable after its activation is disarmed.
  let acceptedRequest: string | undefined;
  let wrapup: string | undefined;
  const driver = createGoalDriver({
    submit: options.submit,
    now: options.now,
    settle: options.settle,
    settleCancelled: options.settleCancelled,
    recoverSubmission: async (requestId, ctx, initialInput) => {
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
              data: {
                entryId: Number(found.entry),
                ...(initialInput
                  ? {
                      imageNames: initialInput.images.map((image) => image.name ?? null),
                      goalBeforeCreate: initialInput.previousGoal ?? null,
                    }
                  : { source: "goal" }),
              },
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
    isHumanInput: (requestId: string | undefined) => !!requestId && requestId === humanRequest,
    async restore(goalFact: unknown) {
      humanRequest = undefined;
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
        humanRequest =
          input.initialInput && activation.requestId
            ? requestIds.goalRound(activation.requestId, activation.taskId, 1)
            : undefined;
        if (accepted.state.status === "terminal") {
          await conversation().commit(async (tx) => {
            (await tx.doc(GoalActivationDoc, conversation().id)).taskId = null;
          }, context);
          activation.taskId = null;
        }
      }
      activationTask = activation.taskId;
      acceptedRequest = activation.requestId ?? undefined;
      if (Value.Check(goalSchema, goalFact)) {
        const { activeSince: _activeSince, ...snapshot } = goalFact;
        // Recovery may continue an accepted driver, but host downtime never counts.
        await conversation().commit(async (tx) => {
          (await tx.doc(goalState.document, conversation().id)).value = {
            ...snapshot,
            ...(activationTask !== null ? { activeSince: options.now?.() ?? Date.now() } : {}),
          };
        }, context);
      }
    },
    async fork(child: Conversation, ctx: Context) {
      const inherited = await harness.snapshot(goalState.document, child.id, ctx);
      if (!Value.Check(goalSchema, inherited?.value)) return;
      const current = await harness.snapshot(goalState.document, conversation().id, ctx);
      const { activeSince: _activeSince, ...snapshot } = inherited.value;
      await child.commit(async (tx) => {
        (await tx.doc(goalState.document, child.id)).value = {
          ...snapshot,
          elapsedMs:
            Value.Check(goalSchema, current?.value) && current.value.id === snapshot.id
              ? current.value.elapsedMs
              : snapshot.elapsedMs,
        };
      }, ctx);
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
    async persist(value: GoalSnapshot | null, armed: boolean, initialInput?: GoalInitialInput) {
      const ledger = options.ledger();
      const humanCause =
        requestKind(ledger.currentRequestId) === "human" ? ledger.currentRequestId : undefined;
      let created: string | undefined;
      if (!armed && (value === null || value.phase === "paused")) await abort();
      activationTask = await conversation().commit(async (tx) => {
        const active = await tx.doc(GoalActivationDoc, conversation().id);
        const snapshot = await tx.doc(goalState.document, conversation().id);
        const previousGoal = Value.Check(goalSchema, snapshot.value) ? { ...snapshot.value } : null;
        snapshot.value = preservePlacedGoalRounds(
          snapshot.value,
          value && settleGoalTime(value, options.now?.() ?? Date.now(), armed),
        );
        if (armed && value && active.taskId === null) {
          const requestId = requestIds.goalActivation(value.id);
          const taskId = await tx.createTask(
            driver,
            {
              goalId: value.id,
              requestId,
              initialRound: value.roundsStarted + 1,
              ...(initialInput
                ? {
                    initialInput: {
                      ...initialInput,
                      // Native image tags let desktop storage reuse its external attachment mapping.
                      images: initialInput.images.map((image) => ({ ...image, type: "image" })),
                      previousGoal,
                    },
                  }
                : {}),
            },
            { ownership: { kind: "conversation" }, conversationId: conversation().id },
          );
          active.taskId = Number(taskId);
          if (initialInput) humanRequest = requestIds.goalRound(requestId, Number(taskId), 1);
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
        const snapshot = await tx.doc(goalState.document, conversation().id);
        if (Value.Check(goalSchema, snapshot.value))
          snapshot.value = settleGoalTime(snapshot.value, options.now?.() ?? Date.now(), false);
      }, ctx);
      activationTask = null;
    },
    abort,
  };
}
