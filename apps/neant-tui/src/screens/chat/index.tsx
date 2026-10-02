import { useRef, useState, useSyncExternalStore } from "react";
import { createSession, type SessionOptions } from "@neant/agent";
import { Box, Static, useInput } from "@neant/tui";
import {
  AssistantMessage,
  Notice,
  PermissionDialog,
  PromptInput,
  StatusLine,
  ToolCall,
  UserMessage,
} from "../../components";
import { createConversation } from "./conversation";
import { createPermissions } from "./permissions";

/** Bind the Session and private stores to one chat screen for its lifetime. */
export async function createChat(options: SessionOptions, model: string) {
  const permissions = createPermissions();
  const session = await createSession({
    ...options,
    onPermissionAsk: options.onPermissionAsk ?? permissions.ask,
  });
  const conversation = createConversation(session, model);
  return {
    submit: conversation.submit,
    stop: conversation.stop,
    Chat({ onExit }: { onExit(): void }) {
      return <Chat conversation={conversation} permissions={permissions} onExit={onExit} />;
    },
  };
}

function Chat({
  conversation,
  permissions,
  onExit,
}: {
  conversation: ReturnType<typeof createConversation>;
  permissions: ReturnType<typeof createPermissions>;
  onExit(): void;
}) {
  const state = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const question = useSyncExternalStore(permissions.subscribe, permissions.getSnapshot);
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
    const pending = permissions.getSnapshot();
    if (pending && !(key.ctrl && key.name === "c")) {
      lastInterrupt.current = undefined;
      if (key.name === "escape") permissions.deny();
      else if (!key.ctrl && !key.alt && !key.shift) {
        if (key.name === "enter") permissions.confirm();
        else if (key.name === "up" || key.name === "left") permissions.select(pending.selected - 1);
        else if (key.name === "down" || key.name === "right")
          permissions.select(pending.selected + 1);
        else if (/^[1-3]$/.test(event.input)) permissions.select(Number(event.input) - 1);
      }
      return;
    }
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
        {state.completed.map((entry, index) => {
          switch (entry.type) {
            case "tool":
              return (
                <ToolCall
                  key={index}
                  summary={entry.summary}
                  status={entry.isError ? "error" : "success"}
                  result={entry.result}
                  error={entry.error}
                />
              );
            case "notice":
              return <Notice key={index} kind="info" text={entry.text} />;
            case "message":
              return entry.role === "user" ? (
                <UserMessage key={index} text={entry.text} />
              ) : (
                <AssistantMessage key={index} text={entry.text} />
              );
          }
        })}
      </Static>
      {state.assistant && <AssistantMessage text={state.assistant} />}
      {state.tools.map((tool) => (
        <ToolCall key={tool.id} summary={tool.summary} status="running" />
      ))}
      {state.error && <Notice kind="error" text={state.error} />}
      {question && (
        <PermissionDialog
          toolName={question.request.toolName}
          args={question.request.args}
          selected={question.selected}
        />
      )}
      {!question && (
        <PromptInput
          value={input}
          onChange={change}
          onSubmit={(prompt) => {
            if (conversation.submit(prompt)) change("");
          }}
        />
      )}
      <StatusLine
        model={state.model}
        input={state.input}
        output={state.output}
        running={state.running}
      />
    </Box>
  );
}
