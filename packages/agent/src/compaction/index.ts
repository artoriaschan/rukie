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
import { createUserVisibleError } from "@neant/shared";
import { convertToLlm } from "../reminders/index.ts";
import { isUnknownToolOutcome } from "@neant/shared";

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
  const suffix = entries.slice(index + 1);
  // Reminders appended immediately after compaction re-establish current sources
  // before the retained conversation tail. Later Run reminders retain their order.
  let reminderCount = 0;
  while (suffix[reminderCount]?.type === "message") {
    const item = suffix[reminderCount]!;
    if (item.type !== "message" || item.message.role !== "system-reminder") break;
    reminderCount++;
  }
  const messages: AgentMessage[] = [
    ...(baseline ? [baseline] : []),
    createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp),
    ...suffix
      .slice(0, reminderCount)
      .flatMap((item) => (item.type === "message" ? [item.message] : [])),
    ...entry.retainedTail
      .filter((message) => message.role !== "system")
      .map((message) =>
        message.role === "user"
          ? (reminders.get(JSON.stringify([message.timestamp, message.content])) ?? message)
          : message,
      ),
    ...suffix
      .slice(reminderCount)
      .flatMap((item) => (item.type === "message" ? [item.message] : [])),
  ];
  const visibleCalls = new Set(
    messages.flatMap((message) =>
      message.role === "assistant"
        ? message.content.flatMap((part) => (part.type === "toolCall" ? [part.id] : []))
        : [],
    ),
  );
  // Repairs for compacted calls remain durable facts in the Transcript. Do not
  // send an orphan result to the provider or resurrect the compacted call.
  return messages.filter(
    (message) =>
      message.role !== "toolResult" ||
      !isUnknownToolOutcome(message.details) ||
      visibleCalls.has(message.toolCallId),
  );
}

/** Estimate the model-visible context consistently before and after compaction. */
export function estimateContextTokens(messages: AgentMessage[]): number {
  return convertToLlm(messages).reduce(
    (total, message) =>
      total +
      (message.role === "system"
        ? Math.ceil(JSON.stringify(message).length / 4)
        : estimateTokens(message)),
    0,
  );
}

/** A single provider boundary serves normal Turns and pi's standalone summary requests. */
export async function compactTurn(options: {
  messages: AgentMessage[];
  entries: () => Promise<Entry[]>;
  model: Model<Api>;
  streamFn: StreamFn;
  thinkingLevel: ThinkingLevel;
  signal?: AbortSignal;
  trigger: "auto" | "manual";
  instructions?: string;
  beforeCompact?: () => boolean | Promise<boolean>;
  onStart: (tokensBefore: number) => void | Promise<void>;
}) {
  const { model, signal } = options;
  const tokensBefore = estimateContextTokens(options.messages);
  const manual = options.trigger === "manual";
  if (!manual && tokensBefore <= model.contextWindow * 0.8) return undefined;
  if (
    manual &&
    !options.messages.some(
      (message) => message.role === "assistant" || message.role === "toolResult",
    )
  )
    throw createUserVisibleError("Session has no compactable conversation history.", {
      code: "compaction-no-history",
      params: {},
    });
  // Tool State has no model-visible content. In particular, a Checkpoint entry
  // between a user prompt and its reminders must not become pi's turn cut point.
  const entries = (await options.entries()).filter((entry) => entry.type !== "custom");
  const latestUserIndex = entries.findLastIndex(
    (entry) => entry.type === "message" && entry.message.role === "user",
  );
  // The pending request includes any Skill Invocation reminders following its user message.
  // Compress earlier work without allowing pi to split that request at a reminder.
  const pendingEntries = latestUserIndex < 0 ? [] : entries.slice(latestUserIndex);
  const hasPendingRequest =
    !manual &&
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
  if (!preparation.value) {
    if (manual)
      throw createUserVisibleError("Session has no compactable conversation history.", {
        code: "compaction-no-history",
        params: {},
      });
    return undefined;
  }
  preparation.value.tokensBefore = tokensBefore;
  // An idle manual request summarizes all completed work, including short
  // conversations that pi would otherwise retain in their entirety.
  if (manual) {
    preparation.value.messagesToSummarize.push(
      ...preparation.value.turnPrefixMessages,
      ...preparation.value.retainedTail,
    );
    preparation.value.turnPrefixMessages = [];
    preparation.value.retainedTail = [];
    preparation.value.isSplitTurn = false;
    preparation.value.fileOps = prepareBranchEntries(compactableEntries).fileOps;
  }
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
  signal?.throwIfAborted();
  if ((await options.beforeCompact?.()) === false) return undefined;
  signal?.throwIfAborted();
  await options.onStart(tokensBefore);
  const result = await compact(
    preparation.value,
    models,
    model,
    options.instructions,
    options.thinkingLevel,
    undefined,
    undefined,
    signal ? withAbortSignal(signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT,
  );
  if (!result.ok) throw result.error;
  signal?.throwIfAborted();
  return result.value;
}
