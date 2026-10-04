import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createSession, type Session, type SessionOptions } from "@neant/agent";
import type { Locale } from "@neant/i18n";
import { PERMISSION_MODES, type ThinkingLevel } from "@neant/shared";
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
  GoalTodoPanel,
  Logo,
  Notice,
  PermissionDialog,
  QuestionDialog,
  PromptInput,
  ScrollToBottom,
  StatusLine,
  ToolCall,
  UserMessage,
} from "../../components";
import { createTuiI18n } from "../../i18n";
import { createConversation } from "./conversation";
import { createInteractions } from "./interactions";
import { permissionChoices } from "../../components/permission-dialog/permission-dialog";
import { fmtTokens, render as renderActivity } from "./activity/activity";

/** Bind the Session and private stores to one chat screen for its lifetime. */
export async function createChat(options: SessionOptions, model: string, locale: Locale = "zh") {
  const t = createTuiI18n(locale);
  const interactions = createInteractions();
  const session = await createSession({
    ...options,
    reminderSources: [
      ...(options.reminderSources ?? []),
      { source: "narration", currentContent: () => t("narrate-instruction") },
    ],
    onPermissionAsk: options.onPermissionAsk ?? interactions.askPermission,
    onQuestion: options.onQuestion ?? interactions.askQuestion,
  });
  const conversation = createConversation(session, model, locale);
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
          session={session}
          conversation={conversation}
          interactions={interactions}
          cwd={options.cwd}
          thinking={options.settings?.thinking}
          locale={locale}
          onExit={onExit}
        />
      );
    },
  };
}

function Chat({
  session,
  conversation,
  interactions,
  cwd,
  thinking,
  locale,
  onExit,
}: {
  session: Session;
  conversation: ReturnType<typeof createConversation>;
  interactions: ReturnType<typeof createInteractions>;
  cwd: string;
  thinking?: ThinkingLevel;
  locale: Locale;
  onExit(): void;
}) {
  const t = createTuiI18n(locale);
  const state = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const interaction = useSyncExternalStore(interactions.subscribe, interactions.getSnapshot);
  const question = interaction?.kind === "permission" ? interaction : undefined;
  const userQuestion = interaction?.kind === "question" ? interaction : undefined;
  const currentQuestion = userQuestion?.drafts[userQuestion.questionIndex];
  const [input, setInput] = useState("");
  const [todosCollapsed, setTodosCollapsed] = useState(false);
  const toggleTodos = () => setTodosCollapsed((collapsed) => !collapsed);
  const [mode, setMode] = useState(session.permissionMode);
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
  const currentTime = Math.max(now, Date.now());
  const activity = renderActivity(state.activity, currentTime);
  const speed = conversation.getTpsMetrics(currentTime);
  const nextWakeAt = Math.min(activity.nextWakeAt ?? Infinity, speed.nextWakeAt ?? Infinity);
  useEffect(() => {
    if (!state.running || !Number.isFinite(nextWakeAt)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextWakeAt - Date.now()));
    return () => clearTimeout(timer);
  }, [state.running, nextWakeAt]);
  const approvalOpen = interaction !== undefined;
  useEffect(() => {
    conversation.dispatchActivity({ type: approvalOpen ? "approval-open" : "approval-close" });
  }, [conversation, approvalOpen]);
  useEffect(() => {
    setScrollFocus("body");
  }, [interaction?.request.toolCallId]);
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
  const returnToBottom = () => {
    body.current?.scrollToBottom();
    lastInterrupt.current = undefined;
  };
  const showReturn = !!bodyScroll && !bodyScroll.following;
  const statusHeight = state.contextUsage && columns - 2 >= 14 ? 3 : 2;
  const hasActivity = state.running && activity.phase !== "idle";
  const promptMaxLines = Math.max(1, Math.min(6, Math.floor(rows / 3)) - 3);
  const hasTodos = state.todos.some((todo) => state.running || todo.status !== "completed");
  const minimumDialogHeight = question
    ? permissionChoices(question.request.mode).length + 3
    : userQuestion
      ? 4
      : 0;
  // Reserve the dialog's bottom gap and at least one transcript row before allocating chrome.
  const permissionSpace = rows - statusHeight - 2;
  const compactReturn =
    showReturn &&
    (interaction
      ? permissionSpace < minimumDialogHeight + Number(hasActivity) + 2
      : hasTodos && rows - statusHeight - (promptMaxLines + 3) - Number(hasActivity) - 3 < 2);
  const returnHeight = showReturn ? (compactReturn ? 1 : 2) : 0;
  // The dialog title already conveys waiting for approval when this duplicate line cannot fit.
  const showActivity =
    hasActivity && (!interaction || permissionSpace >= minimumDialogHeight + returnHeight + 1);
  const dialogMaxHeight = Math.max(
    minimumDialogHeight,
    Math.min(Math.floor(rows / 2), permissionSpace - returnHeight - Number(showActivity)),
  );
  const todoMaxHeight = Math.max(
    1,
    rows - statusHeight - (promptMaxLines + 3) - returnHeight - Number(showActivity) - 1,
  );
  useInput((event) => {
    if (event.type === "move") return;
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
    const pendingInteraction = interactions.getSnapshot();
    const pending = pendingInteraction?.kind === "permission" ? pendingInteraction : undefined;
    if (key.ctrl && key.name === "q" && !key.alt && !key.shift) {
      toggleTodos();
      lastInterrupt.current = undefined;
      return;
    }
    if (key.name === "tab" && key.shift && !key.ctrl && !key.alt) {
      lastInterrupt.current = undefined;
      if (!pendingInteraction && !small) {
        const next =
          PERMISSION_MODES[
            (PERMISSION_MODES.indexOf(session.permissionMode) + 1) % PERMISSION_MODES.length
          ]!;
        session.setPermissionMode(next);
        setMode(next);
      }
      return;
    }
    if (!small && key.ctrl && key.name === "end") {
      returnToBottom();
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
    if (pendingInteraction?.kind === "question" && !(key.ctrl && key.name === "c")) {
      lastInterrupt.current = undefined;
      if (key.name === "escape") interactions.declineQuestion();
      else if (!small && !key.ctrl && !key.alt && !key.shift) {
        const current = pendingInteraction.drafts[pendingInteraction.questionIndex]!;
        if (
          pendingInteraction.request.questions.length > 1 &&
          ["tab", "left", "right"].includes(key.name)
        ) {
          interactions.switchQuestion(key.name === "left" ? -1 : 1);
          return;
        }
        if (current.editing) return;
        if (key.name === "enter") interactions.answerQuestion();
        else if (event.input === " ") interactions.toggleQuestion();
        else if (key.name === "up") interactions.selectQuestion(current.selected - 1);
        else if (key.name === "down") interactions.selectQuestion(current.selected + 1);
        else if (
          /^[1-9]$/.test(event.input) &&
          Number(event.input) <=
            pendingInteraction.request.questions[pendingInteraction.questionIndex]!.options.length +
              1
        )
          interactions.selectQuestion(Number(event.input) - 1);
      }
      return;
    }
    if (!small && pending && !(key.ctrl && key.name === "c")) {
      lastInterrupt.current = undefined;
      if (key.name === "escape") interactions.denyPermission();
      else if (!key.ctrl && !key.alt && !key.shift) {
        if (key.name === "enter") interactions.confirmPermission();
        else if (key.name === "up" || key.name === "left")
          interactions.selectPermission(pending.selected - 1);
        else if (key.name === "down" || key.name === "right")
          interactions.selectPermission(pending.selected + 1);
        else if (
          /^[1-3]$/.test(event.input) &&
          Number(event.input) <= permissionChoices(pending.request.mode).length
        )
          interactions.selectPermission(Number(event.input) - 1);
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
          locale={locale}
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
          <ThemedText wrap="truncate">{t("window.small")}</ThemedText>
        ) : (
          <>
            {showReturn && (
              <ScrollToBottom
                locale={locale}
                columns={columns}
                unread={unread}
                onClick={returnToBottom}
                compact={compactReturn}
              />
            )}
            {showActivity && (
              <ActivityLine
                locale={locale}
                phase={activity.phase}
                warnPct={
                  state.contextUsage && state.contextUsage.window > 0
                    ? Math.round((state.contextUsage.used / state.contextUsage.window) * 100)
                    : undefined
                }
                line={activity.line}
                suffix={` · ↑ ${fmtTokens(state.activityInput)} · ↓ ${fmtTokens(state.output + Math.ceil(state.streamedChars / 4))} tokens`}
              />
            )}
            {!interaction && (
              <GoalTodoPanel
                todos={state.todos}
                working={state.running}
                collapsed={todosCollapsed}
                onToggle={toggleTodos}
                locale={locale}
                maxHeight={todoMaxHeight}
              />
            )}
            {question && (
              <PermissionDialog
                locale={locale}
                key={question.request.toolCallId}
                toolName={question.request.toolName}
                args={question.request.args}
                mode={question.request.mode}
                reason={question.request.reason}
                selected={question.selected}
                maxHeight={dialogMaxHeight}
                scrollRef={details}
                scrollFocused={scrollFocus === "details"}
              />
            )}
            {userQuestion && currentQuestion && (
              <QuestionDialog
                key={`${userQuestion.request.toolCallId}-${userQuestion.questionIndex}`}
                question={userQuestion.request.questions[userQuestion.questionIndex]!}
                questionIndex={userQuestion.questionIndex}
                questionCount={userQuestion.request.questions.length}
                selected={currentQuestion.selected}
                checked={currentQuestion.checked}
                editing={currentQuestion.editing}
                custom={currentQuestion.custom}
                onCustomChange={interactions.changeQuestionCustom}
                onCustomSubmit={interactions.answerQuestion}
                maxHeight={dialogMaxHeight}
                columns={columns}
                locale={locale}
              />
            )}
            {!interaction && (
              <PromptInput
                maxLines={promptMaxLines}
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
            <StatusLine
              locale={locale}
              columns={columns}
              mode={mode}
              model={state.model.slice(state.model.indexOf("/") + 1)}
              provider={state.model.split("/")[0]!}
              contextUsage={state.contextUsage}
              thinking={thinking}
              tps={speed.value}
              tpsSamples={state.tpsSamples}
              now={currentTime}
              usage={state.usage}
              gitBranch={state.activity.gitBranch}
              cwd={cwd}
              working={state.running}
            />
          </>
        )}
      </Box>
    </Box>
  );
}
