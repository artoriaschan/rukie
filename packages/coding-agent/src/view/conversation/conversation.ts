import type {
  SessionNotice,
  readSessionNotice,
  sessionNoticeFromHook,
  assistantThinkingDuration,
} from "@rukie/agent";
import { fmtDuration, type Locale } from "@rukie/i18n";
import { createTuiI18n, formatError } from "../i18n";
import type {
  PromptImage,
  GoalView,
  Session,
  SessionEvent,
  TranscriptMessage,
  BackgroundActivity,
  TodoItem,
} from "@rukie/agent";
import {
  type ContextUsageEvent,
  type RunResult,
  type JobView,
  type ToolCallView,
  type ToolResultView,
} from "@rukie/shared";
import type { TpsSample } from "../transcript/metrics";
import {
  reduceSubagent,
  restoreSubagents,
  projectSubagent,
  reconcileSubagentIdentity,
  type SubagentState,
} from "./subagents";
import { createActivity, reduce } from "./activity/activity";
export type NoticeKind = "info" | "error" | "success" | "warning" | "dim";

export interface ConversationFacts {
  readSessionNotice: typeof readSessionNotice;
  sessionNoticeFromHook: typeof sessionNoticeFromHook;
  assistantThinkingDuration: typeof assistantThinkingDuration;
}

interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  summary: string;
  callView?: ToolCallView;
  startedAt?: number;
  rule?: string;
  hook?: string;
}

type CompletedEntry = { anchorId?: string; sourceEntryId?: string } & (
  | {
      type: "message";
      role: "user" | "assistant";
      text: string;
      source?: string;
      images?: PromptImage[];
      fresh?: boolean;
    }
  | {
      type: "tool";
      id?: string;
      name?: string;
      args?: unknown;
      callView?: ToolCallView;
      resultView?: ToolResultView;
      startedAt?: number;
      endedAt?: number;
      replayed?: boolean;
      jobId?: string;
      summary: string;
      isError: boolean;
      outcomeUnknown?: boolean;
      result?: string;
      images?: PromptImage[];
      error?: string;
    }
  | { type: "question"; text: string }
  | {
      type: "plan-review";
      id: string;
      plan: string;
      kind: "approve" | "revise" | "takeover";
      feedback?: string;
    }
  | { type: "subagent"; agentId: string }
  | {
      type: "thinking";
      text: string;
      durationMs?: number;
      /** This completed Turn's thinking still belongs to the active Run's full-view lifecycle. */
      thinkingOpen?: boolean;
    }
  | { type: "session-notice"; notice: SessionNotice; assistantTimestamp?: number }
  | { type: "notice"; text: string; report?: string }
  | { type: "run-summary"; durationMs: number; endedAt: number; success: boolean }
);

type ToolResultMessage = Extract<TranscriptMessage, { role: "toolResult" }>;

function resultText(result: Pick<ToolResultMessage, "content">) {
  return result.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("\n");
}

export function showsToolCard(name: string) {
  return ![
    "todo_write",
    "ask_user_question",
    "enter_plan_mode",
    "exit_plan_mode",
    "subagent",
    "subagent_fork",
    "send_message",
    "list_agents",
  ].includes(name);
}

function toolSummary(name: string, args: unknown) {
  return `${name} ${JSON.stringify(args)}`.replace(/\s+/g, " ");
}

function toolEntry(
  tool: Pick<
    ToolCall,
    "id" | "name" | "args" | "summary" | "rule" | "hook" | "callView" | "startedAt"
  >,
  isError: boolean,
  result: Pick<ToolResultMessage, "content" | "details"> & {
    view?: ToolResultView;
    timestamp?: number;
    outcomeUnknown?: boolean;
    permissionDenial?: Extract<TranscriptMessage, { role: "toolResult" }>["permissionDenial"];
  },
  t: ReturnType<typeof createTuiI18n>,
): CompletedEntry | undefined {
  const provenance =
    typeof result.details === "object" &&
    result.details !== null &&
    "permissionDenied" in result.details &&
    typeof result.details.permissionDenied === "object" &&
    result.details.permissionDenied !== null
      ? result.details.permissionDenied
      : undefined;
  // Live events and committed decision facts preserve the same localized provenance.
  const rule =
    tool.rule ??
    (result.permissionDenial?.by === "rule" ? result.permissionDenial.rule : undefined);
  const hook =
    tool.hook ??
    (result.permissionDenial?.by === "hook"
      ? (result.permissionDenial.hook ?? "hook")
      : undefined) ??
    (provenance && "by" in provenance && provenance.by === "hook"
      ? "hook" in provenance && typeof provenance.hook === "string"
        ? provenance.hook
        : "hook"
      : undefined);
  const review =
    tool.name === "exit_plan_mode" &&
    typeof tool.args === "object" &&
    tool.args !== null &&
    "plan" in tool.args &&
    typeof tool.args.plan === "string" &&
    typeof result.details === "object" &&
    result.details !== null &&
    "kind" in result.details &&
    ["approve", "revise", "takeover"].includes(String(result.details.kind))
      ? {
          plan: tool.args.plan,
          kind: result.details.kind as "approve" | "revise" | "takeover",
          ...("feedback" in result.details && typeof result.details.feedback === "string"
            ? { feedback: result.details.feedback }
            : {}),
        }
      : undefined;
  if (review) return { type: "plan-review", id: tool.id, ...review };
  if (tool.name === "ask_user_question")
    return { type: "question", text: questionSummary(tool.args, resultText(result), t) };
  if (["subagent", "subagent_fork", "send_message", "list_agents"].includes(tool.name)) {
    const details = result.details;
    if (
      typeof details === "object" &&
      details !== null &&
      "agentId" in details &&
      typeof details.agentId === "string"
    )
      return { type: "subagent", agentId: details.agentId };
    return isError
      ? { type: "notice", text: `✗ ${formatError({ message: resultText(result) }, t)}` }
      : undefined;
  }
  if (["enter_plan_mode", "exit_plan_mode"].includes(tool.name))
    return isError
      ? { type: "notice", text: `✗ ${formatError({ message: resultText(result) }, t)}` }
      : undefined;
  if (tool.name === "todo_write" && !isError) return undefined;
  return {
    type: "tool",
    id: tool.id,
    name: tool.name,
    args: tool.args,
    callView: tool.callView,
    resultView: result.view,
    startedAt: tool.startedAt,
    endedAt: result.timestamp,
    jobId:
      tool.name === "bash" &&
      !isError &&
      typeof result.details === "object" &&
      result.details !== null &&
      "jobId" in result.details &&
      typeof result.details.jobId === "string" &&
      /^bash-[1-9]\d*$/.test(result.details.jobId)
        ? result.details.jobId
        : undefined,
    images: result.content
      .filter((block) => block.type === "image")
      .map((image) => ({
        data: image.data,
        mimeType: image.mimeType,
        ...(tool.name === "read" &&
        typeof tool.args === "object" &&
        tool.args !== null &&
        "path" in tool.args &&
        typeof tool.args.path === "string"
          ? // ponytail: POSIX paths only; Windows separators are not handled.
            { name: tool.args.path.slice(tool.args.path.lastIndexOf("/") + 1) }
          : {}),
      })),
    summary: tool.summary,
    isError: isError && !result.outcomeUnknown,
    outcomeUnknown: result.outcomeUnknown,
    result: isError || result.outcomeUnknown ? undefined : resultText(result),
    error:
      isError && !result.outcomeUnknown
        ? hook !== undefined
          ? t("tool.hook-denied", {
              hook,
              reason: resultText(result)
                .split("\n")[0]!
                .replace(/^Denied by hook: /, ""),
            })
          : rule !== undefined
            ? t("tool.rule-denied", { rule })
            : formatError(
                {
                  ...(typeof result.details === "object" && result.details),
                  message: resultText(result),
                },
                t,
              )
        : undefined,
  };
}

function questionSummary(args: unknown, text: string, t: ReturnType<typeof createTuiI18n>) {
  if (typeof args !== "object" || args === null || !("questions" in args)) return text;
  const questions = args.questions;
  if (!Array.isArray(questions) || !questions.every((item) => typeof item?.question === "string"))
    return text;
  const singleLine = (value: string) => value.replace(/[\r\n]+/g, " ");
  if (text.startsWith("The user declined to answer."))
    return questions
      .map(({ question }) => `${singleLine(question)} → ${t("question.unanswered")}`)
      .join("\n");

  const parse = (index: number, offset: number): string[] | undefined => {
    const { question, options } = questions[index];
    const prefix = `"${question}" → `;
    if (!text.startsWith(prefix, offset)) return undefined;
    const answerStart = offset + prefix.length;
    const next = questions[index + 1];
    if (!next) return [`${singleLine(question)} → ${singleLine(text.slice(answerStart))}`];

    // Try intact label prefixes, then validate the remaining question sequence.
    // At most four selections per question keeps overlapping-label candidates bounded.
    const labels: string[] = Array.isArray(options)
      ? options.flatMap((item) =>
          typeof item?.label === "string" && item.label ? [item.label] : [],
        )
      : [];
    const ends = new Set([answerStart]);
    let starts = [answerStart];
    for (let count = 0; count < Math.min(labels.length, 4) && starts.length > 0; count++) {
      const following: number[] = [];
      for (const start of starts) {
        for (const label of labels) {
          if (!text.startsWith(label, start)) continue;
          const end = start + label.length;
          ends.add(end);
          if (text.startsWith(", ", end)) following.push(end + 2);
        }
      }
      starts = following;
    }
    const boundary = `\n"${next.question}" → `;
    for (const searchStart of [...ends].sort((a, b) => b - a)) {
      const end = text.indexOf(boundary, searchStart);
      if (end === -1) continue;
      const remaining = parse(index + 1, end + 1);
      if (remaining)
        return [
          `${singleLine(question)} → ${singleLine(text.slice(answerStart, end))}`,
          ...remaining,
        ];
    }
    return undefined;
  };
  return questions.length > 0 ? (parse(0, 0)?.join("\n") ?? text) : text;
}

export interface JobRow extends JobView {
  /** First frontend observation of background visibility, including timeout promotion. */
  backgroundedAt: number;
  promotedAt?: number;
  output: string;
  offset: number;
  dropped: boolean;
}

function readJobRow(session: Session, job: JobView, previous?: JobRow): JobRow {
  const output = session.readJob(job.id, previous?.offset ?? 0);
  return {
    ...job,
    backgroundedAt: previous?.backgroundedAt ?? Date.now(),
    promotedAt: previous?.promotedAt,
    // The card needs a tail, not an unbounded second copy of the spill file.
    output: (
      (output.dropped ? "" : (previous?.output ?? "")) +
      output.stdout +
      output.stderr
    ).slice(-16384),
    offset: output.nextOffset,
    dropped: output.dropped || (previous?.dropped ?? false),
  };
}

interface ViewState {
  notification?: { text: string; kind: NoticeKind };
  jobs: Readonly<Record<string, JobRow>>;
  jobNotice?: { id: string; text: string; kind: "success" | "error" | "warning" };
  goal: GoalView | undefined;
  planMode: boolean;
  background: readonly BackgroundActivity[];
  subagents: Readonly<Record<string, SubagentState>>;
  todos: readonly TodoItem[];
  completed: CompletedEntry[];
  tools: ToolCall[];
  announcedTools: ToolCall[];
  assistant: string;
  reasoning: string;
  reasoningSettled?: boolean;
  reasoningDurationMs?: number;
  assistantAnchor: string;
  assistantTimestamp?: number;
  model: string;
  running: boolean;
  input: number;
  output: number;
  usage: Pick<RunResult["usage"], "input" | "output" | "cacheRead" | "cacheWrite">;
  contextUsage?: ContextUsageEvent;
  decode: { tokens: number; ms: number; step?: { startedAt: number; chars: number } };
  tpsSamples: readonly TpsSample[];
  activity: ReturnType<typeof createActivity>;
  activityInput: number;
  streamedChars: number;
  toolArgumentsChars: number;
  error?: string;
}

function messageText(message: TranscriptMessage) {
  if (message.role !== "user" && message.role !== "assistant") return "";
  return typeof message.content === "string"
    ? message.content
    : message.content
        .flatMap((content) => (content.type === "text" ? [content.text] : []))
        .join("");
}

function messageThinking(message: TranscriptMessage) {
  return message.role === "assistant"
    ? message.content
        .flatMap((content) => (content.type === "thinking" ? [content.thinking] : []))
        .join("\n")
    : "";
}

function messageToolArguments(message: TranscriptMessage) {
  return message.role === "assistant"
    ? message.content.reduce(
        (total, block) =>
          total + (block.type === "toolCall" ? JSON.stringify(block.arguments).length : 0),
        0,
      )
    : 0;
}

function userMessageEntry(message: Extract<TranscriptMessage, { role: "user" }>): CompletedEntry {
  return {
    type: "message",
    role: "user",
    text: messageText(message),
    images:
      typeof message.content === "string"
        ? []
        : message.content
            .filter((block) => block.type === "image")
            .map((image, index) => ({
              data: image.data,
              mimeType: image.mimeType,
              ...(message.imageNames?.[index] ? { name: message.imageNames[index]! } : {}),
            })),
    ...("source" in message && typeof message.source === "string" && { source: message.source }),
  };
}

function messageNotice(
  message: Session["messages"][number],
  facts: ConversationFacts,
): SessionNotice | undefined {
  if (message.role === "assistant") {
    if (message.stopReason === "aborted") return { kind: "interrupted" };
    if (message.stopReason === "error")
      return { kind: "error", reason: message.errorMessage ?? "Model stopped: error" };
  }
  return facts.readSessionNotice(message);
}

function replayMessages(
  messages: Session["messages"],
  facts: ConversationFacts,
  t: ReturnType<typeof createTuiI18n>,
  summaries: ReturnType<Session["runSummaries"]> = [],
  activeCalls: ReadonlySet<string> = new Set(),
): CompletedEntry[] {
  const tools = new Map<string, ToolCall>();
  const replayed = messages.flatMap((message, index): CompletedEntry[] => {
    const entries = ((): CompletedEntry[] => {
      const text = messageText(message);
      const outcome = messageNotice(message, facts);
      if (message.role === "session-notice")
        return outcome ? [{ type: "session-notice", notice: outcome }] : [];
      if (message.role === "user")
        return "source" in message && message.source === "goal" ? [] : [userMessageEntry(message)];
      if (message.role === "assistant") {
        for (const content of message.content) {
          if (content.type === "toolCall")
            tools.set(content.id, {
              id: content.id,
              name: content.name,
              args: content.arguments,
              summary: toolSummary(content.name, content.arguments),
              callView: content.view,
              startedAt: message.timestamp,
            });
        }
        const reasoning = messageThinking(message);
        return [
          ...(reasoning
            ? [
                {
                  type: "thinking" as const,
                  text: reasoning,
                  durationMs: facts.assistantThinkingDuration(message),
                },
              ]
            : []),
          ...(text ? [{ type: "message" as const, role: "assistant" as const, text }] : []),
          ...(outcome
            ? [
                {
                  type: "session-notice" as const,
                  notice: outcome,
                  assistantTimestamp: message.timestamp,
                },
              ]
            : []),
        ];
      }
      if (message.role === "toolResult") {
        const tool = tools.get(message.toolCallId) ?? {
          id: message.toolCallId,
          name: message.toolName,
          args: undefined,
          summary: message.toolName,
        };
        tools.delete(message.toolCallId);
        const entry = toolEntry(tool, message.isError, message, t);
        return entry ? [{ ...entry, ...(entry.type === "tool" ? { replayed: true } : {}) }] : [];
      }
      return [];
    })();
    return [
      ...entries.map((entry, blockIndex) => ({
        ...entry,
        sourceEntryId: message.entryId,
        anchorId: `${message.entryId ?? `message-${message.timestamp}-${index}`}-${blockIndex}-${entry.type}`,
      })),
      ...summaries
        .filter((summary) => summary.afterMessage === index + 1)
        .map((summary): CompletedEntry => ({
          type: "run-summary",
          durationMs: summary.durationMs,
          endedAt: summary.endedAt,
          success: summary.success,
          anchorId: `run-${summary.endedAt}`,
        })),
    ];
  });
  replayed.push(
    ...[...tools.values()]
      .filter((tool) => !activeCalls.has(tool.id))
      .map((tool): CompletedEntry => ({
        type: "tool",
        id: tool.id,
        name: tool.name,
        args: tool.args,
        callView: tool.callView,
        summary: tool.summary,
        isError: false,
        outcomeUnknown: true,
        replayed: true,
        anchorId: `unresolved-${tool.id}`,
      })),
  );
  return replayed.reduce<CompletedEntry[]>((entries, entry) => {
    if (
      entry.type === "session-notice" &&
      entry.notice.kind === "interrupted" &&
      entries.at(-1)?.type === "session-notice"
    ) {
      const prior = entries.at(-1)!;
      if (
        prior.type === "session-notice" &&
        prior.notice.kind === "error" &&
        entry.notice.assistantTimestamp !== undefined &&
        prior.assistantTimestamp === entry.notice.assistantTimestamp
      )
        entries.pop();
    }
    entries.push(entry);
    return entries;
  }, []);
}

/** Snapshot text at the event boundary: pi mutates partial messages while streaming. */
function decodeMetrics(state: ViewState, now: number) {
  const { tokens, ms, step } = state.decode;
  const elapsed = step ? Math.max(0, now - step.startedAt) : 0;
  if (step && elapsed < 500)
    return { value: ms > 0 ? (tokens * 1000) / ms : 0, nextWakeAt: step.startedAt + 500 };
  return {
    value: ms + elapsed > 0 ? ((tokens + (step?.chars ?? 0) / 4) * 1000) / (ms + elapsed) : 0,
    nextWakeAt: undefined,
  };
}

function reduceMessageEnd(
  state: ViewState,
  message: TranscriptMessage,
  now: number,
  t: ReturnType<typeof createTuiI18n>,
  facts: ConversationFacts,
): ViewState {
  const text = messageText(message);
  const outcome = messageNotice(message, facts);
  if (message.role === "session-notice") {
    if (!outcome) return state;
    const last = state.completed.at(-1);
    const completed =
      outcome.kind === "interrupted" &&
      last?.type === "session-notice" &&
      last.notice.kind === "error" &&
      outcome.assistantTimestamp !== undefined &&
      last.assistantTimestamp === outcome.assistantTimestamp
        ? state.completed.slice(0, -1)
        : state.completed;
    return { ...state, completed: [...completed, { type: "session-notice", notice: outcome }] };
  }
  if (message.role === "user") {
    if ("source" in message && message.source === "goal") return state;
    return {
      ...state,
      completed: [...state.completed, userMessageEntry(message)],
    };
  }
  if (message.role === "toolResult") {
    const tool = state.tools.find((candidate) => candidate.id === message.toolCallId) ??
      state.announcedTools.find((candidate) => candidate.id === message.toolCallId) ?? {
        id: message.toolCallId,
        name: message.toolName,
        args: undefined,
        summary: message.toolName,
      };
    const entry = toolEntry(tool, message.isError, message, t);
    return { ...state, completed: [...state.completed, ...(entry ? [entry] : [])] };
  }
  if (message.role !== "assistant") return state;
  const announcedTools = message.content.flatMap((block): ToolCall[] =>
    block.type === "toolCall"
      ? [
          {
            id: block.id,
            name: block.name,
            args: block.arguments,
            summary: toolSummary(block.name, block.arguments),
            callView: block.view,
            startedAt: message.timestamp,
          },
        ]
      : [],
  );
  const step = state.decode.step;
  return {
    ...state,
    announcedTools,
    // A committed model call has a preview while native authorization waits.
    // Execution activity still begins only with its native running-tool event.
    tools: [
      ...state.tools.filter((tool) => !announcedTools.some((call) => call.id === tool.id)),
      ...announcedTools,
    ],
    completed: [
      ...state.completed,
      ...(messageThinking(message)
        ? [
            {
              type: "thinking" as const,
              text: messageThinking(message),
              thinkingOpen: true,
              durationMs: facts.assistantThinkingDuration(message),
              anchorId: `${state.assistantAnchor}-thinking`,
            },
          ]
        : []),
      ...(text
        ? [
            {
              type: "message" as const,
              role: "assistant" as const,
              text,
              anchorId: state.assistantAnchor,
              fresh: true,
            },
          ]
        : []),
      ...(outcome
        ? [
            {
              type: "session-notice" as const,
              notice: outcome,
              assistantTimestamp: message.timestamp,
            },
          ]
        : []),
    ],
    assistant: "",
    reasoning: "",
    assistantTimestamp: message.timestamp,
    assistantAnchor: crypto.randomUUID(),
    input: state.input + message.usage.input,
    output: state.output + message.usage.output,
    activityInput: message.usage.input,
    streamedChars: 0,
    toolArgumentsChars: 0,
    decode: {
      tokens: state.decode.tokens + (step ? message.usage.output : 0),
      ms: state.decode.ms + (step ? Math.max(0, now - step.startedAt) : 0),
    },
  };
}

/** Keep frontend-only entries at their prior boundary when committed history is rebuilt. */
function retainLocalEntries(
  previous: readonly CompletedEntry[],
  committed: readonly CompletedEntry[],
): CompletedEntry[] {
  const key = (entry: CompletedEntry) =>
    entry.type === "run-summary" ? `run-${entry.endedAt}` : entry.anchorId;
  const positions = new Map(committed.map((entry, index) => [key(entry), index + 1]));
  const local = new Map<number, CompletedEntry[]>();
  let boundary = 0;
  for (const entry of previous) {
    if (entry.type === "notice" && !entry.sourceEntryId) {
      const group = local.get(boundary) ?? [];
      group.push(entry);
      local.set(boundary, group);
    } else {
      const anchor = key(entry);
      const position = anchor === undefined ? undefined : positions.get(anchor);
      if (position !== undefined) boundary = position;
    }
  }
  return [
    ...committed.flatMap((entry, index) => [...(local.get(index) ?? []), entry]),
    ...(local.get(committed.length) ?? []),
  ];
}

function reduceEvent(
  state: ViewState,
  event: SessionEvent,
  now: number,
  t: ReturnType<typeof createTuiI18n>,
  facts: ConversationFacts,
): ViewState {
  switch (event.type) {
    case "snapshot": {
      const partial = event.generation?.message;
      const knownCalls = new Map<string, ToolCall>();
      for (const message of event.messages) {
        if (message.role !== "assistant") continue;
        for (const block of message.content)
          if (block.type === "toolCall")
            knownCalls.set(block.id, {
              id: block.id,
              name: block.name,
              args: block.arguments,
              summary: toolSummary(block.name, block.arguments),
              callView: block.view,
              startedAt: message.timestamp,
            });
      }
      const replayed = replayMessages(
        event.messages,
        facts,
        t,
        [...event.runSummaries],
        new Set(
          event.tools
            .filter((slot) => slot.status === "pending" || slot.status === "running")
            .map((slot) => slot.callId),
        ),
      );
      const ordinals = new Map<string, number>();
      const anchored = replayed.map((entry) => {
        const key = `${entry.sourceEntryId}:${entry.type}`;
        const ordinal = ordinals.get(key) ?? 0;
        ordinals.set(key, ordinal + 1);
        const previous = state.completed.filter(
          (candidate) =>
            candidate.sourceEntryId === entry.sourceEntryId &&
            candidate.type === entry.type &&
            candidate.sourceEntryId !== undefined,
        )[ordinal];
        return previous ? { ...entry, anchorId: previous.anchorId } : entry;
      });
      const subagents = Object.fromEntries(
        Object.entries(restoreSubagents(event.toolStates.subagents)).map(([id, row]) => {
          const previous = state.subagents[id];
          return [id, reconcileSubagentIdentity(previous, row)];
        }),
      );
      for (const background of event.background) {
        const row = subagents[background.id];
        if (row)
          subagents[background.id] = {
            ...row,
            status: background.active && row.completedAt === undefined ? "running" : row.status,
          };
      }
      const tools = event.tools
        .filter((slot) => slot.status === "running" || slot.status === "pending")
        .map(
          (slot): ToolCall =>
            knownCalls.get(slot.callId) ?? {
              id: slot.callId,
              name: slot.name,
              args: undefined,
              summary: slot.name,
            },
        );
      return {
        ...state,
        completed: retainLocalEntries(state.completed, anchored),
        tools,
        announcedTools: [...knownCalls.values()],
        assistant: partial ? messageText(partial) : "",
        reasoning: partial ? messageThinking(partial) : "",
        reasoningSettled:
          !!partial &&
          (messageText(partial).length > 0 ||
            partial.content.some((block) => block.type === "toolCall")),
        model: event.model,
        planMode: event.planMode,
        todos: (event.toolStates.todo as TodoItem[] | undefined) ?? [],
        goal: event.toolStates.goal as GoalView | undefined,
        subagents,
        background: event.background,
        running: event.run !== undefined,
        // Footer usage belongs to Runs observed by this frontend instance.
        // Durable totals remain available through Session context reports;
        // replaying a snapshot must not count them again at Run settlement.
        usage: state.usage,
      };
    }
    case "subagent_event": {
      const subagents = {
        ...state.subagents,
        [event.agentId]: reduceSubagent(state.subagents[event.agentId], event, now),
      };
      return {
        ...state,
        subagents,
      };
    }
    case "run_start":
      return {
        ...state,
        running: true,
        error: undefined,
        input: 0,
        output: 0,
        activityInput: 0,
        streamedChars: 0,
        toolArgumentsChars: 0,
        decode: { tokens: 0, ms: 0 },
        assistant: "",
        reasoning: "",
      };
    case "run_end":
      return { ...state, running: false };
    case "tool_state_changed":
      if (event.name === "model" && typeof event.value === "string")
        return { ...state, model: event.value, contextUsage: undefined };
      if (event.name === "plan")
        return {
          ...state,
          planMode: (event.value as { active: boolean } | undefined)?.active ?? false,
        };
      return event.name === "todo"
        ? { ...state, todos: (event.value as TodoItem[] | undefined) ?? [] }
        : event.name === "subagents"
          ? {
              ...state,
              subagents: Object.fromEntries(
                Object.entries(restoreSubagents(event.value)).map(([id, row]) => [
                  id,
                  reconcileSubagentIdentity(state.subagents[id], row),
                ]),
              ),
            }
          : state;
    case "context_usage":
      return { ...state, contextUsage: event };
    case "turn_start":
      return {
        ...state,
        streamedChars: 0,
        toolArgumentsChars: 0,
        decode: { ...state.decode, step: undefined },
      };
    case "message_update": {
      const structural = event.changes.some(
        (change) => change.type === "message" || change.type === "block",
      );
      const growth = Math.max(
        0,
        messageText(event.message).length +
          messageThinking(event.message).length -
          state.assistant.length -
          state.reasoning.length,
      );
      const deltaChars = event.changes.reduce(
        (count, change) => count + ("delta" in change ? change.delta.length : 0),
        0,
      );
      const toolArgumentsChars = messageToolArguments(event.message);
      const chars = structural
        ? growth + Math.max(0, toolArgumentsChars - state.toolArgumentsChars)
        : deltaChars;
      const streamedChars =
        state.streamedChars +
        (structural
          ? growth
          : event.changes.reduce(
              (count, change) =>
                count +
                (change.type === "text_delta" || change.type === "thinking_delta"
                  ? change.delta.length
                  : 0),
              0,
            ));
      const step = state.decode.step;
      return {
        ...state,
        assistant: messageText(event.message),
        reasoning: messageThinking(event.message),
        reasoningDurationMs: facts.assistantThinkingDuration(event.message),
        reasoningSettled:
          state.reasoningSettled ||
          !!messageText(event.message) ||
          (event.message.role === "assistant" &&
            event.message.content.some((block) => block.type === "toolCall")),
        streamedChars,
        toolArgumentsChars,
        decode:
          chars > 0
            ? {
                ...state.decode,
                step: { startedAt: step?.startedAt ?? now, chars: (step?.chars ?? 0) + chars },
              }
            : state.decode,
      };
    }
    case "message_start":
      return event.message.role === "assistant"
        ? {
            ...state,
            assistant: messageText(event.message),
            toolArgumentsChars: messageToolArguments(event.message),
            reasoning: messageThinking(event.message),
            reasoningSettled: false,
            reasoningDurationMs: undefined,
            assistantAnchor: crypto.randomUUID(),
            streamedChars:
              messageText(event.message).length + messageThinking(event.message).length,
            decode:
              messageText(event.message).length +
                messageThinking(event.message).length +
                messageToolArguments(event.message) >
              0
                ? {
                    ...state.decode,
                    step: {
                      startedAt: now,
                      chars:
                        messageText(event.message).length +
                        messageThinking(event.message).length +
                        messageToolArguments(event.message),
                    },
                  }
                : { ...state.decode, step: undefined },
          }
        : state;
    case "message_end": {
      let next = state;
      for (const message of event.messages) {
        const length = next.completed.length;
        next = reduceMessageEnd(next, message, now, t, facts);
        next = {
          ...next,
          completed: next.completed.map((entry, index) =>
            index < length
              ? entry
              : {
                  ...entry,
                  sourceEntryId: event.entryId,
                  anchorId: entry.anchorId ?? `${event.entryId}-${index - length}-${entry.type}`,
                },
          ),
        };
      }
      return next;
    }
    case "tool_execution_start": {
      const started: ToolCall = {
        id: event.toolCallId,
        name: event.toolName,
        args: event.args,
        summary: toolSummary(event.toolName, event.args),
        callView: event.view,
        startedAt: state.assistantTimestamp,
      };
      return {
        ...state,
        tools: state.tools.some((tool) => tool.id === event.toolCallId)
          ? state.tools.map((tool) => (tool.id === event.toolCallId ? started : tool))
          : [...state.tools, started],
      };
    }
    case "permission_denied": {
      if (!((event.by === "rule" && event.rule !== undefined) || event.by === "hook")) return state;
      const annotate = (tool: ToolCall): ToolCall =>
        tool.id === event.toolCallId
          ? {
              ...tool,
              rule: event.rule,
              ...(event.by === "hook" && { hook: event.hook ?? "hook" }),
            }
          : tool;
      return {
        ...state,
        tools: state.tools.map(annotate),
        announcedTools: state.announcedTools.map(annotate),
      };
    }
    case "tool_execution_end": {
      const tool = state.tools.find((tool) => tool.id === event.toolCallId);
      if (!tool) return state;
      const entry = event.result
        ? toolEntry(tool, event.result.isError, { ...event.result, view: event.view }, t)
        : undefined;
      const job = entry?.type === "tool" && entry.jobId ? state.jobs[entry.jobId] : undefined;
      const explicit =
        tool.args !== null &&
        typeof tool.args === "object" &&
        "run_in_background" in tool.args &&
        tool.args.run_in_background === true;
      return {
        ...state,
        completed: event.result
          ? state.completed
          : [
              ...state.completed,
              {
                type: "tool",
                id: tool.id,
                name: tool.name,
                args: tool.args,
                callView: tool.callView,
                summary: tool.summary,
                isError: false,
                outcomeUnknown: true,
                anchorId: `unresolved-${tool.id}`,
              },
            ],
        jobs:
          job && tool.name === "bash" && !explicit
            ? { ...state.jobs, [job.id]: { ...job, promotedAt: job.backgroundedAt } }
            : state.jobs,
        tools: state.tools.filter((tool) => tool.id !== event.toolCallId),
      };
    }
    case "hook_warning":
    case "hook_message":
      return event.event === "SessionEnd"
        ? {
            ...state,
            completed: [
              ...state.completed,
              { type: "session-notice", notice: facts.sessionNoticeFromHook(event) },
            ],
          }
        : state;
    case "compaction_end":
      return state;
    case "mcp_server_error":
      return {
        ...state,
        completed: [
          ...state.completed,
          {
            type: "notice",
            text: t("notice.mcp-error", {
              server: event.server,
              error: formatError({ ...event.errorData, message: event.error }, t),
            }).replace(/\s+/g, " "),
          },
        ],
      };
    case "result":
      return {
        ...state,
        completed: [
          ...state.completed,
          {
            type: "run-summary",
            durationMs: event.durationMs,
            endedAt: event.endedAt ?? now,
            success: event.success,
          },
        ],
        assistant: "",
        reasoning: "",
        running: false,
        input: event.usage.input,
        output: event.usage.output,
        usage: {
          input: state.usage.input + event.usage.input,
          output: state.usage.output + event.usage.output,
          cacheRead: state.usage.cacheRead + event.usage.cacheRead,
          cacheWrite: state.usage.cacheWrite + event.usage.cacheWrite,
        },
        tpsSamples: [
          ...state.tpsSamples,
          { at: now, value: decodeMetrics(state, now).value },
        ].slice(-500),
        streamedChars: 0,
        toolArgumentsChars: 0,
        error: undefined,
      };
    default:
      return state;
  }
}

function createViewState(
  session: Session,
  model: string,
  locale: Locale,
  facts: ConversationFacts,
): ViewState {
  const t = createTuiI18n(locale);
  return {
    jobs: Object.fromEntries(session.jobs().map((job) => [job.id, readJobRow(session, job)])),
    jobNotice: undefined,
    planMode: session.planMode,
    goal: session.goal,
    background: [],
    subagents: restoreSubagents(session.toolState("subagents")),
    todos: (session.toolState("todo") as TodoItem[] | undefined) ?? [],
    completed: replayMessages(session.messages, facts, t, session.runSummaries()),
    tools: [],
    announcedTools: [],
    assistant: "",
    reasoning: "",
    assistantAnchor: crypto.randomUUID(),
    model: session.model ?? model,
    contextUsage: session.messages.some((message) => message.role !== "system")
      ? session.contextUsage()
      : undefined,
    running: session.running,
    input: 0,
    output: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    decode: { tokens: 0, ms: 0 },
    tpsSamples: [],
    activity: session.running
      ? reduce(createActivity(locale), { type: "submit" }, Date.now())
      : createActivity(locale),
    activityInput: 0,
    streamedChars: 0,
    toolArgumentsChars: 0,
  };
}

/** Own the active Run outside React so back-to-back input events cannot submit twice. */
export function createConversation(
  session: Session,
  model: string,
  facts: ConversationFacts,
  locale: Locale = "zh",
) {
  const t = createTuiI18n(locale);
  let state = createViewState(session, model, locale, facts);
  const listeners = new Set<() => void>();
  let compacting = false;
  let active: { promise: Promise<unknown>; input?: AbortController } | undefined;
  let pendingResult: { event: Extract<SessionEvent, { type: "result" }>; at: number } | undefined;
  let jobNoticeTimer: ReturnType<typeof setTimeout> | undefined;
  let notificationTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const authRequired = new Set<string>();
  const update = (next: ViewState, deferNotification = false) => {
    if (
      !next.running &&
      next.completed.some((entry) => entry.type === "thinking" && entry.thinkingOpen)
    )
      next = {
        ...next,
        completed: next.completed.map((entry) =>
          entry.type === "thinking" && entry.thinkingOpen
            ? { ...entry, thinkingOpen: false }
            : entry,
        ),
      };
    state =
      next.completed !== state.completed && next.completed.some((entry) => !entry.anchorId)
        ? {
            ...next,
            completed: next.completed.map((entry) =>
              entry.anchorId ? entry : { ...entry, anchorId: crypto.randomUUID() },
            ),
          }
        : next;
    if (!deferNotification) {
      clearTimeout(notificationTimer);
      notificationTimer = undefined;
      listeners.forEach((listener) => listener());
      return;
    }
    if (!listeners.size || notificationTimer !== undefined) return;
    // Fold every event immediately and in order; only React's notification is
    // coalesced so eight child Runs cannot nest dozens of sync store renders.
    notificationTimer = setTimeout(() => {
      notificationTimer = undefined;
      listeners.forEach((listener) => listener());
    }, 0);
  };
  const dispatchActivity = (event: Parameters<typeof reduce>[1]) => {
    update({ ...state, activity: reduce(state.activity, event, Date.now()) });
  };
  const notify = (text: string, kind: NoticeKind, durationMs = 4000) => {
    clearTimeout(noticeTimer);
    update({ ...state, notification: { text, kind } });
    noticeTimer = setTimeout(() => update({ ...state, notification: undefined }), durationMs);
  };
  const mcpNotice = (event: SessionEvent) => {
    if (event.type === "subagent_event") {
      mcpNotice(event.event);
      return;
    }
    if (event.type === "mcp_auth_required") {
      if (!authRequired.has(event.server)) {
        authRequired.add(event.server);
        notify(t("mcp.auth.required", { name: event.server }), "warning");
      }
    }
    if (event.type !== "tool_execution_end" || !event.result) return;
    const server = [...authRequired].find(
      (name) => event.toolName === `mcp__${name}__authenticate`,
    );
    if (!server) return;
    const details: unknown = event.result.details;
    if (event.result.isError)
      notify(
        t("mcp.auth.failure", {
          err: formatError(
            { ...(typeof details === "object" && details), message: resultText(event.result) },
            t,
          ),
        }),
        "error",
        8000,
      );
    else if (
      typeof details === "object" &&
      details !== null &&
      "type" in details &&
      "server" in details &&
      details.server === server
    ) {
      if (details.type === "authenticated")
        notify(t("mcp.auth.success", { name: server }), "success");
      else if (details.type === "cancelled") notify(t("mcp.auth.cancelled"), "dim");
    }
  };
  // Model stop results and frontend stop actions must reconcile this snapshot:
  // stopping can change without a new output event from a quiet process.
  const refreshJobs = () =>
    update(
      {
        ...state,
        jobs: Object.fromEntries(
          session.jobs().map((job) => [job.id, readJobRow(session, job, state.jobs[job.id])]),
        ),
      },
      true,
    );
  let stopped = false;
  const onEvent = (event: SessionEvent) => {
    if (stopped) return;
    mcpNotice(event);
    const now = Date.now();
    if (event.type === "job_event") {
      const previous = state.jobs[event.job.id];
      const job = readJobRow(session, event.job, previous);
      const settled = event.kind === "settled";
      let jobNotice = state.jobNotice;
      if (
        settled &&
        (job.status === "completed" || job.status === "failed" || job.status === "killed")
      ) {
        const duration = fmtDuration(Math.max(0, (job.endedAt ?? now) - job.startedAt), locale);
        jobNotice = {
          id: job.id,
          text: t(`jobs.notice.${job.status}`, {
            label: Bun.stripANSI(job.label).replace(/\s+/g, " "),
            id: job.id,
            duration,
          }),
          kind:
            job.status === "completed" ? "success" : job.status === "failed" ? "error" : "warning",
        };
        clearTimeout(jobNoticeTimer);
        jobNoticeTimer = setTimeout(() => {
          jobNoticeTimer = undefined;
          update({ ...state, jobNotice: undefined }, true);
        }, 6000);
      }
      update({ ...state, jobs: { ...state.jobs, [job.id]: job }, jobNotice }, true);
      return;
    }
    if (event.type === "conversation_rewound") {
      const restored = createViewState(session, state.model, locale, facts);
      update({
        ...restored,
        jobs: state.jobs,
        jobNotice: state.jobNotice,
        activity: { ...restored.activity, gitBranch: state.activity.gitBranch },
      });
      return;
    }
    if (event.type === "tool_execution_end" && event.toolName === "job_kill") {
      // Stop requests change the registry synchronously; a quiet process may
      // emit no output before settlement. Reconcile at the tool boundary.
      refreshJobs();
    }
    if (event.type === "result" && active) pendingResult = { event, at: now };
    if (event.type === "run_start") pendingResult = undefined;
    const settling =
      active && (event.type === "result" || (event.type === "snapshot" && !event.run));
    update(
      {
        ...reduceEvent(state, event, now, t, facts),
        ...(active && { running: true }),
        goal:
          event.type === "snapshot"
            ? (event.toolStates.goal as GoalView | undefined)
            : event.type === "tool_state_changed" && event.name === "goal"
              ? (event.value as GoalView | undefined)
              : state.goal,
        activity: settling
          ? state.activity
          : reduce(
              event.type === "run_start" && !state.running
                ? reduce(state.activity, { type: "submit" }, now)
                : state.activity,
              event,
              now,
            ),
      },
      event.type === "subagent_event",
    );
  };
  const unsubscribe = session.subscribe(onEvent);
  return {
    dispatchActivity,
    notify,
    report(title: string, text: string) {
      update({
        ...state,
        completed: [...state.completed, { type: "notice", text, report: title }],
      });
    },
    refreshJobs,
    notice(text: string, error = false) {
      state = { ...state, planMode: session.planMode };
      update(
        error
          ? { ...state, error: text }
          : {
              ...state,
              completed: [...state.completed, { type: "notice", text }],
            },
      );
    },
    getSnapshot: () => state,
    getTpsMetrics: (now: number) => decodeMetrics(state, now),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearTimeout(notificationTimer);
          notificationTimer = undefined;
        }
      };
    },
    submit(prompt: string, initial = false, images: PromptImage[] = []) {
      if (compacting) return false;
      if (!prompt.trim()) return false;
      const awaitIdle = !active && !state.running && session.running && !initial;
      if (active || (session.running && !initial && !awaitIdle)) {
        if (!images.length && !prompt.startsWith("/")) return false;
        void session.steer(prompt, { images }).catch((error: unknown) => {
          if (!stopped) notify(formatError(error, t), "error");
        });
        return true;
      }
      if (!session.running || awaitIdle)
        update({
          ...state,
          running: true,
          input: 0,
          output: 0,
          error: undefined,
          activityInput: 0,
          streamedChars: 0,
          toolArgumentsChars: 0,
          decode: { tokens: 0, ms: 0 },
          activity: reduce(state.activity, { type: "submit" }, Date.now()),
        });
      const input = new AbortController();
      const promise = (async () => {
        if (awaitIdle) await session.waitForIdle();
        if (stopped || input.signal.aborted) return;
        return session.run(prompt, { images });
      })()
        .catch((error: unknown) => {
          if (stopped) return;
          const last = state.completed.findLast((entry) => entry.type !== "run-summary");
          const recordedEnding =
            last?.type === "session-notice" &&
            last.notice.kind !== "hook_message" &&
            last.notice.kind !== "hook_warning";
          if (!state.activity.interrupted && !recordedEnding) {
            update({
              ...state,
              completed: [
                ...state.completed,
                ...state.tools
                  .filter(
                    (tool) =>
                      !state.completed.some(
                        (entry) => entry.type === "tool" && entry.id === tool.id,
                      ),
                  )
                  .map((tool): CompletedEntry => ({
                    type: "tool",
                    id: tool.id,
                    name: tool.name,
                    args: tool.args,
                    callView: tool.callView,
                    summary: tool.summary,
                    isError: false,
                    outcomeUnknown: true,
                    anchorId: `unresolved-${tool.id}`,
                  })),
              ],
              assistant: "",
              reasoning: "",
              tools: [],
              error: formatError(error, t),
            });
          } else {
            update({ ...state, assistant: "", reasoning: "", tools: [], error: undefined });
          }
        })
        .finally(() => {
          active = undefined;
          if (!stopped && !session.running)
            update({
              ...state,
              running: false,
              activity: pendingResult
                ? reduce(state.activity, pendingResult.event, pendingResult.at)
                : { ...state.activity, phase: "idle", tools: [], reviews: [] },
            });
          pendingResult = undefined;
        });
      active = { promise, input };
      return true;
    },
    compact(instructions?: string) {
      if (active || session.running)
        return Promise.reject(new Error("Session already has an active Run."));
      compacting = true;
      const previousActivity = state.activity;
      update({
        ...state,
        running: true,
        error: undefined,
        activity: reduce(state.activity, { type: "submit" }, Date.now()),
      });
      const promise = session.compact({ instructions }).finally(() => {
        active = undefined;
        compacting = false;
        if (!stopped) update({ ...state, running: false, activity: previousActivity });
      });
      active = { promise };
      return promise;
    },
    async loadSubagent(id: string) {
      const owner = state.subagents[id];
      if (!owner || owner.historyLoaded) return;
      const snapshot = await session.readSubagent(id);
      const row = state.subagents[id];
      if (!snapshot || !row || row.historyLoaded || row.startedAt !== owner.startedAt) return;
      // Native snapshots contain the full committed history and current
      // generation; replacing once avoids duplicating a separately read prefix.
      update({
        ...state,
        subagents: {
          ...state.subagents,
          [id]: { ...projectSubagent(row, snapshot), historyLoaded: true },
        },
      });
    },
    isRunning: () => active !== undefined || session.running,
    interrupt() {
      if (!active && !session.running) return;
      dispatchActivity({ type: "interrupt" });
      active?.input?.abort();
      void session.abort().catch((error: unknown) => {
        if (!stopped) notify(formatError(error, t), "error");
      });
    },
    async stop() {
      stopped = true;
      active?.input?.abort();
      unsubscribe();
      clearTimeout(noticeTimer);
      clearTimeout(jobNoticeTimer);
      clearTimeout(notificationTimer);
    },
  };
}
