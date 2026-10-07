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
  SessionRecovery,
  TodoItem,
} from "@rukie/agent";
import {
  isUnknownToolOutcome,
  type ContextUsageEvent,
  type RunResult,
  type ContextReport,
  type JobView,
  type ToolCallView,
  type ToolResultView,
} from "@rukie/shared";
import type { TpsSample } from "../transcript/metrics";
import { reduceSubagent, restoreSubagents, projectSubagent, type SubagentState } from "./subagents";
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

type CompletedEntry = { anchorId?: string } & (
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
  | { type: "context-report"; report: ContextReport; expanded: boolean; modelName?: string }
);

type ToolResultMessage = Extract<
  Extract<SessionEvent, { type: "message_end" }>["message"],
  { role: "toolResult" }
>;

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
  },
  t: ReturnType<typeof createTuiI18n>,
): CompletedEntry | undefined {
  if (isUnknownToolOutcome(result.details) && !showsToolCard(tool.name))
    return { type: "notice", text: t("tool.outcome-unknown") };
  if (isUnknownToolOutcome(result.details))
    return {
      type: "tool",
      summary: tool.summary,
      isError: false,
      outcomeUnknown: true,
      result: t("tool.outcome-unknown"),
    };
  // Events supply live provenance; persisted tool results retain the rule on replay.
  const rule =
    tool.rule ??
    (isError && resultText(result).startsWith("Denied by permission rule: ")
      ? resultText(result).slice("Denied by permission rule: ".length)
      : undefined);
  const provenance =
    typeof result.details === "object" &&
    result.details !== null &&
    "permissionDenied" in result.details &&
    typeof result.details.permissionDenied === "object" &&
    result.details.permissionDenied !== null
      ? result.details.permissionDenied
      : undefined;
  const hook =
    tool.hook ??
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
    isError,
    result: isError ? undefined : resultText(result),
    error: isError
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
  waitingSubagents: number;
  subagents: Readonly<Record<string, SubagentState>>;
  todos: readonly TodoItem[];
  completed: CompletedEntry[];
  tools: ToolCall[];
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
  error?: string;
}

function messageText(message: Extract<SessionEvent, { type: "message_end" }>["message"]) {
  if (message.role !== "user" && message.role !== "assistant") return "";
  return typeof message.content === "string"
    ? message.content
    : message.content
        .flatMap((content) => (content.type === "text" ? [content.text] : []))
        .join("");
}

function messageThinking(message: Extract<SessionEvent, { type: "message_end" }>["message"]) {
  return message.role === "assistant"
    ? message.content
        .flatMap((content) => (content.type === "thinking" ? [content.thinking] : []))
        .join("\n")
    : "";
}

function userMessageEntry(
  message: Extract<Session["messages"][number], { role: "user" }>,
): CompletedEntry {
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
): CompletedEntry[] {
  const tools = new Map<string, ToolCall>();
  const replayed = messages.flatMap((message): CompletedEntry[] => {
    const text = messageText(message);
    if (message.role === "compactionSummary")
      return [{ type: "notice", text: t("notice.compaction", { tokens: message.tokensBefore }) }];
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
  });
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

function reduceEvent(
  state: ViewState,
  event: SessionEvent,
  now: number,
  t: ReturnType<typeof createTuiI18n>,
  facts: ConversationFacts,
  recovery?: SessionRecovery,
): ViewState {
  switch (event.type) {
    case "subagent_event": {
      const subagents = {
        ...state.subagents,
        [event.agentId]: reduceSubagent(state.subagents[event.agentId], event, now),
      };
      return {
        ...state,
        subagents,
        waitingSubagents: state.waitingSubagents
          ? Object.values(subagents).filter((row) => row.status === "running").length
          : 0,
      };
    }
    case "subagents_waiting":
      return { ...state, waitingSubagents: event.count };
    case "agent_start":
      return { ...state, waitingSubagents: 0 };
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
                Object.entries(restoreSubagents(event.value, recovery)).map(([id, row]) => [
                  id,
                  state.subagents[id]
                    ? {
                        ...state.subagents[id]!,
                        runOutcome: row.runOutcome,
                        runReason: row.runReason,
                      }
                    : row,
                ]),
              ),
            }
          : state;
    case "session_start":
      return {
        ...state,
        model: event.model,
        running: true,
        error: undefined,
        input: 0,
        output: 0,
        activityInput: 0,
        streamedChars: 0,
        decode: { tokens: 0, ms: 0 },
      };
    case "context_usage":
      return { ...state, contextUsage: event };
    case "turn_start":
      return {
        ...state,
        waitingSubagents: 0,
        streamedChars: 0,
        decode: { ...state.decode, step: undefined },
      };
    case "message_update": {
      const delta = event.assistantMessageEvent;
      const streamedChars =
        state.streamedChars +
        (delta.type === "text_delta" || delta.type === "thinking_delta" ? delta.delta.length : 0);
      const chars =
        delta.type === "text_delta" ||
        delta.type === "thinking_delta" ||
        delta.type === "toolcall_delta"
          ? delta.delta.length
          : 0;
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
            reasoning: messageThinking(event.message),
            reasoningSettled: false,
            reasoningDurationMs: undefined,
            assistantAnchor: crypto.randomUUID(),
          }
        : state;
    case "message_end": {
      const text = messageText(event.message);
      const outcome = messageNotice(event.message, facts);
      if (event.message.role === "session-notice") {
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
      if (event.message.role === "user") {
        if ("source" in event.message && event.message.source === "goal") return state;
        return {
          ...state,
          completed: [...state.completed, userMessageEntry(event.message)],
        };
      }
      if (event.message.role === "toolResult") {
        const result = event.message;
        return {
          ...state,
          completed: state.completed.map((entry) =>
            entry.type === "tool" && entry.id === result.toolCallId
              ? { ...entry, endedAt: result.timestamp }
              : entry,
          ),
        };
      }
      if (event.message.role !== "assistant") return state;
      const step = state.decode.step;
      return {
        ...state,
        completed: [
          ...state.completed,
          ...(messageThinking(event.message)
            ? [
                {
                  type: "thinking" as const,
                  text: messageThinking(event.message),
                  thinkingOpen: true,
                  durationMs: facts.assistantThinkingDuration(event.message),
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
                  assistantTimestamp: event.message.timestamp,
                },
              ]
            : []),
        ],
        assistant: "",
        reasoning: "",
        assistantTimestamp: event.message.timestamp,
        assistantAnchor: crypto.randomUUID(),
        input: state.input + event.message.usage.input,
        output: state.output + event.message.usage.output,
        activityInput: event.message.usage.input,
        streamedChars: 0,
        decode: {
          tokens: state.decode.tokens + (step ? event.message.usage.output : 0),
          ms: state.decode.ms + (step ? Math.max(0, now - step.startedAt) : 0),
        },
      };
    }
    case "tool_execution_start":
      return {
        ...state,
        tools: [
          ...state.tools,
          {
            id: event.toolCallId,
            name: event.toolName,
            args: event.args,
            summary: toolSummary(event.toolName, event.args),
            callView: event.view,
            startedAt: state.assistantTimestamp,
          },
        ],
      };
    case "permission_denied":
      return (event.by === "rule" && event.rule !== undefined) || event.by === "hook"
        ? {
            ...state,
            tools: state.tools.map((tool) =>
              tool.id === event.toolCallId
                ? {
                    ...tool,
                    rule: event.rule,
                    ...(event.by === "hook" && { hook: event.hook ?? "hook" }),
                  }
                : tool,
            ),
          }
        : state;
    case "tool_execution_end": {
      const tool = state.tools.find((tool) => tool.id === event.toolCallId);
      if (!tool) return state;
      const entry = toolEntry(tool, event.isError, { ...event.result, view: event.view }, t);
      const job = entry?.type === "tool" && entry.jobId ? state.jobs[entry.jobId] : undefined;
      const explicit =
        tool.args !== null &&
        typeof tool.args === "object" &&
        "run_in_background" in tool.args &&
        tool.args.run_in_background === true;
      return {
        ...state,
        jobs:
          job && tool.name === "bash" && !explicit
            ? { ...state.jobs, [job.id]: { ...job, promotedAt: job.backgroundedAt } }
            : state.jobs,
        tools: state.tools.filter((tool) => tool.id !== event.toolCallId),
        completed: [...state.completed, ...(entry ? [entry] : [])],
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
    case "mcp_server_error":
      return {
        ...state,
        completed: [
          ...state.completed,
          {
            type: "notice",
            text:
              event.type === "compaction_end"
                ? t("notice.compaction", { tokens: event.tokensBefore })
                : t("notice.mcp-error", {
                    server: event.server,
                    error: formatError({ ...event.errorData, message: event.error }, t),
                  }).replace(/\s+/g, " "),
          },
        ],
      };
    case "result":
      return {
        ...state,
        completed: state.completed,
        assistant: "",
        reasoning: "",
        running: false,
        waitingSubagents: 0,
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
    waitingSubagents: 0,
    subagents: restoreSubagents(session.toolState("subagents"), session.recovery),
    todos: (session.toolState("todo") as TodoItem[] | undefined) ?? [],
    completed: replayMessages(session.messages, facts, t).map((entry) => ({
      ...entry,
      anchorId: crypto.randomUUID(),
    })),
    tools: [],
    assistant: "",
    reasoning: "",
    assistantAnchor: crypto.randomUUID(),
    model: session.model ?? model,
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
  let active: { controller: AbortController; promise: Promise<unknown> } | undefined;
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
    if (event.type !== "tool_execution_end") return;
    const server = [...authRequired].find(
      (name) => event.toolName === `mcp__${name}__authenticate`,
    );
    if (!server) return;
    const details: unknown = event.result.details;
    if (event.isError)
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
  const childReconciliations = new Map<string, symbol>();
  let stopped = false;
  const reconcileChild = async (id: string, token: symbol) => {
    const snapshot = await session.readSubagent(id);
    const row = state.subagents[id];
    if (!snapshot || !row || childReconciliations.get(id) !== token) return;
    update({
      ...state,
      subagents: {
        ...state.subagents,
        [id]: { ...projectSubagent(row, snapshot), historyLoaded: true },
      },
    });
  };
  const onEvent = (event: SessionEvent) => {
    if (event.type === "subagent_event") {
      if (event.event.type === "session_start") childReconciliations.delete(event.agentId);
      if (!stopped && event.event.type === "conversation_reconciled") {
        // Re-read the committed child branch even if its earlier history was loaded.
        // A later Run invalidates this read before it can replace newer streaming output.
        const token = Symbol();
        childReconciliations.set(event.agentId, token);
        void reconcileChild(event.agentId, token).catch((error) => {
          if (childReconciliations.get(event.agentId) === token)
            notify(formatError(error, t), "error");
        });
      }
    }
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
    if (event.type === "conversation_rewound" || event.type === "conversation_reconciled") {
      childReconciliations.clear();
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
    update(
      {
        ...reduceEvent(
          state,
          event,
          now,
          t,
          facts,
          event.type === "tool_state_changed" && event.name === "subagents"
            ? session.recovery
            : undefined,
        ),
        goal:
          event.type === "result" || (event.type === "tool_state_changed" && event.name === "goal")
            ? session.goal
            : state.goal,
        activity: reduce(
          event.type === "session_start" && !state.running
            ? reduce(state.activity, { type: "submit" }, now)
            : state.activity,
          event,
          now,
        ),
      },
      event.type === "subagent_event",
    );
  };
  // Startup hooks can start a run before the chat exists. Remove the already
  // replayed messages from the snapshot, then fold the buffered events once.
  const startupEvents: SessionEvent[] = [];
  let observing = false;
  const unsubscribe = session.subscribe((event) => {
    if (observing) onEvent(event);
    else startupEvents.push(event);
  });
  if (startupEvents.length) {
    const emittedMessages = new Set(
      startupEvents.flatMap((event) =>
        event.type === "message_end" ? [JSON.stringify(event.message)] : [],
      ),
    );
    state = {
      ...state,
      completed: replayMessages(
        session.messages.filter((message) => !emittedMessages.has(JSON.stringify(message))),
        facts,
        t,
      ),
    };
    for (const event of startupEvents) onEvent(event);
  }
  observing = true;
  const recovered = session.recovery.subagents;
  if (recovered.length) {
    state = {
      ...state,
      completed: [
        ...state.completed,
        {
          type: "notice",
          text: [
            t("resume.subagents", { count: recovered.length }),
            ...recovered.flatMap((child) => [
              `${t(`subagent.outcome.${child.outcome}`)}: ${child.description}`,
              ...(child.diagnostic ? [t("resume.unconfirmed")] : []),
            ]),
            t("resume.no-automatic-continuation"),
            t("resume.continue-guidance"),
          ].join("\n"),
        },
      ],
    };
  }
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
    contextReport(report: ContextReport, expanded = false, modelName?: string) {
      update({
        ...state,
        completed: [
          ...state.completed,
          { type: "context-report", report: structuredClone(report), expanded, modelName },
        ],
      });
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
      if (active || (session.running && !initial)) {
        if (!images.length && !prompt.startsWith("/")) return false;
        session.steer(prompt, { images });
        return true;
      }
      const controller = new AbortController();
      if (!session.running)
        update({
          ...state,
          running: true,
          waitingSubagents: 0,
          input: 0,
          output: 0,
          error: undefined,
          activityInput: 0,
          streamedChars: 0,
          decode: { tokens: 0, ms: 0 },
          activity: reduce(state.activity, { type: "submit" }, Date.now()),
        });
      const promise = session
        .run(prompt, {
          signal: controller.signal,
          images,
        })
        .catch((error: unknown) => {
          const last = state.completed.at(-1);
          const recordedEnding =
            last?.type === "session-notice" &&
            last.notice.kind !== "hook_message" &&
            last.notice.kind !== "hook_warning";
          if (!controller.signal.aborted && !recordedEnding) {
            update({
              ...state,
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
          if (!session.running) update({ ...state, running: false, waitingSubagents: 0 });
        });
      active = { controller, promise };
      return true;
    },
    compact(instructions?: string) {
      if (active || session.running)
        return Promise.reject(new Error("Session already has an active Run."));
      compacting = true;
      const controller = new AbortController();
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
        update({ ...state, running: false, activity: previousActivity });
      });
      active = { controller, promise };
      return promise;
    },
    async loadSubagent(id: string) {
      const owner = state.subagents[id];
      if (!owner || owner.historyLoaded) return;
      const snapshot = await session.readSubagent(id);
      const row = state.subagents[id];
      if (!snapshot || !row || row.historyLoaded || row.startedAt !== owner.startedAt) return;
      if (row.status === "running") {
        if (!snapshot.run || snapshot.run.endedAt !== undefined || !snapshot.historyMessages)
          return;
        const history = projectSubagent(row, {
          ...snapshot,
          messages: snapshot.historyMessages,
        });
        update({
          ...state,
          subagents: {
            ...state.subagents,
            [id]: {
              ...row,
              output: [...history.output, ...row.output],
              toolCalls: [...history.toolCalls, ...row.toolCalls],
              messageOutputStart: (row.messageOutputStart ?? 0) + history.output.length,
              historyLoaded: true,
            },
          },
        });
      } else {
        update({
          ...state,
          subagents: {
            ...state.subagents,
            [id]: { ...projectSubagent(row, snapshot), historyLoaded: true },
          },
        });
      }
    },
    isRunning: () => active !== undefined || session.running,
    interrupt() {
      if (!active && !session.running) return;
      dispatchActivity({ type: "interrupt" });
      session.interruptRun();
      active?.controller.abort();
    },
    async stop() {
      stopped = true;
      childReconciliations.clear();
      const pending = active;
      session.interruptRun();
      pending?.controller.abort();
      try {
        await pending?.promise;
      } catch (error) {
        if (!pending?.controller.signal.aborted) throw error;
      }
      await session.waitForIdle();
      unsubscribe();
      clearTimeout(noticeTimer);
      clearTimeout(jobNoticeTimer);
      clearTimeout(notificationTimer);
    },
  };
}
