import type { Context, JsonValue } from "@earendil-works/chord";
import {
  defineDoc,
  LiveDoc,
  type Harness,
  type Storage,
  type Conversation,
  type EntryRecord,
  type SubmissionId,
} from "@earendil-works/pi-durable";
import type { Message } from "@earendil-works/pi-ai";
import type { RunResult } from "@rukie/shared";
import { parseRequestId, requestKind } from "./identity.ts";
export { parseRequestId, requestIds, requestKind } from "./identity.ts";
export type RequestResult = RunResult & { requestId: string };
const RequestDoc = defineDoc<{
  requests: Record<
    string,
    { submissions: number[]; tasks: number[]; startedAt: number; result: JsonValue | null }
  >;
}>({
  kind: "rukie.requests",
  version: 1,
  scope: "session",
  initial: () => ({ requests: {} }),
});
const PlanTakeoverDoc = defineDoc<{ requests: Record<string, true> }>({
  kind: "rukie.plan-takeovers",
  version: 1,
  scope: "session",
  initial: () => ({ requests: {} }),
});
const HookStopsDoc = defineDoc<{ requests: Record<string, string> }>({
  kind: "rukie.hook-stops",
  version: 1,
  scope: "session",
  initial: () => ({ requests: {} }),
});
const textOf = (message: Message): string => {
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
};
const zeroUsage = (): RunResult["usage"] => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
});

export function storedRequestResult(value: JsonValue | null): RequestResult | undefined {
  if (value === null) return;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.requestId !== "string" ||
    typeof value.text !== "string" ||
    typeof value.success !== "boolean" ||
    typeof value.durationMs !== "number" ||
    !value.usage ||
    typeof value.usage !== "object" ||
    Array.isArray(value.usage)
  )
    throw new Error("Invalid persisted request result.");
  const usage = zeroUsage();
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
    const count = value.usage[key];
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0)
      throw new Error("Invalid persisted request usage.");
    usage[key] = count;
  }
  if (value.error !== undefined && typeof value.error !== "string")
    throw new Error("Invalid persisted request error.");
  return {
    ...(value.stopReason === "hook_blocked" || value.stopReason === "hook_stopped"
      ? { stopReason: value.stopReason }
      : {}),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    requestId: value.requestId,
    text: value.text,
    success: value.success,
    durationMs: value.durationMs,
    usage,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

export function createRequestLedger(options: {
  harness: Harness;
  storage: Storage;
  context: Context;
  conversation: () => Conversation;
  history: () => Promise<EntryRecord[]>;
  flush: () => Promise<void>;
  updateContext: (messages: readonly Message[]) => void;
  fault: Promise<never>;
  assertAvailable: () => void;
  publish: (result: RequestResult) => void;
  goalReceipt: (value: JsonValue | undefined, requestId: string) => RequestResult | undefined;
  subagentReceipt: (value: JsonValue | undefined) => {
    parentAnswer?: number;
    usage: RunResult["usage"];
  };
}) {
  const { harness, storage, context, assertAvailable } = options;
  const lease = { storage };
  const fullHistory = options.history;
  const storageFault = { promise: options.fault };
  const observation = { flush: options.flush };
  const published = new Set<string>();
  const publishSettled = (result: RequestResult) => {
    if (requestKind(result.requestId) === "goal-round" || published.has(result.requestId)) return;
    published.add(result.requestId);
    options.publish(result);
  };
  let currentRequestId: string | undefined;
  const requestWaiters = new Map<string, Promise<RequestResult>>();
  const readRequest = async (requestId: string) =>
    (await harness.snapshot(RequestDoc, context))?.requests[requestId];
  async function bind(
    tx: Parameters<Parameters<Harness["commit"]>[0]>[0],
    requestId: string,
    input: { submissionId?: number; taskId?: number; replace?: boolean; onlyExisting?: boolean },
  ) {
    const doc = await tx.doc(RequestDoc);
    if (input.onlyExisting && !doc.requests[requestId]) return;
    if (input.replace || !doc.requests[requestId])
      doc.requests[requestId] = { submissions: [], tasks: [], startedAt: Date.now(), result: null };
    const request = doc.requests[requestId]!;
    if (input.submissionId !== undefined && !request.submissions.includes(input.submissionId))
      request.submissions.push(input.submissionId);
    if (input.taskId !== undefined && !request.tasks.includes(input.taskId))
      request.tasks.push(input.taskId);
  }
  const registerSubmission = (requestId: string, submissionId: SubmissionId) =>
    harness.commit((tx) => bind(tx, requestId, { submissionId: Number(submissionId) }), context);
  async function recordResult(
    tx: Parameters<Parameters<Harness["commit"]>[0]>[0],
    result: RequestResult,
  ) {
    await bind(tx, result.requestId, {});
    (await tx.doc(RequestDoc)).requests[result.requestId]!.result = {
      ...result,
      usage: { ...result.usage },
    };
  }
  async function recordOutcome(
    tx: Parameters<Parameters<Harness["commit"]>[0]>[0],
    conversationId: Conversation["id"],
    fact: { kind: "hook-stop"; reason: string } | { kind: "plan-takeover" },
    caller = context,
  ) {
    const live = await tx.doc(LiveDoc, conversationId);
    const first = live?.run?.inputs[0];
    const input = first === undefined ? undefined : await storage.submission(first, caller);
    if (!input?.requestId) return;
    if (fact.kind === "hook-stop")
      (await tx.doc(HookStopsDoc)).requests[input.requestId] = fact.reason;
    else (await tx.doc(PlanTakeoverDoc)).requests[input.requestId] = true;
  }
  const receiptEntries = async (
    receipt: import("@earendil-works/pi-durable").SettledSubmissionRecord,
  ) => {
    if (receipt.type !== "input" || !receipt.entry) return [];
    const history = await fullHistory();
    const nextInput =
      receipt.status === "done"
        ? undefined
        : history.find((entry) => entry.id > receipt.entry! && entry.kind === "input");
    const end = receipt.status === "done" ? receipt.answer : nextInput?.id;
    return history.filter(
      (entry) =>
        entry.id >= receipt.entry! &&
        (end === undefined || (receipt.status === "done" ? entry.id <= end : entry.id < end)),
    );
  };
  const entryUsage = (entries: Iterable<EntryRecord>) => {
    const usage = zeroUsage();
    for (const entry of entries)
      for (const message of entry.model ?? [])
        if (message.role === "assistant")
          for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const)
            usage[key] += message.usage[key];
    return usage;
  };
  const resultFor = async (
    requestId: string,
    submissionId: SubmissionId,
  ): Promise<RequestResult> => {
    const submission = await harness.submission(submissionId, context);
    if (!submission) throw new Error(`Request submission missing: ${requestId}`);
    const receipt = await Promise.race([submission.wait(context), storageFault.promise]);

    const view = await options.conversation().context(context);
    options.updateContext(view.messages);
    const entries = await receiptEntries(receipt);
    const usage = entryUsage(entries);
    const answer =
      receipt.status === "done" && receipt.type === "input"
        ? await lease.storage.entry(receipt.answer, context)
        : undefined;
    const terminal =
      (answer?.entry.model ?? []).findLast((message) => message.role === "assistant") ??
      entries
        .flatMap((entry) => entry.model ?? [])
        .findLast((message) => message.role === "assistant");
    const text =
      (answer?.entry.model ?? (terminal ? [terminal] : undefined))
        ?.filter((message) => message.role === "assistant")
        .map(textOf)
        .join("") ?? "";
    const request = await readRequest(requestId);
    await observation.flush();
    return assembleSubmissionResult({
      requestId,
      receipt,
      terminal,
      text,
      usage,
      durationMs: Date.now() - (request?.startedAt ?? Date.now()),
      takeover: !!(await harness.snapshot(PlanTakeoverDoc, context))?.requests[requestId],
      persistedStop: (await harness.snapshot(HookStopsDoc, context))?.requests[requestId],
    });
  };
  /** Follow committed native ownership and accepted steer identities, including multiple callers. */
  async function requestCausesForTasks(
    tasks: readonly import("@earendil-works/pi-durable").TaskRecord<
      JsonValue,
      JsonValue,
      JsonValue
    >[],
  ) {
    const requests = (await harness.snapshot(RequestDoc, context))?.requests ?? {};
    const submissions = (await lease.storage.scanSubmissions({}, 100000, undefined, context)).items;
    const conversations = (await lease.storage.scanConversations({}, 100000, undefined, context))
      .items;
    const byId = new Map(tasks.map((record) => [Number(record.id), record]));
    return (task: (typeof tasks)[number]) => {
      const found = new Set<string>();
      const pending = [Number(task.id)];
      const visited = new Set<number>();
      while (pending.length) {
        const id = pending.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const current = byId.get(id);
        if (!current) continue;
        for (const [requestId, request] of Object.entries(requests))
          if (request.tasks.includes(id)) found.add(requestId);
        const input: JsonValue = current.input;
        const origin =
          input &&
          typeof input === "object" &&
          !Array.isArray(input) &&
          typeof input.originToolTaskId === "number"
            ? input.originToolTaskId
            : undefined;
        if (current.owner !== undefined) pending.push(Number(current.owner));
        if (origin !== undefined) pending.push(origin);
        if (current.kind === "rukie.subagent-driver") {
          // The child Conversation owner fixes which driver accepted this input. A provider callId
          // is not a causal edge: only the committed native ToolTask-derived request identity is.
          const children = new Set(
            conversations
              .filter((child) => Number(child.owner?.taskId) === id)
              .map((child) => Number(child.id)),
          );
          for (const submission of submissions) {
            if (!children.has(Number(submission.conversationId))) continue;
            const send = parseRequestId(submission.requestId ?? "");
            if (send.kind === "subagent-send") pending.push(send.toolTaskId);
          }
        }
      }
      return found;
    };
  }
  function waitForRequest(requestId: string) {
    const existing = requestWaiters.get(requestId);
    if (existing) return existing;
    const waiting = (async () => {
      assertAvailable();
      const restored = await readRequest(requestId);
      if (restored?.result) return storedRequestResult(restored.result)!;
      const tasks = (await lease.storage.scanTasks({}, 100000, undefined, context)).items;
      const acceptedGoal = tasks.find(
        (task) => task.kind === "rukie.goal-driver" && restored?.tasks.includes(Number(task.id)),
      );
      if (acceptedGoal && !restored?.submissions.length) {
        const receipt = await Promise.race([
          harness.waitForTask(acceptedGoal.id, context),
          storageFault.promise,
        ]);
        const outcome = receipt.state.outcome;
        const value = "result" in outcome ? outcome.result : undefined;
        const settled = options.goalReceipt(value, requestId) ?? {
          requestId,
          text: "",
          success: false,
          error: "Goal continuation cancelled",
          usage: zeroUsage(),
          durationMs: 0,
        };
        await harness.commit(async (tx) => {
          (await tx.doc(RequestDoc)).requests[requestId]!.result = {
            ...settled,
            usage: { ...settled.usage },
          };
        }, context);
        await observation.flush();
        publishSettled(settled);
        return settled;
      }
      let result: RequestResult | undefined;
      const goalReceipts = new Map<
        number,
        import("@earendil-works/pi-durable").SettledTask<JsonValue>
      >();
      const parentEntries = new Map<number, EntryRecord>();
      const childReceipts = new Map<
        number,
        import("@earendil-works/pi-durable").TaskRecord<JsonValue, JsonValue, JsonValue>
      >();
      for (;;) {
        const request = await readRequest(requestId);
        if (!request) throw new Error(`Unknown request: ${requestId}`);
        const submissions = await lease.storage.scanSubmissions({}, 100000, undefined, context);
        const ids = submissions.items
          .filter((record) => request.submissions.includes(Number(record.id)))
          .map((record) => record.id);
        if (!ids.length) throw new Error("Request has no submitted inputs.");
        const results = await Promise.all(ids.map((id) => resultFor(requestId, id)));
        result = results.at(-1)!;
        for (const id of ids) {
          const submission = await harness.submission(id, context);
          if (!submission) throw new Error(`Request submission missing: ${id}`);
          for (const entry of await receiptEntries(await submission.wait(context)))
            parentEntries.set(Number(entry.id), entry);
        }
        const tasks = (await lease.storage.scanTasks({}, 100000, undefined, context)).items;
        const drivers = [];
        const causes = await requestCausesForTasks(tasks);
        for (const task of tasks)
          if (task.kind === "rukie.subagent-driver" && causes(task).has(requestId))
            drivers.push(task);
        for (const driver of drivers) {
          const receipt = await Promise.race([
            harness.waitForTask(driver.id, context),
            storageFault.promise,
          ]);
          childReceipts.set(Number(driver.id), receipt);
        }
        for (const driver of tasks.filter(
          (task) => task.kind === "rukie.goal-driver" && request.tasks.includes(Number(task.id)),
        ))
          goalReceipts.set(
            Number(driver.id),
            await Promise.race([harness.waitForTask(driver.id, context), storageFault.promise]),
          );
        const fresh = await readRequest(requestId);
        if (
          fresh &&
          fresh.submissions.length === request.submissions.length &&
          fresh.tasks.length === request.tasks.length
        )
          break;
      }
      // Linked Goal rounds may share a native answer with a Human child report.
      // Union their committed entries before summing; a receipt's spend is not an independent bucket.
      const allTasks = (await lease.storage.scanTasks({}, 100000, undefined, context)).items;
      const allInputs = (await lease.storage.scanSubmissions({}, 100000, undefined, context)).items;
      const goalRequests = new Set<string>();
      for (const driver of goalReceipts.values()) {
        if (
          !driver.input ||
          typeof driver.input !== "object" ||
          Array.isArray(driver.input) ||
          typeof driver.input.requestId !== "string"
        )
          throw new Error("Invalid accepted Goal request identity.");
        for (const input of allInputs.filter((input) =>
          isGoalRound(
            input.requestId,
            String(
              driver.input && typeof driver.input === "object" && !Array.isArray(driver.input)
                ? driver.input.requestId
                : "",
            ),
            Number(driver.id),
          ),
        )) {
          goalRequests.add(input.requestId!);
          const roundRequest = await readRequest(input.requestId!);
          const ids = roundRequest?.submissions ?? [Number(input.id)];
          for (const id of ids) {
            const record = allInputs.find((record) => Number(record.id) === id);
            if (!record) throw new Error(`Goal submission missing: ${id}`);
            const submission = await harness.submission(record.id, context);
            if (!submission) throw new Error(`Goal submission missing: ${id}`);
            for (const entry of await receiptEntries(await submission.wait(context)))
              parentEntries.set(Number(entry.id), entry);
          }
        }
      }
      const causes = await requestCausesForTasks(allTasks);
      for (const child of allTasks)
        if (
          child.kind === "rukie.subagent-driver" &&
          child.state.status === "terminal" &&
          [...causes(child)].some((request) => goalRequests.has(request))
        )
          childReceipts.set(Number(child.id), child);
      const usage = entryUsage(parentEntries.values());
      let answerId: number | undefined;
      for (const receipt of childReceipts.values()) {
        const outcome = receipt.state.outcome;
        const value = outcome && "result" in outcome ? outcome.result : undefined;
        const child = options.subagentReceipt(value);
        if (child.parentAnswer !== undefined)
          answerId = Math.max(answerId ?? 0, child.parentAnswer);
        for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const)
          usage[key] += child.usage[key];
      }
      let text = result!.text;
      if (answerId !== undefined) {
        const view = await options.conversation().context(context);
        const entry = view.entries.find((entry) => Number(entry.id) === answerId);
        if (entry)
          text = (entry.model ?? [])
            .filter((message) => message.role === "assistant")
            .map(textOf)
            .join("");
      }
      const settled = assembleRequestResult({
        result: result!,
        text,
        usage,
        goals: [...goalReceipts.values()].map((receipt) => {
          const outcome = receipt.state.outcome;
          return options.goalReceipt("result" in outcome ? outcome.result : undefined, requestId);
        }),
        entries: [...parentEntries.values()],
      });
      await harness.commit(async (tx) => {
        const doc = await tx.doc(RequestDoc);
        doc.requests[requestId]!.result = { ...settled, usage: { ...settled.usage } };
      }, context);
      await observation.flush();
      if (requestKind(requestId) !== "goal-round") publishSettled(settled);
      return settled;
    })();
    requestWaiters.set(requestId, waiting);
    return waiting;
  }
  async function recover(
    recovering: Awaited<ReturnType<Harness["inspect"]>>,
    activationTaskFact: number | null,
    goalRequestId: string | undefined,
  ) {
    const requestValues = (await harness.snapshot(RequestDoc, context))?.requests ?? {};
    const allTasks = (await lease.storage.scanTasks({}, 100000, undefined, context)).items;
    for (const record of recovering.submissions)
      if (record.requestId && requestValues[record.requestId]) currentRequestId = record.requestId;
    if (!currentRequestId) {
      const causes = await requestCausesForTasks(allTasks);
      for (const task of recovering.tasks)
        for (const id of causes(task.record)) currentRequestId = id;
    }
    if (activationTaskFact !== null && goalRequestId) {
      const taskId = activationTaskFact;
      const human = Object.entries(requestValues).find(
        ([id, request]) =>
          requestKind(id) === "human" && request.result === null && request.tasks.includes(taskId),
      );
      currentRequestId = human?.[0] ?? goalRequestId;
    }
  }
  return {
    publishSettled,
    bind,
    recordOutcome,
    recordResult,
    readRequest,
    registerSubmission,
    resultFor,
    receiptEntries,
    requestCausesForTasks,
    waitForRequest,
    recover,
    get currentRequestId() {
      return currentRequestId;
    },
    setForeground(value: string) {
      if (requestKind(value) !== "goal-round") currentRequestId = value;
    },
  };
}

export function isGoalRound(id: string | undefined, activation: string, taskId: number) {
  if (!id) return false;
  const value = parseRequestId(id);
  return value.kind === "goal-round" && value.activation === activation && value.taskId === taskId;
}
export function goalRoundNumber(id: string) {
  const value = parseRequestId(id);
  if (value.kind !== "goal-round") throw new Error("Invalid Goal round identity.");
  return value.round;
}

/** Result contents are pure; the Ledger owns the durable settlement boundary. */
function assembleSubmissionResult(input: {
  requestId: string;
  receipt: import("@earendil-works/pi-durable").SettledSubmissionRecord;
  terminal: Message | undefined;
  text: string;
  usage: RunResult["usage"];
  durationMs: number;
  takeover?: boolean;
  persistedStop?: string;
}): RequestResult {
  const { requestId, receipt, terminal, text, usage, durationMs, takeover, persistedStop } = input;
  if (takeover)
    return {
      requestId,
      text: "",
      success: true,
      usage,
      durationMs: durationMs,
    };
  if (persistedStop)
    return {
      requestId,
      text,
      success: true,
      stopReason: "hook_stopped",
      reason: persistedStop,
      usage,
      durationMs: durationMs,
    };
  return {
    requestId,
    text,
    success:
      receipt.status === "done" &&
      (terminal?.role !== "assistant" || terminal.stopReason === "stop"),
    usage,
    durationMs: durationMs,
    ...(receipt.status === "unanswered"
      ? { error: typeof receipt.detail === "string" ? receipt.detail : receipt.reason }
      : terminal?.role === "assistant" && terminal.stopReason !== "stop"
        ? {
            error:
              terminal.errorMessage ??
              `Model response ended with stop reason ${terminal.stopReason}`,
          }
        : {}),
  };
}

export function assembleRequestResult(input: {
  result: RequestResult;
  text: string;
  usage: RunResult["usage"];
  goals: readonly (RequestResult | undefined)[];
  entries: readonly EntryRecord[];
}): RequestResult {
  let settled = { ...input.result, text: input.text, usage: input.usage };
  for (const goalResult of input.goals) {
    if (goalResult)
      settled = {
        ...goalResult,
        usage: input.usage,
        durationMs: settled.durationMs + goalResult.durationMs,
      };
    else settled = { ...settled, success: false, error: "Goal continuation cancelled" };
  }
  const latestAnswer = [...input.entries]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .flatMap((entry) => entry.model ?? [])
    .findLast((message) => message.role === "assistant");
  if (input.goals.length && latestAnswer) settled.text = textOf(latestAnswer);
  return settled;
}
