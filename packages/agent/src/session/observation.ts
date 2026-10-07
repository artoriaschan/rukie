import { ToolTask, ToolResultEntry } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type {
  AgentState,
  CommitPublication,
  Conversation,
  ConversationView,
  Harness,
  InboxState,
  LiveState,
  ToolRegistration,
  UsageState,
  EntryRecord,
  JsonObject,
  TaskRecord,
  TaskId,
} from "@earendil-works/pi-durable";
import type { Context, JsonValue } from "@earendil-works/chord";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { isDeepStrictEqual } from "node:util";
import type { BackgroundActivity, SessionEvent } from "./events.ts";
import {
  transcriptMessages,
  type TranscriptMessage,
  type TranscriptAssistantMessage,
} from "./messages.ts";
import { presentCall, presentResult } from "../tools/presentation.ts";

type WithoutSessionId<E = SessionEvent> = E extends { sessionId: string }
  ? Omit<E, "sessionId">
  : never;

type Snapshot = Extract<SessionEvent, { type: "snapshot" }>;
type Facts = {
  toolStates: Record<string, unknown>;
  runSummaries: { afterMessage: number; durationMs: number; endedAt: number; success: boolean }[];
  model: string;
  planMode: boolean;
  background: BackgroundActivity[];
};
export interface ConversationObservationOptions {
  harness: Harness;
  conversation: Conversation;
  sessionId: string;
  tools(): readonly ToolRegistration[];
  /** Immutable fork-aware chronological Transcript; native view.entries remains the active model head. */
  history?(): Promise<readonly EntryRecord[]>;
  /** Product timing facts captured with this committed live generation frame. */
  liveAssistantFacts?(): Pick<TranscriptAssistantMessage, "rukieThinkingDurationMs">;
  /** Adopt app documents from this exact publication, without calling Session APIs. */
  adopt(publication: CommitPublication): void;
  facts(): Facts;
  /** Fire observers synchronously; their returned promises remain observer-owned. */
  publish(events: readonly SessionEvent[]): void;
}

function parts(view: ConversationView) {
  // Durable creates and validates these reserved documents with its public built-in
  // tokens. ConversationView preserves their JSON representation and immutable frame.
  return {
    live: (view.docs["pi.live"] ?? {}) as LiveState,
    inbox: view.docs["pi.inbox"] as InboxState | undefined,
    agent: (view.docs["pi.agent"] ?? {}) as AgentState,
    usage: (view.docs["pi.usage"] ?? { models: {}, tools: {} }) as UsageState,
  };
}
/** Fold native immutable table/document records; preserve unchanged references. */
function adoptView(view: ConversationView, publication: CommitPublication): ConversationView {
  let conversation = view.conversation;
  let entries = view.entries;
  let docs = view.docs;
  const appended = publication.changes
    .flatMap((change) =>
      change.type === "entry" && change.value.conversationId === conversation.id
        ? [change.value]
        : [],
    )
    .sort((a, b) => a.id - b.id);
  for (const entry of appended) {
    if (entry.head === undefined) entries = [...entries, entry];
    else
      entries = [
        entry,
        ...entries.filter(
          (candidate) => candidate.head === undefined && candidate.id >= entry.head!,
        ),
      ];
  }
  for (const change of publication.changes) {
    if (change.type === "conversation" && change.value.id === conversation.id)
      conversation = change.value;
    if (
      change.type !== "document" ||
      change.conversationId !== conversation.id ||
      change.record.key !== undefined
    )
      continue;
    const kind = change.record.kind;
    if (!["pi.live", "pi.inbox", "pi.agent", "pi.usage"].includes(kind)) continue;
    const next = { ...docs };
    if (change.value === null) delete next[kind];
    else next[kind] = change.value;
    docs = next;
  }
  return { conversation, entries, docs };
}

function queued(inbox: InboxState | undefined) {
  return (inbox?.items ?? []).map(({ id, mode }) => ({ id, mode }));
}
function taskArguments(task: TaskRecord<JsonValue, JsonValue, JsonValue> | undefined): JsonObject {
  const checkpoint = task?.state.checkpoint;
  if (checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint)) {
    const args = checkpoint.arguments;
    if (args && typeof args === "object" && !Array.isArray(args)) return args;
  }
  return {};
}

function interruptedResult(entry: EntryRecord) {
  return (
    ToolResultEntry.is(entry) &&
    Array.isArray(entry.data?.diagnostics) &&
    entry.data.diagnostics.some(
      (diagnostic) => diagnostic.code === "interrupted" && diagnostic.severity === "error",
    )
  );
}
function unknownOutcome(
  entry: EntryRecord,
  task: TaskRecord<JsonValue, JsonValue, unknown> | undefined,
) {
  if (
    !interruptedResult(entry) ||
    !task ||
    task.kind !== ToolTask.definition.name ||
    task.id !== entry.byTaskId ||
    (task.state.status !== "terminal" && task.state.status !== "completing") ||
    task.state.outcome.status !== "failed"
  )
    return false;
  const result = task.state.outcome.result;
  const input = task.input;
  return (
    result !== null &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    "entryId" in result &&
    result.entryId === entry.id &&
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    entry.model?.some(
      (message) => message.role === "toolResult" && message.toolCallId === input.callId,
    ) === true
  );
}

async function readUnknownOutcomes(
  entries: readonly EntryRecord[],
  harness: Harness,
  context: Context,
) {
  const outcomes = new Set<string>();
  // getTask reads committed receipts without scheduling recovery. Reserved native
  // diagnostics plus the matching receipt establish uncertainty, never model text.
  await Promise.all(
    entries.filter(interruptedResult).map(async (entry) => {
      if (
        entry.byTaskId !== undefined &&
        unknownOutcome(entry, await harness.getTask(entry.byTaskId, context))
      )
        outcomes.add(String(entry.id));
    }),
  );
  return outcomes;
}

/** Join history DTOs with exact native receipts, retaining uncertainty across child continuation. */
export async function projectCommittedOutcomeFacts(
  messages: readonly TranscriptMessage[],
  entries: readonly EntryRecord[],
  harness: Harness,
  context: Context,
): Promise<readonly TranscriptMessage[]> {
  const outcomes = await readUnknownOutcomes(entries, harness, context);
  return messages.map((message) =>
    message.role === "toolResult" && outcomes.has(message.entryId ?? "")
      ? { ...message, outcomeUnknown: true }
      : message,
  );
}

/** Committed presentation only: never drives execution or reads the Session from a commit callback. */
export async function createConversationObservation(options: ConversationObservationOptions) {
  const { harness, conversation, sessionId } = options;
  // Acquire the native structural baseline before execution resumes. Attached
  // Chord values deliver asynchronously, so later revisions come from the public
  // commit records themselves, never a potentially lagging state.value getter.
  const state = await conversation.viewState(BACKGROUND_CONTEXT);
  let current = state.value;
  let transcriptEntries = options.history ? await options.history() : current.entries;
  const unknownOutcomes = await readUnknownOutcomes(transcriptEntries, harness, BACKGROUND_CONTEXT);
  let projectedEntries: readonly EntryRecord[] | undefined;
  let messagesByEntry = new Map<string, TranscriptMessage[]>();
  let messages: readonly TranscriptMessage[] = [];
  let callArgs = new Map<string, { name: string; args: unknown }>();
  let facts = structuredClone(options.facts());
  const held = new Set<TaskId>();
  let closed = false;
  let pending: (readonly SessionEvent[])[] = [];
  let scheduled = false;
  let delivering = false;
  let waiters: (() => void)[] = [];
  // The pending queue bounds retained intermediate frames. Overflow is one exact
  // newest-frame snapshot, including the app facts captured at that same commit.
  const MAX_PENDING_BATCHES = 64;

  function tool(name: string) {
    return options.tools().find((candidate) => candidate.name === name);
  }
  function assistant(message: AssistantMessage): TranscriptAssistantMessage {
    return {
      ...message,
      content: message.content.map((block) => {
        if (block.type !== "toolCall") return { ...block };
        const view = presentCall(tool(block.name), block.arguments);
        return { ...structuredClone(block), ...(view ? { view } : {}) };
      }),
    };
  }
  function liveAssistant(message: AssistantMessage): TranscriptAssistantMessage {
    return { ...assistant(message), ...options.liveAssistantFacts?.() };
  }
  function enrich(message: TranscriptMessage, calls = callArgs): TranscriptMessage {
    if (message.role === "assistant") return { ...assistant(message), entryId: message.entryId };
    if (message.role !== "toolResult") return message;
    const call = calls.get(message.toolCallId);
    const view = call ? presentResult(tool(call.name), call.args, message) : undefined;
    return {
      ...message,
      ...(unknownOutcomes.has(message.entryId ?? "") ? { outcomeUnknown: true } : {}),
      ...(view ? { view } : {}),
    };
  }
  function project(view: ConversationView) {
    const entries = options.history ? transcriptEntries : view.entries;
    if (projectedEntries === entries) return;
    projectedEntries = entries;
    const raw = transcriptMessages(entries);
    callArgs = new Map();
    for (const message of raw) {
      if (message.role !== "assistant") continue;
      for (const block of message.content) {
        if (block.type === "toolCall")
          callArgs.set(block.id, { name: block.name, args: block.arguments });
      }
    }
    messages = raw.map((message) => enrich(message));
    messagesByEntry = new Map();
    for (const message of messages) {
      if (!message.entryId) continue;
      const group = messagesByEntry.get(message.entryId) ?? [];
      group.push(message);
      messagesByEntry.set(message.entryId, group);
    }
  }
  function entryMessages(entry: EntryRecord) {
    return messagesByEntry.get(String(entry.id)) ?? [];
  }
  function capture(view: ConversationView): Snapshot {
    const { live, inbox, agent, usage } = parts(view);
    return {
      type: "snapshot",
      sessionId,
      entries: view.entries,
      messages,
      ...(live.run ? { run: { inputs: live.run.inputs } } : {}),
      ...(live.generation
        ? {
            generation: {
              ...live.generation,
              ...(live.generation.message
                ? { message: liveAssistant(live.generation.message) }
                : {}),
            },
          }
        : {}),
      tools: live.tools ?? [],
      compactions: live.compactions ?? [],
      inbox: queued(inbox),
      agent,
      usage,
      ...facts,
    };
  }
  project(current);
  let snapshot = capture(current);

  function finishDelivery() {
    if (scheduled || delivering || pending.length) return;
    const completed = waiters;
    waiters = [];
    for (const done of completed) done();
  }
  function enqueue(events: readonly SessionEvent[]) {
    if (closed || !events.length) return;
    if (pending.length >= MAX_PENDING_BATCHES) pending = [[snapshot]];
    else pending.push(events);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      delivering = true;
      try {
        while (!closed && pending.length) options.publish(pending.shift()!);
      } finally {
        delivering = false;
        finishDelivery();
      }
    });
  }

  function translate(
    before: ConversationView,
    after: ConversationView,
    publication: CommitPublication,
  ): SessionEvent[] {
    const was = parts(before),
      now = parts(after);
    const entries: EntryRecord[] = [];
    const tasks = new Map<TaskId, TaskRecord<JsonValue, JsonValue, JsonValue>>();
    const events: SessionEvent[] = [];
    const emit = (event: WithoutSessionId) => events.push({ ...event, sessionId } as SessionEvent);
    // Only the conversation's records enter its presentation. Changes are unordered
    // in CommitPublication; native entry IDs recover the transcript append order.
    for (const change of publication.changes) {
      if (change.type === "entry" && change.value.conversationId === conversation.id)
        entries.push(change.value);
      if (change.type === "task" && change.value.conversationId === conversation.id)
        tasks.set(change.value.id, change.value);
    }
    entries.sort((a, b) => a.id - b.id);
    const slotsBefore = new Map((was.live.tools ?? []).map((slot) => [slot.callId, slot]));
    const slots = now.live.tools ?? [];
    for (const slot of slots) {
      if (slot.status !== "running" || slotsBefore.get(slot.callId)?.status === "running") continue;
      const args = taskArguments(slot.taskId ? tasks.get(slot.taskId) : undefined);
      const view = presentCall(tool(slot.name), args);
      emit({
        type: "tool_execution_start",
        toolCallId: slot.callId,
        toolName: slot.name,
        args,
        ...(view ? { view } : {}),
      });
    }
    const partialBefore = was.live.generation?.message;
    const partial = now.live.generation?.message;
    if (partial && !partialBefore) emit({ type: "message_start", message: liveAssistant(partial) });
    else if (partial && partial !== partialBefore) {
      const message = liveAssistant(partial);
      emit({
        type: "message_update",
        message,
        usage: partial.usage,
        changes: [{ type: "message", message }],
      });
    }
    for (const slot of slots) {
      const previous = slotsBefore.get(slot.callId);
      if (slot.status !== "running" || previous?.status !== "running") continue;
      if (
        slot.output === previous.output &&
        slot.details === previous.details &&
        slot.diagnostics === previous.diagnostics
      )
        continue;
      emit({
        type: "tool_execution_update",
        toolCallId: slot.callId,
        toolName: slot.name,
        ...(slot.output !== previous.output ? { output: { set: slot.output ?? "" } } : {}),
        ...(slot.details !== previous.details ? { details: slot.details ?? null } : {}),
        ...(slot.diagnostics !== previous.diagnostics
          ? { diagnostics: slot.diagnostics ?? [] }
          : {}),
      });
    }
    const generation = now.live.generation,
      oldGeneration = was.live.generation;
    if (generation?.retry && !oldGeneration?.retry)
      emit({
        type: "auto_retry_start",
        attempt: generation.attempt,
        at: generation.retry.at,
        errorMessage: generation.retry.error,
      });
    if (oldGeneration?.retry && !generation?.retry)
      emit({ type: "auto_retry_end", attempt: oldGeneration.attempt });
    if (generation?.deferred && generation.deferred.pollAt !== oldGeneration?.deferred?.pollAt)
      emit({ type: "deferred_poll", pollAt: generation.deferred.pollAt });

    const ends: Extract<SessionEvent, { type: "tool_execution_end" }>[] = [];
    const end = (callId: string, name: string, entry: EntryRecord | undefined) => {
      const result = entry && entryMessages(entry).find((message) => message.role === "toolResult");
      ends.push({
        type: "tool_execution_end",
        sessionId,
        toolCallId: callId,
        toolName: name,
        ...(entry ? { entry } : {}),
        ...(result?.role === "toolResult"
          ? { result, ...(result.view ? { view: result.view } : {}) }
          : {}),
      });
    };
    for (const previous of slotsBefore.values()) {
      if (previous.status === "done") continue;
      const slot = slots.find((candidate) => candidate.callId === previous.callId);
      if (slot?.status === "done" || !slot)
        end(
          previous.callId,
          previous.name,
          entries.find(
            (entry) =>
              slot?.entry === entry.id ||
              entry.model?.some(
                (message) =>
                  message.role === "toolResult" && message.toolCallId === previous.callId,
              ),
          ),
        );
    }
    for (const slot of slots)
      if (slot.status === "done" && !slotsBefore.has(slot.callId))
        end(
          slot.callId,
          slot.name,
          entries.find((entry) => entry.id === slot.entry),
        );
    let assistantAppended = false;
    for (const entry of entries) {
      events.push(...ends.filter((event) => event.entry === entry));
      const projected = entryMessages(entry);
      const first = projected[0];
      if (!entry.model?.length) {
        emit({ type: "entry_appended", entry });
        if (projected.length)
          emit({ type: "message_end", entry, entryId: String(entry.id), messages: projected });
        continue;
      }
      const streamed = first?.role === "assistant" && partialBefore && !assistantAppended;
      if (first?.role === "assistant") assistantAppended = true;
      if (!streamed)
        for (const message of entry.model)
          emit({
            type: "message_start",
            message: message.role === "assistant" ? assistant(message) : message,
          });
      emit({ type: "message_end", entry, entryId: String(entry.id), messages: projected });
    }
    events.push(...ends.filter((event) => !event.entry));
    const compactionsBefore = was.live.compactions ?? [],
      compactions = now.live.compactions ?? [];
    for (const old of compactionsBefore)
      if (!compactions.some((item) => item.taskId === old.taskId))
        emit({ type: "compaction_end", taskId: old.taskId, reason: old.reason });
    let turnEnded = false;
    for (const task of tasks.values()) {
      if (
        task.kind === "pi.generation" &&
        task.state.status === "completing" &&
        !held.has(task.id)
      ) {
        held.add(task.id);
        turnEnded = true;
      }
      if (task.state.status !== "terminal") continue;
      if (task.kind === "pi.generation" && !held.delete(task.id)) turnEnded = true;
      const outcome = task.state.outcome;
      if (outcome.status === "faulted" || outcome.status === "orphaned")
        emit({
          type: "task_failed",
          taskId: task.id,
          kind: task.kind,
          message: outcome.status === "faulted" ? outcome.error.message : outcome.reason,
        });
    }
    if (turnEnded) emit({ type: "turn_end" });
    const run = now.live.run,
      oldRun = was.live.run;
    const changed = run?.inputs[0] !== oldRun?.inputs[0];
    if (oldRun && changed) emit({ type: "run_end", inputs: oldRun.inputs });
    const submissions = publication.changes.filter(
      (change): change is Extract<CommitPublication["changes"][number], { type: "submission" }> =>
        change.type === "submission" && change.value.conversationId === conversation.id,
    );
    submissions.sort((a, b) => a.value.id - b.value.id);
    for (const change of submissions) emit({ type: "submission", record: change.value });
    if (now.inbox !== was.inbox) emit({ type: "inbox_update", items: queued(now.inbox) });
    if (now.agent !== was.agent) emit({ type: "agent_changed", agent: now.agent });
    if (now.usage !== was.usage) emit({ type: "usage_changed", usage: now.usage });
    for (const item of compactions)
      if (!compactionsBefore.some((old) => old.taskId === item.taskId))
        emit({
          type: "compaction_start",
          taskId: item.taskId,
          reason: item.reason,
          blocking: item.blocking,
        });
    if (run && changed) emit({ type: "run_start", inputs: run.inputs });
    if (run && run.taskId !== oldRun?.taskId && tasks.get(run.taskId)?.kind === "pi.generation")
      emit({ type: "turn_start" });
    return events;
  }

  const unsubscribe = harness.subscribeCommits((publication) => {
    if (closed) return;
    const tasks = new Map<number, TaskRecord<JsonValue, JsonValue, unknown>>(
      publication.changes.flatMap((change) =>
        change.type === "task" ? [[change.value.id, change.value] as const] : [],
      ),
    );
    for (const change of publication.changes)
      if (
        change.type === "entry" &&
        change.value.byTaskId !== undefined &&
        unknownOutcome(change.value, tasks.get(change.value.byTaskId))
      )
        unknownOutcomes.add(String(change.value.id));
    const before = current;
    const appendedTranscript = publication.changes.flatMap((change) =>
      change.type === "entry" && change.value.conversationId === conversation.id
        ? [change.value]
        : [],
    );
    if (appendedTranscript.length)
      transcriptEntries = [...transcriptEntries, ...appendedTranscript].sort(
        (a, b) => Number(a.id) - Number(b.id),
      );
    current = adoptView(current, publication);
    options.adopt(publication);
    const previousFacts = facts;
    facts = structuredClone(options.facts());
    project(current);
    snapshot = capture(current);
    const events = translate(before, current, publication);
    for (const name of new Set([
      ...Object.keys(previousFacts.toolStates),
      ...Object.keys(facts.toolStates),
    ])) {
      if (!isDeepStrictEqual(previousFacts.toolStates[name], facts.toolStates[name]))
        events.push({ type: "tool_state_changed", sessionId, name, value: facts.toolStates[name] });
    }
    // A head change replaces active history, rather than appending messages to an
    // obsolete reading position. All facts here belong to the same adopted commit.
    const replaced = before.entries.some((entry, index) => current.entries[index]?.id !== entry.id);
    const metadataChanged = publication.changes.some(
      (change) =>
        change.type === "entry" &&
        change.value.conversationId === conversation.id &&
        change.value.kind === "rukie.message-facts",
    );
    const anchoredReminder = publication.changes.some(
      (change) =>
        change.type === "entry" &&
        change.value.conversationId === conversation.id &&
        change.value.kind === "rukie.reminder" &&
        change.value.data &&
        typeof change.value.data === "object" &&
        !Array.isArray(change.value.data) &&
        typeof change.value.data.afterCompactionId === "number",
    );
    // A replacement snapshot supersedes message deltas, while native lifecycle
    // receipts from that same commit still belong to this captured frame.
    enqueue(
      replaced || metadataChanged || !isDeepStrictEqual(previousFacts.background, facts.background)
        ? [
            snapshot,
            ...events.filter(
              (event) =>
                !["message_start", "message_update", "message_end", "entry_appended"].includes(
                  event.type,
                ),
            ),
          ]
        : anchoredReminder
          ? [...events, snapshot]
          : events,
    );
  });
  function stop() {
    if (closed) return;
    closed = true;
    unsubscribe();
    state.dispose();
    pending = [];
    finishDelivery();
  }
  const unsubscribeClose = harness.subscribeClose(stop);
  enqueue([snapshot]);
  return {
    snapshot: () => snapshot,
    messages: () => messages,
    // Present fresh committed DTOs without replacing this observation's captured frame.
    present: (input: readonly TranscriptMessage[]) => {
      const calls = new Map(callArgs);
      for (const message of input) {
        if (message.role !== "assistant") continue;
        for (const block of message.content)
          if (block.type === "toolCall")
            calls.set(block.id, { name: block.name, args: block.arguments });
      }
      return input.map((message) => enrich(message, calls));
    },
    running: () => parts(current).live.run !== undefined,
    view: () => current,
    flush: () =>
      !scheduled && !delivering && !pending.length
        ? Promise.resolve()
        : new Promise<void>((done) => waiters.push(done)),
    async close() {
      stop();
      unsubscribeClose();
    },
  };
}
