import type { Session, SessionEvent } from "@neant/agent";

interface ToolCall {
  id: string;
  summary: string;
}

type CompletedEntry =
  | { type: "message"; role: "user" | "assistant"; text: string }
  | { type: "tool"; summary: string; isError: boolean; error?: string }
  | { type: "notice"; text: string };

type ToolResultMessage = Extract<
  Extract<SessionEvent, { type: "message_end" }>["message"],
  { role: "toolResult" }
>;

function errorPreview(result: Pick<ToolResultMessage, "content">) {
  return result.content
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join("\n")
    .split(/\r?\n/)
    .slice(0, 3)
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
    error: isError ? errorPreview(result) : undefined,
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
function reduceEvent(state: ViewState, event: SessionEvent): ViewState {
  switch (event.type) {
    case "session_start":
      return { ...state, model: event.model };
    case "message_start":
    case "message_update":
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
      return {
        ...state,
        completed: text
          ? [...state.completed, { type: "message", role: "assistant", text }]
          : state.completed,
        assistant: "",
        input: state.input + event.message.usage.input,
        output: state.output + event.message.usage.output,
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
    case "compaction":
    case "mcp_server_error":
      return {
        ...state,
        completed: [
          ...state.completed,
          {
            type: "notice",
            text:
              event.type === "compaction"
                ? `Context compacted (${event.tokensBefore} tokens)`
                : `MCP server ${event.server}: ${event.error}`.replace(/\s+/g, " "),
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
        error: event.success ? undefined : event.error,
      };
    default:
      return state;
  }
}

/** Own the active Run outside React so back-to-back input events cannot submit twice. */
export function createConversation(session: Session, model: string) {
  let state: ViewState = {
    completed: replayMessages(session.messages),
    tools: [],
    assistant: "",
    model,
    running: false,
    input: 0,
    output: 0,
  };
  const listeners = new Set<() => void>();
  let active: { controller: AbortController; promise: Promise<unknown> } | undefined;
  const update = (next: ViewState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    submit(prompt: string) {
      if (active || !prompt.trim()) return false;
      const controller = new AbortController();
      update({ ...state, running: true, input: 0, output: 0, error: undefined });
      const promise = session
        .run(prompt, {
          signal: controller.signal,
          onEvent: (event) => update(reduceEvent(state, event)),
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
    interrupt: () => active?.controller.abort(),
    async stop() {
      active?.controller.abort();
      await active?.promise;
    },
  };
}
