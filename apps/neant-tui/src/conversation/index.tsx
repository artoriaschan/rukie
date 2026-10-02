import { useRef, useState, useSyncExternalStore } from "react";
import type { Session, SessionEvent } from "@neant/agent";
import { Box, Static, Text, TextInput, useInput } from "@neant/tui";

interface ViewState {
  completed: string[];
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
        return { ...state, completed: [...state.completed, `> ${text}`] };
      }
      if (event.message.role !== "assistant") return state;
      return {
        ...state,
        completed: text ? [...state.completed, text] : state.completed,
        assistant: "",
        input: state.input + event.message.usage.input,
        output: state.output + event.message.usage.output,
      };
    }
    case "result":
      return {
        ...state,
        completed: state.assistant ? [...state.completed, state.assistant] : state.completed,
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
    completed: [],
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

export function Conversation({
  conversation,
  onExit,
}: {
  conversation: ReturnType<typeof createConversation>;
  onExit(): void;
}) {
  const state = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const [input, setInput] = useState("");
  const draft = useRef("");
  const lastInterrupt = useRef<number | undefined>(undefined);
  const change = (value: string) => {
    draft.current = value;
    lastInterrupt.current = undefined;
    setInput(value);
  };
  useInput((event) => {
    if (event.type !== "key") {
      lastInterrupt.current = undefined;
      return;
    }
    const { key } = event;
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      if (conversation.isRunning()) {
        conversation.interrupt();
        lastInterrupt.current = undefined;
      } else if (key.ctrl) {
        if (draft.current) change("");
        else {
          const now = performance.now();
          if (lastInterrupt.current !== undefined && now - lastInterrupt.current <= 1000) onExit();
          else lastInterrupt.current = now;
        }
      }
    } else if (key.ctrl && key.name === "d" && !draft.current) {
      if (!conversation.isRunning()) onExit();
    } else lastInterrupt.current = undefined;
  });
  return (
    <Box flexDirection="column">
      <Static>
        {state.completed.map((text, index) => (
          <Text key={index}>{text}</Text>
        ))}
      </Static>
      {state.assistant && <Text>{state.assistant}</Text>}
      {state.error && <Text color="red">{state.error}</Text>}
      <Box>
        <Box width={2} flexShrink={0}>
          <Text>{">"}</Text>
        </Box>
        <Box flexGrow={1}>
          <TextInput
            value={input}
            onChange={change}
            onSubmit={(prompt) => {
              if (conversation.submit(prompt)) change("");
            }}
          />
        </Box>
      </Box>
      <Text
        dimColor
      >{`${state.model} · input ${state.input} · output ${state.output} · ${state.running ? "Running" : "Ready"}`}</Text>
    </Box>
  );
}
