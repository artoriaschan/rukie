import type { Locale } from "@neant/i18n";
import { createTuiI18n, formatError } from "../../i18n";
import type { Session, SessionEvent, TodoItem } from "@neant/agent";
import type { ContextUsageEvent, RunResult } from "@neant/shared";
import type { TpsSample } from "../../components/status-line";
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
  | { type: "message"; role: "user" | "assistant"; text: string; source?: string }
  | {
      type: "tool";
      summary: string;
      isError: boolean;
      result?: string;
      error?: string;
      agentId?: string;
      planReview?: { plan: string; kind: "approve" | "revise" | "takeover"; feedback?: string };
    }
  | { type: "notice"; text: string };

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
  return `${name} ${JSON.stringify(args)}`.replace(/\s+/g, " ");
}

function toolEntry(
  tool: Pick<ToolCall, "name" | "args" | "summary" | "rule" | "hook">,
  isError: boolean,
  result: Pick<ToolResultMessage, "content" | "details">,
  t: ReturnType<typeof createTuiI18n>,
): CompletedEntry {
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
  const todo = tool.name === "todo_write" && !isError ? todoSummary(tool.args, t) : undefined;
  return {
    type: "tool",
    ...(review && { planReview: review }),
    summary:
      todo !== undefined
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
        : (todo ?? resultText(result)),
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
    if (message.role === "user") return [userMessageEntry(message)];
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
      if (event.name === "plan")
        return { ...state, planMode: (event.value as { active: boolean }).active };
      return event.name === "todo"
        ? { ...state, todos: event.value as TodoItem[] }
        : event.name === "subagents"
          ? { ...state, subagents: { ...restoreSubagents(event.value), ...state.subagents } }
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

/** Own the active Run outside React so back-to-back input events cannot submit twice. */
export function createConversation(session: Session, model: string, locale: Locale = "zh") {
  const t = createTuiI18n(locale);
  let state: ViewState = {
    planMode: session.planMode,
    waitingSubagents: 0,
    subagents: restoreSubagents(session.toolState("subagents")),
    todos: (session.toolState("todo") as TodoItem[] | undefined) ?? [],
    completed: replayMessages(session.messages, t),
    tools: [],
    assistant: "",
    model,
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
  const listeners = new Set<() => void>();
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
    update(
      {
        ...reduceEvent(state, event, now, t),
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
  return {
    dispatchActivity,
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
    submit(prompt: string) {
      const command = /^\/plan(?:\s+([\s\S]*))?$/i.exec(prompt.trim());
      if (command) {
        const instruction = command[1]?.trim() ?? "";
        const off = instruction.toLowerCase() === "off";
        const alreadyActive = session.planMode;
        void session.setPlanMode(!off).catch((error: unknown) => {
          update({ ...state, planMode: session.planMode, error: formatError(error, t) });
        });
        update({ ...state, planMode: session.planMode });
        if (!instruction || off) {
          update({
            ...state,
            completed: [
              ...state.completed,
              {
                type: "notice",
                text: t(
                  off ? "plan.disabled" : alreadyActive ? "plan.already-active" : "plan.enabled",
                ),
              },
            ],
          });
          return true;
        }
        prompt = instruction;
      }
      if (active || session.running || !prompt.trim()) return false;
      const controller = new AbortController();
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
    isRunning: () => active !== undefined || session.running,
    interrupt() {
      if (!active && !session.running) return;
      dispatchActivity({ type: "interrupt" });
      session.interruptRun();
      active?.controller.abort();
    },
    async stop() {
      session.interruptRun();
      active?.controller.abort();
      await active?.promise;
      unsubscribe();
    },
  };
}
