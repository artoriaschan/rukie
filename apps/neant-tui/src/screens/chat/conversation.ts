import type { Locale } from "@neant/i18n";
import { createTuiI18n } from "../../i18n";
import type { Session, SessionEvent } from "@neant/agent";
import type { ContextUsageEvent, RunResult } from "@neant/shared";
import type { TpsSample } from "../../components/status-line";
import { createActivity, reduce } from "./activity/activity";

interface ToolCall {
  id: string;
  summary: string;
}

type CompletedEntry =
  | { type: "message"; role: "user" | "assistant"; text: string }
  | { type: "tool"; summary: string; isError: boolean; result?: string; error?: string }
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
  summary: string,
  isError: boolean,
  result: Pick<ToolResultMessage, "content">,
): CompletedEntry {
  return {
    type: "tool",
    summary,
    isError,
    result: isError ? undefined : resultText(result),
    error: isError ? resultText(result) : undefined,
  };
}

interface ViewState {
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

function replayMessages(messages: Session["messages"]): CompletedEntry[] {
  const tools = new Map<string, string>();
  return messages.flatMap((message): CompletedEntry[] => {
    const text = messageText(message);
    if (message.role === "user") return [{ type: "message", role: "user", text }];
    if (message.role === "assistant") {
      for (const content of message.content) {
        if (content.type === "toolCall")
          tools.set(content.id, toolSummary(content.name, content.arguments));
      }
      return text ? [{ type: "message", role: "assistant", text }] : [];
    }
    if (message.role === "toolResult") {
      const summary = tools.get(message.toolCallId) ?? message.toolName;
      tools.delete(message.toolCallId);
      return [toolEntry(summary, message.isError, message)];
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
    case "session_start":
      return { ...state, model: event.model };
    case "context_usage":
      return { ...state, contextUsage: event };
    case "turn_start":
      return { ...state, streamedChars: 0, decode: { ...state.decode, step: undefined } };
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
          completed: [...state.completed, { type: "message", role: "user", text }],
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
            summary: toolSummary(event.toolName, event.args),
          },
        ],
      };
    case "tool_execution_end": {
      const tool = state.tools.find((tool) => tool.id === event.toolCallId);
      if (!tool) return state;
      return {
        ...state,
        tools: state.tools.filter((tool) => tool.id !== event.toolCallId),
        completed: [...state.completed, toolEntry(tool.summary, event.isError, event.result)],
      };
    }
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
        completed: state.assistant
          ? [...state.completed, { type: "message", role: "assistant", text: state.assistant }]
          : state.completed,
        assistant: "",
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
        error: event.success ? undefined : event.error,
      };
    default:
      return state;
  }
}

/** Own the active Run outside React so back-to-back input events cannot submit twice. */
export function createConversation(session: Session, model: string, locale: Locale = "zh") {
  const t = createTuiI18n(locale);
  let state: ViewState = {
    completed: replayMessages(session.messages),
    tools: [],
    assistant: "",
    model,
    running: false,
    input: 0,
    output: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    decode: { tokens: 0, ms: 0 },
    tpsSamples: [],
    activity: createActivity(),
    activityInput: 0,
    streamedChars: 0,
  };
  const listeners = new Set<() => void>();
  let active: { controller: AbortController; promise: Promise<unknown> } | undefined;
  const update = (next: ViewState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const dispatchActivity = (event: Parameters<typeof reduce>[1]) => {
    update({ ...state, activity: reduce(state.activity, event, Date.now()) });
  };
  return {
    dispatchActivity,
    getSnapshot: () => state,
    getTpsMetrics: (now: number) => decodeMetrics(state, now),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    submit(prompt: string) {
      if (active || !prompt.trim()) return false;
      const controller = new AbortController();
      update({
        ...state,
        running: true,
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
          onEvent: (event) => {
            const now = Date.now();
            update({
              ...reduceEvent(state, event, now, t),
              activity: reduce(state.activity, event, now),
            });
          },
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            update({ ...state, error: error instanceof Error ? error.message : String(error) });
          } else {
            update({ ...state, error: undefined });
          }
        })
        .finally(() => {
          active = undefined;
          update({ ...state, running: false });
        });
      active = { controller, promise };
      return true;
    },
    isRunning: () => active !== undefined,
    interrupt() {
      if (!active) return;
      dispatchActivity({ type: "interrupt" });
      active.controller.abort();
    },
    async stop() {
      active?.controller.abort();
      await active?.promise;
    },
  };
}
