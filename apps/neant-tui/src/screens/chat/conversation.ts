import { basename } from "node:path";
import type { Locale } from "@neant/i18n";
import { createTuiI18n, formatError } from "../../i18n";
import type {
  PromptImage,
  GoalView,
  Session,
  SessionEvent,
  SessionRecovery,
  TodoItem,
} from "@neant/agent";
import {
  isUnknownToolOutcome,
  type ContextUsageEvent,
  type RunResult,
  type ContextReport,
} from "@neant/shared";
import type { TpsSample } from "../../components/status-line";
import { goalPhasePresentation } from "../../components";
import { reduceSubagent, restoreSubagents, type SubagentState } from "./subagents";
import { createActivity, reduce } from "./activity/activity";

interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  summary: string;
  rule?: string;
  hook?: string;
}

type CompletedEntry =
  | {
      type: "message";
      role: "user" | "assistant";
      text: string;
      source?: string;
      images?: PromptImage[];
    }
  | {
      type: "tool";
      summary: string;
      isError: boolean;
      outcomeUnknown?: boolean;
      result?: string;
      images?: PromptImage[];
      error?: string;
      agentId?: string;
      planReview?: { plan: string; kind: "approve" | "revise" | "takeover"; feedback?: string };
    }
  | { type: "notice"; text: string }
  | { type: "context-report"; report: ContextReport };

type ToolResultMessage = Extract<
  Extract<SessionEvent, { type: "message_end" }>["message"],
  { role: "toolResult" }
>;

function resultText(result: Pick<ToolResultMessage, "content">) {
  return result.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("\n");
}

function toolSummary(name: string, args: unknown) {
  if (
    name === "web_fetch" &&
    typeof args === "object" &&
    args !== null &&
    "url" in args &&
    typeof args.url === "string"
  )
    return `web_fetch ${args.url}`;
  return `${name} ${JSON.stringify(args)}`.replace(/\s+/g, " ");
}

function toolEntry(
  tool: Pick<ToolCall, "name" | "args" | "summary" | "rule" | "hook">,
  isError: boolean,
  result: Pick<ToolResultMessage, "content" | "details">,
  t: ReturnType<typeof createTuiI18n>,
): CompletedEntry {
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
  const goal =
    ["create_goal", "update_goal"].includes(tool.name) && !isError
      ? goalSummary(resultText(result), t)
      : undefined;
  const todo = tool.name === "todo_write" && !isError ? todoSummary(tool.args, t) : undefined;
  return {
    type: "tool",
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
          ? { name: basename(tool.args.path) }
          : {}),
      })),
    ...(review && { planReview: review }),
    summary:
      goal !== undefined
        ? goal.summary
        : todo !== undefined
          ? t("todo.summary")
          : tool.name === "ask_user_question" && !isError
            ? t("question.summary")
            : tool.summary,
    isError,
    agentId:
      typeof result.details === "object" &&
      result.details !== null &&
      "agentId" in result.details &&
      typeof result.details.agentId === "string"
        ? result.details.agentId
        : undefined,
    result: isError
      ? undefined
      : tool.name === "ask_user_question"
        ? questionSummary(tool.args, resultText(result), t)
        : tool.name === "web_fetch"
          ? resultText(result).split(/\r?\n/)[0]
          : (goal?.result ?? todo ?? resultText(result)),
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

function goalSummary(text: string, t: ReturnType<typeof createTuiI18n>) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("goal" in value) ||
    !("armed" in value) ||
    typeof value.armed !== "boolean"
  )
    return undefined;
  const goal = value.goal;
  if (
    typeof goal !== "object" ||
    goal === null ||
    !("objective" in goal) ||
    typeof goal.objective !== "string" ||
    !("phase" in goal) ||
    typeof goal.phase !== "string" ||
    !("roundsStarted" in goal) ||
    typeof goal.roundsStarted !== "number" ||
    !("maxRounds" in goal) ||
    typeof goal.maxRounds !== "number"
  )
    return undefined;
  const phase = goal.phase;
  if (phase !== "active" && phase !== "paused" && phase !== "blocked" && phase !== "complete")
    return undefined;
  const presentation = goalPhasePresentation[phase];
  const singleLine = (text: string) => text.replace(/[\r\n]+/g, " ");
  return {
    summary: `🎯 ${singleLine(goal.objective)}`,
    result:
      `${presentation.glyph} ${phase} · ${goal.roundsStarted}/${goal.maxRounds} · ${t(value.armed ? "goal.armed" : "goal.disarmed")}` +
      (goal.phase === "blocked" && "blockedReason" in goal && typeof goal.blockedReason === "string"
        ? `\n⛔ ${singleLine(goal.blockedReason)}`
        : ""),
  };
}

function todoSummary(args: unknown, t: ReturnType<typeof createTuiI18n>) {
  if (typeof args !== "object" || args === null || !("todos" in args)) return undefined;
  const todos = args.todos;
  if (
    !Array.isArray(todos) ||
    !todos.every(
      (item) =>
        typeof item?.content === "string" &&
        ["pending", "in_progress", "completed"].includes(item.status),
    )
  )
    return undefined;
  const done = todos.filter((todo) => todo.status === "completed").length;
  // The tool heading and progress row leave two rows within the four-row card budget.
  return [
    t("todo.progress", { done, total: todos.length }),
    ...todos
      .filter((todo) => todo.status === "in_progress")
      .slice(0, 2)
      .map((todo) => `● ${todo.content.trim().replace(/[\r\n]+/g, " ")}`),
  ].join("\n");
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

interface ViewState {
  goal: GoalView | undefined;
  planMode: boolean;
  waitingSubagents: number;
  subagents: Readonly<Record<string, SubagentState>>;
  todos: readonly TodoItem[];
  completed: CompletedEntry[];
  tools: ToolCall[];
  assistant: string;
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

function replayMessages(
  messages: Session["messages"],
  t: ReturnType<typeof createTuiI18n>,
): CompletedEntry[] {
  const tools = new Map<string, ToolCall>();
  return messages.flatMap((message): CompletedEntry[] => {
    const text = messageText(message);
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
          });
      }
      return text ? [{ type: "message", role: "assistant", text }] : [];
    }
    if (message.role === "toolResult") {
      const tool = tools.get(message.toolCallId) ?? {
        name: message.toolName,
        args: undefined,
        summary: message.toolName,
      };
      tools.delete(message.toolCallId);
      return [toolEntry(tool, message.isError, message, t)];
    }
    return [];
  });
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
        ? { ...state, assistant: messageText(event.message) }
        : state;
    case "message_end": {
      const text = messageText(event.message);
      if (event.message.role === "user") {
        if ("source" in event.message && event.message.source === "goal") return state;
        return {
          ...state,
          completed: [...state.completed, userMessageEntry(event.message)],
        };
      }
      if (event.message.role !== "assistant") return state;
      const step = state.decode.step;
      return {
        ...state,
        completed: text
          ? [...state.completed, { type: "message", role: "assistant", text }]
          : state.completed,
        assistant: "",
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
      return {
        ...state,
        tools: state.tools.filter((tool) => tool.id !== event.toolCallId),
        completed: [...state.completed, toolEntry(tool, event.isError, event.result, t)],
      };
    }
    case "compaction_end":
    case "mcp_server_error":
    case "hook_warning":
    case "hook_message":
      return {
        ...state,
        completed: [
          ...state.completed,
          {
            type: "notice",
            text:
              event.type === "hook_warning"
                ? t("notice.hook-warning", {
                    event: event.event,
                    hook: event.hook,
                    message: formatError({ ...event.error, message: event.message }, t),
                  }).replace(/\s+/g, " ")
                : event.type === "hook_message"
                  ? event.message
                  : event.type === "compaction_end"
                    ? t("notice.compaction", { tokens: event.tokensBefore })
                    : t("notice.mcp-error", { server: event.server, error: event.error }).replace(
                        /\s+/g,
                        " ",
                      ),
          },
        ],
      };
    case "result":
      return {
        ...state,
        completed: [
          ...state.completed,
          ...(state.assistant
            ? [{ type: "message" as const, role: "assistant" as const, text: state.assistant }]
            : []),
          ...(event.stopReason === "hook_stopped" || event.stopReason === "hook_blocked"
            ? [
                {
                  type: "notice" as const,
                  text: t(
                    event.stopReason === "hook_blocked"
                      ? "notice.hook-blocked"
                      : "notice.hook-stopped",
                    { reason: event.reason ?? "" },
                  ),
                },
              ]
            : []),
        ],
        assistant: "",
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
        error: event.success || state.activity.interrupted ? undefined : event.error,
      };
    default:
      return state;
  }
}

function createViewState(session: Session, model: string, locale: Locale): ViewState {
  const t = createTuiI18n(locale);
  return {
    planMode: session.planMode,
    goal: session.goal,
    waitingSubagents: 0,
    subagents: restoreSubagents(session.toolState("subagents"), session.recovery),
    todos: (session.toolState("todo") as TodoItem[] | undefined) ?? [],
    completed: replayMessages(session.messages, t),
    tools: [],
    assistant: "",
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
export function createConversation(session: Session, model: string, locale: Locale = "zh") {
  const t = createTuiI18n(locale);
  let state = createViewState(session, model, locale);
  const listeners = new Set<() => void>();
  let compacting = false;
  let active: { controller: AbortController; promise: Promise<unknown> } | undefined;
  let notificationTimer: ReturnType<typeof setTimeout> | undefined;
  const update = (next: ViewState, deferNotification = false) => {
    state = next;
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
  const onEvent = (event: SessionEvent) => {
    const now = Date.now();
    if (event.type === "conversation_rewound") {
      const restored = createViewState(session, state.model, locale);
      update({
        ...restored,
        activity: { ...restored.activity, gitBranch: state.activity.gitBranch },
      });
      return;
    }
    update(
      {
        ...reduceEvent(
          state,
          event,
          now,
          t,
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
    contextReport(report: ContextReport) {
      update({
        ...state,
        completed: [
          ...state.completed,
          { type: "context-report", report: structuredClone(report) },
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
          if (!controller.signal.aborted) {
            update({ ...state, error: formatError(error, t) });
          } else {
            update({ ...state, error: undefined });
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
    isRunning: () => active !== undefined || session.running,
    interrupt() {
      if (!active && !session.running) return;
      dispatchActivity({ type: "interrupt" });
      session.interruptRun();
      active?.controller.abort();
    },
    async stop() {
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
    },
  };
}
