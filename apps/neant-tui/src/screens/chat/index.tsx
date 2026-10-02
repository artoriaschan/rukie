import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createSession, type SessionOptions } from "@neant/agent";
import type { ThinkingLevel } from "@neant/shared";
import {
  Box,
  ScrollBox,
  ThemedText,
  useInput,
  useTerminalSize,
  type ScrollHandle,
  type ScrollSnapshot,
} from "@neant/tui";
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
          thinking={options.settings?.thinking}
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
  thinking,
  onExit,
}: {
  conversation: ReturnType<typeof createConversation>;
  permissions: ReturnType<typeof createPermissions>;
  cwd: string;
  thinking?: ThinkingLevel;
  onExit(): void;
}) {
  const state = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const question = useSyncExternalStore(permissions.subscribe, permissions.getSnapshot);
  const [input, setInput] = useState("");
  const { columns, rows } = useTerminalSize();
  const small = columns < 40 || rows < 12;
  const body = useRef<ScrollHandle>(null);
  const details = useRef<ScrollHandle>(null);
  const [bodyScroll, setBodyScroll] = useState<ScrollSnapshot>();
  const [scrollFocus, setScrollFocus] = useState<"body" | "details">("body");
  const [unread, setUnread] = useState(false);
  const previousOutput = useRef({
    completed: state.completed,
    assistant: state.assistant,
    tools: state.tools,
    error: state.error,
  });
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
  useEffect(() => {
    setScrollFocus("body");
  }, [question?.request.toolCallId]);
  useEffect(() => {
    const previous = previousOutput.current;
    if (bodyScroll?.following) setUnread(false);
    else if (
      previous.completed !== state.completed ||
      previous.assistant !== state.assistant ||
      previous.tools !== state.tools ||
      previous.error !== state.error
    )
      setUnread(true);
    previousOutput.current = {
      completed: state.completed,
      assistant: state.assistant,
      tools: state.tools,
      error: state.error,
    };
  }, [bodyScroll?.following, state.completed, state.assistant, state.tools, state.error]);
  const change = (value: string) => {
    draft.current = value;
    lastInterrupt.current = undefined;
    setInput(value);
  };
  useInput((event) => {
    if (event.type === "wheel") {
      if (small) return;
      const viewport = details.current?.getSnapshot();
      if (
        question &&
        viewport &&
        event.x >= viewport.x &&
        event.x < viewport.x + viewport.width &&
        event.y >= viewport.y &&
        event.y < viewport.y + viewport.height
      )
        details.current?.scrollBy(event.delta * 3);
      else if (bodyScroll && event.y >= bodyScroll.y && event.y < bodyScroll.y + bodyScroll.height)
        body.current?.scrollBy(event.delta * 3);
      lastInterrupt.current = undefined;
      return;
    }
    if (event.type !== "key") {
      lastInterrupt.current = undefined;
      return;
    }
    const { key } = event;
    const pending = permissions.getSnapshot();
    if (!small && key.ctrl && key.name === "end") {
      body.current?.scrollToBottom();
      lastInterrupt.current = undefined;
      return;
    }
    if (!small && pending && key.name === "tab") {
      setScrollFocus((focus) => (focus === "body" ? "details" : "body"));
      lastInterrupt.current = undefined;
      return;
    }
    if (!small && (key.name === "pageup" || key.name === "pagedown")) {
      const viewport = pending && scrollFocus === "details" ? details.current : body.current;
      viewport?.scrollBy(
        Math.max(1, (viewport.getSnapshot().height ?? 1) - 1) * (key.name === "pageup" ? -1 : 1),
      );
      lastInterrupt.current = undefined;
      return;
    }
    if (small && key.name !== "escape" && !(key.ctrl && (key.name === "c" || key.name === "d")))
      return;
    if (!small && pending && !(key.ctrl && key.name === "c")) {
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
  const completed = useMemo(
    () =>
      state.completed.map((entry, index) => {
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
      }),
    [state.completed],
  );
  return (
    <Box flexDirection="column" height={rows}>
      <ScrollBox
        ref={body}
        onScroll={setBodyScroll}
        height={small ? 0 : undefined}
        flexGrow={small ? 0 : 1}
      >
        <Logo
          key="startup-logo"
          model={state.model}
          cwd={cwd}
          thinking={thinking}
          working={state.running}
        />
        {completed}
        {state.assistant && <AssistantMessage text={state.assistant} />}
        {state.tools.map((tool) => (
          <ToolCall key={tool.id} summary={tool.summary} status="running" />
        ))}
        {state.error && <Notice kind="error" text={state.error} />}
      </ScrollBox>
      <Box flexDirection="column" flexShrink={0}>
        {small ? (
          <ThemedText wrap="truncate">请调整窗口至至少 40 列 × 12 行 · Ctrl+C 中断/退出</ThemedText>
        ) : (
          <>
            {bodyScroll && !bodyScroll.following && (
              <ThemedText color="subtle" wrap="truncate">
                {unread ? "有新输出 · Ctrl+End 回到底部" : "Ctrl+End 回到底部"}
              </ThemedText>
            )}
            {state.running && activity.phase !== "idle" && (
              <ActivityLine
                phase={activity.phase}
                line={activity.line}
                suffix={` · ↑ ${fmtTokens(state.activityInput)} · ↓ ${fmtTokens(state.output + Math.ceil(state.streamedChars / 4))} tokens · esc 中断`}
              />
            )}
            {question && (
              <PermissionDialog
                key={question.request.toolCallId}
                toolName={question.request.toolName}
                args={question.request.args}
                selected={question.selected}
                maxHeight={Math.floor(rows / 2)}
                scrollRef={details}
                scrollFocused={scrollFocus === "details"}
              />
            )}
            {!question && (
              <PromptInput
                maxLines={Math.max(1, Math.min(6, Math.floor(rows / 3)) - 3)}
                columns={columns}
                working={state.running}
                value={input}
                onChange={change}
                onSubmit={(prompt) => {
                  if (conversation.submit(prompt)) {
                    body.current?.scrollToBottom();
                    change("");
                  }
                }}
              />
            )}
            <StatusLine model={state.model} input={state.input} output={state.output} />
          </>
        )}
      </Box>
    </Box>
  );
}
