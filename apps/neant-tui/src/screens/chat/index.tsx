import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createSession, type SessionOptions } from "@neant/agent";
import { Box, Static, useInput } from "@neant/tui";
import {
  AssistantMessage,
  ActivityLine,
  Logo,
  Notice,
  PermissionDialog,
  PromptInput,
  StatusLine,
  ToolCall,
  UserMessage,
} from "../../components";
import { createConversation } from "./conversation";
import { createPermissions } from "./permissions";
import { NARRATE_INSTRUCTION } from "./narration";
import { fmtTokens, render as renderActivity } from "./activity/activity";

/** Bind the Session and private stores to one chat screen for its lifetime. */
export async function createChat(options: SessionOptions, model: string) {
  const permissions = createPermissions();
  const session = await createSession({
    ...options,
    reminderSources: [
      ...(options.reminderSources ?? []),
      { source: "narration", currentContent: () => NARRATE_INSTRUCTION },
    ],
    onPermissionAsk: options.onPermissionAsk ?? permissions.ask,
  });
  const conversation = createConversation(session, model);
  try {
    const git = Bun.spawn(["git", "branch", "--show-current"], {
      cwd: options.cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    const branch = await new Response(git.stdout).text();
    if ((await git.exited) === 0)
      conversation.dispatchActivity({ type: "git-branch", branch: branch.trim() });
  } catch {
    // Missing git or a non-repository cwd simply omits the branch segment.
  }
  return {
    submit: conversation.submit,
    stop: conversation.stop,
    Chat({ onExit }: { onExit(): void }) {
      return (
        <Chat
          conversation={conversation}
          permissions={permissions}
          cwd={options.cwd}
          onExit={onExit}
        />
      );
    },
  };
}

function Chat({
  conversation,
  permissions,
  cwd,
  onExit,
}: {
  conversation: ReturnType<typeof createConversation>;
  permissions: ReturnType<typeof createPermissions>;
  cwd: string;
  onExit(): void;
}) {
  const state = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const question = useSyncExternalStore(permissions.subscribe, permissions.getSnapshot);
  const [input, setInput] = useState("");
  const draft = useRef("");
  const lastInterrupt = useRef<number | undefined>(undefined);
  const [now, setNow] = useState(Date.now);
  const activity = renderActivity(state.activity, Math.max(now, Date.now()));
  useEffect(() => {
    if (!state.running || activity.nextWakeAt === undefined) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, activity.nextWakeAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [state.running, state.activity, activity.nextWakeAt]);
  const approvalOpen = question !== undefined;
  useEffect(() => {
    conversation.dispatchActivity({ type: approvalOpen ? "approval-open" : "approval-close" });
  }, [conversation, approvalOpen]);
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
        <Logo key="startup-logo" model={state.model} cwd={cwd} />
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
      {state.running && activity.phase !== "idle" && (
        <ActivityLine
          phase={activity.phase}
          line={activity.line}
          suffix={` · ↑ ${fmtTokens(state.activityInput)} · ↓ ${fmtTokens(state.output + Math.ceil(state.streamedChars / 4))} tokens · esc 中断`}
        />
      )}
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
      <StatusLine model={state.model} input={state.input} output={state.output} />
    </Box>
  );
}
