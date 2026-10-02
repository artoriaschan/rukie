import {
  compact,
  createCompactionSummaryMessage,
  estimateTokens,
  prepareBranchEntries,
  prepareCompaction,
  type AgentMessage,
  type Entry,
  type StreamFn,
  type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/pi-agent-core/harness/context";
import {
  createModels,
  getCurrentSystemMessage,
  normalizeContext,
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import { convertToLlm } from "../reminders/index.ts";

/** Replay system deltas and project the latest native compaction plus its suffix. */
export function restoreContext(entries: Entry[]): AgentMessage[] {
  const index = entries.findLastIndex((entry) => entry.type === "compaction");
  if (index < 0)
    return entries.flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
  const entry = entries[index]!;
  if (entry.type !== "compaction") throw new Error("Expected compaction entry.");
  // Native compaction retains model-converted reminders. Recover their original
  // roles from the unchanged Transcript, rather than interpreting user text.
  const reminders = new Map<string, AgentMessage>();
  for (const item of entries.slice(0, index)) {
    if (item.type === "message" && item.message.role === "system-reminder") {
      const converted = convertToLlm([item.message])[0]!;
      reminders.set(JSON.stringify([converted.timestamp, converted.content]), item.message);
    }
  }
  const baseline = getCurrentSystemMessage(
    entries
      .slice(0, index + 1)
      .flatMap((item) =>
        item.type === "message" && item.message.role === "system" ? [item.message] : [],
      ),
  );
  return [
    ...(baseline ? [baseline] : []),
    createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp),
    ...entry.retainedTail
      .filter((message) => message.role !== "system")
      .map((message) =>
        message.role === "user"
          ? (reminders.get(JSON.stringify([message.timestamp, message.content])) ?? message)
          : message,
      ),
    ...entries.slice(index + 1).flatMap((item) => (item.type === "message" ? [item.message] : [])),
  ];
}

/** A single provider boundary serves normal Turns and pi's standalone summary requests. */
export async function compactTurn(options: {
  messages: AgentMessage[];
  entries: () => Promise<Entry[]>;
  model: Model<Api>;
  streamFn: StreamFn;
  thinkingLevel: ThinkingLevel;
  signal?: AbortSignal;
}) {
  const { model, signal } = options;
  const tokensBefore = convertToLlm(options.messages).reduce(
    (total, message) =>
      total +
      (message.role === "system"
        ? Math.ceil(JSON.stringify(message).length / 4)
        : estimateTokens(message)),
    0,
  );
  if (tokensBefore <= model.contextWindow * 0.8) return undefined;
  const entries = await options.entries();
  const latestUserIndex = entries.findLastIndex(
    (entry) => entry.type === "message" && entry.message.role === "user",
  );
  // The pending request includes any Skill Invocation reminders following its user message.
  // Compress earlier work without allowing pi to split that request at a reminder.
  const pendingEntries = latestUserIndex < 0 ? [] : entries.slice(latestUserIndex);
  const hasPendingRequest =
    pendingEntries.length > 0 &&
    pendingEntries.every(
      (entry) =>
        entry.type === "message" &&
        (entry.message.role === "user" || entry.message.role === "system-reminder"),
    );
  const compactableEntries = hasPendingRequest ? entries.slice(0, latestUserIndex) : entries;
  const preparation = prepareCompaction(
    compactableEntries.map((entry): Entry => {
      // pi does not know Neant's custom reminder role. Preserve its model-visible text.
      if (entry.type === "message" && entry.message.role === "system-reminder") {
        return { ...entry, message: convertToLlm([entry.message])[0]! };
      }
      return entry;
    }),
    {
      enabled: true,
      reserveTokens: Math.max(1, Math.floor(model.contextWindow * 0.2)),
      keepRecentTokens: Math.min(20_000, Math.floor(model.contextWindow * 0.2)),
    },
  );
  if (!preparation.ok) throw preparation.error;
  if (!preparation.value) return undefined;
  preparation.value.tokensBefore = tokensBefore;
  // A single oversized message can make pi's recent tail exceed the entire budget.
  // Summarize that tail too; a pending request is appended separately below.
  if (
    preparation.value.retainedTail.reduce((total, message) => total + estimateTokens(message), 0) >
    model.contextWindow * 0.4
  ) {
    const tail = preparation.value.retainedTail;
    preparation.value.messagesToSummarize.push(...preparation.value.turnPrefixMessages, ...tail);
    preparation.value.turnPrefixMessages = [];
    preparation.value.isSplitTurn = false;
    preparation.value.retainedTail = [];
    preparation.value.fileOps = prepareBranchEntries(compactableEntries).fileOps;
  }
  // pi's split-turn path omits the previous summary when there is no older history.
  // Use its normal iterative summary path for this shape so earlier goals survive.
  if (
    preparation.value.isSplitTurn &&
    preparation.value.previousSummary &&
    preparation.value.messagesToSummarize.length === 0
  ) {
    preparation.value.messagesToSummarize = preparation.value.turnPrefixMessages;
    preparation.value.turnPrefixMessages = [];
    preparation.value.isSplitTurn = false;
  }
  if (
    preparation.value.messagesToSummarize.length === 0 &&
    preparation.value.turnPrefixMessages.length === 0
  )
    return undefined;
  if (hasPendingRequest) {
    preparation.value.retainedTail.push(
      ...pendingEntries.flatMap((entry) => (entry.type === "message" ? [entry.message] : [])),
    );
  }
  const models = createModels();
  models.completeSimple = async (summaryModel, context, requestOptions) =>
    (await options.streamFn(summaryModel, normalizeContext(context), requestOptions)).result();
  const result = await compact(
    preparation.value,
    models,
    model,
    undefined,
    options.thinkingLevel,
    undefined,
    undefined,
    signal ? withAbortSignal(signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT,
  );
  if (!result.ok) throw result.error;
  signal?.throwIfAborted();
  return result.value;
}
