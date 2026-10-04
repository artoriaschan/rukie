import { useLayoutEffect, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createSession, type Session, type SessionOptions } from "@neant/agent";
import type { Locale } from "@neant/i18n";
import { PERMISSION_MODES, type ThinkingLevel } from "@neant/shared";
import {
  Box,
  ScrollBox,
  ThemedText,
  createTextInputHistory,
  useInput,
  useTerminalSize,
  type ScrollHandle,
  type ScrollSnapshot,
} from "@neant/tui";
import {
  allocatePanelHeights,
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
  SubagentMessage,
  SubagentPanel,
  SubagentDashboard,
  SubagentDetailScene,
  UserMessage,
} from "../../components";
import type { DetailPage } from "../../components/subagent-detail";
import { createTuiI18n } from "../../i18n";
import { createInputHistory } from "../../input-history";
import { createConversation } from "./conversation";
import { createInteractions } from "./interactions";
import { permissionChoices } from "../../components/permission-dialog";
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
  const history = await createInputHistory(options.cwd, options.homeDir);
  const inputHistory = createTextInputHistory(history.entries);
  const submit = (prompt: string) => {
    if (!conversation.submit(prompt)) return false;
    history.remember(prompt);
    inputHistory.reset();
    return true;
  };
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
    submit,
    async stop() {
      await conversation.stop();
      await history.flush();
    },
    Chat({ onExit }: { onExit(): void }) {
      return (
        <Chat
          session={session}
          conversation={conversation}
          history={inputHistory}
          submit={submit}
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
  history,
  submit,
  interactions,
  cwd,
  thinking,
  locale,
  onExit,
}: {
  session: Session;
  conversation: ReturnType<typeof createConversation>;
  history: ReturnType<typeof createTextInputHistory>;
  submit(prompt: string): boolean;
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
  const isCurrentQuestion = () => {
    const live = interactions.getSnapshot();
    return (
      live?.kind === "question" &&
      live.request === userQuestion?.request &&
      live.questionIndex === userQuestion.questionIndex
    );
  };
  type View = "chat" | "dashboard" | { detail: string; from: "chat" | "dashboard" };
  const [view, setView] = useState<View>("chat");
  const viewRef = useRef<View>("chat");
  const switchView = (next: View) => {
    viewRef.current = next;
    setView(next);
  };
  const [focusIndex, setFocusIndex] = useState(0);
  const focusRef = useRef(0);
  const [page, setPage] = useState<DetailPage>("summary");
  const pageRef = useRef<DetailPage>("summary");
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const subagentScroll = useRef<ScrollHandle>(null);
  const savedChatScroll = useRef<ScrollSnapshot | undefined>(undefined);
  const savedDashboardScroll = useRef<ScrollSnapshot | undefined>(undefined);
  const openDetail = (id: string, from: "chat" | "dashboard") => {
    if (from === "chat") savedChatScroll.current = body.current?.getSnapshot();
    else savedDashboardScroll.current = subagentScroll.current?.getSnapshot();
    pageRef.current = "summary";
    setPage("summary");
    setThinkingOpen(false);
    switchView({ detail: id, from });
  };
  const closeView = () => {
    const current = viewRef.current;
    const next = typeof current === "object" ? current.from : "chat";
    switchView(next);
  };
  const turnPage = (next: DetailPage) => {
    pageRef.current = next;
    setPage(next);
  };
  const [input, setInput] = useState("");
  const [todosCollapsed, setTodosCollapsed] = useState(false);
  const [subagentsCollapsed, setSubagentsCollapsed] = useState(false);
  const toggleTodos = () => setTodosCollapsed((collapsed) => !collapsed);
  const [mode, setMode] = useState(session.permissionMode);
  const { columns, rows } = useTerminalSize();
  const small = columns < 40 || rows < 12;
  useLayoutEffect(() => interactions.setQuestionEditingEnabled(!small), [interactions, small]);
  const body = useRef<ScrollHandle>(null);
  const details = useRef<ScrollHandle>(null);
  const [bodyScroll, setBodyScroll] = useState<ScrollSnapshot>();
  useEffect(() => {
    if (view !== "chat" && view !== "dashboard" && page === "output")
      subagentScroll.current?.scrollBy(-Infinity);
  }, [thinkingOpen, page]);
  const selectedSubagent = typeof view === "object" ? state.subagents[view.detail] : undefined;
  useEffect(() => {
    if (
      view === "chat" ||
      view === "dashboard" ||
      page !== "output" ||
      selectedSubagent?.status !== "running"
    )
      return;
    subagentScroll.current?.scrollToBottom();
  }, [view, page, selectedSubagent?.output, selectedSubagent?.status]);

  const [scrollFocus, setScrollFocus] = useState<"body" | "details">("body");
  const [unread, setUnread] = useState(false);
  const previousOutput = useRef({
    completed: state.completed,
    assistant: state.assistant,
    tools: state.tools,
    subagents: state.subagents,
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
      previous.subagents !== state.subagents ||
      previous.error !== state.error
    )
      setUnread(true);
    previousOutput.current = {
      completed: state.completed,
      assistant: state.assistant,
      tools: state.tools,
      subagents: state.subagents,
      error: state.error,
    };
  }, [
    bodyScroll?.following,
    state.completed,
    state.assistant,
    state.tools,
    state.subagents,
    state.error,
  ]);
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
  const hasActivity = state.running && (activity.phase !== "idle" || state.waitingSubagents > 0);
  const promptMaxLines = Math.max(1, Math.min(6, Math.floor(rows / 3)) - 3);
  const hasTodos = state.todos.some((todo) => state.running || todo.status !== "completed");
  const subagents = Object.values(state.subagents);
  const hasSubagents = subagents.some(
    (agent) => state.running || agent.status === "running" || agent.status === "idle",
  );
  const minimumDialogHeight = question
    ? permissionChoices(question.request.mode).length + 3
    : userQuestion
      ? userQuestion.collapsed
        ? 2
        : 6
      : 0;
  // Dialogs take priority. Reserve a preview for every visible panel before
  // deciding whether the prompt needs to use its one-row form.
  const panelCount = Number(hasTodos) + Number(hasSubagents);
  const dialogGap =
    question && rows - statusHeight - minimumDialogHeight - panelCount - 1 >= 1 ? 1 : 0;
  const compactPrompt =
    !!interaction &&
    rows - statusHeight - minimumDialogHeight - dialogGap - panelCount < promptMaxLines + 3;
  const promptHeight = compactPrompt ? 1 : promptMaxLines + 3;
  const transcriptHeight = interaction ? Number(!compactPrompt) : 1;
  const chromeSpace = rows - statusHeight - promptHeight - transcriptHeight;
  const showReturnControl =
    showReturn && chromeSpace - minimumDialogHeight - dialogGap - panelCount >= 1;
  const compactReturn =
    showReturnControl &&
    chromeSpace - minimumDialogHeight - dialogGap - panelCount - Number(hasActivity) < 2;
  const returnHeight = showReturnControl ? (compactReturn ? 1 : 2) : 0;
  const showActivity =
    hasActivity && chromeSpace - minimumDialogHeight - dialogGap - panelCount - returnHeight >= 1;
  const available = chromeSpace - returnHeight - Number(showActivity);
  const panelReserve =
    panelCount > 0 && available - dialogGap - minimumDialogHeight >= panelCount * 3
      ? panelCount * 3
      : panelCount;
  const dialogMaxHeight = interaction
    ? Math.max(
        minimumDialogHeight,
        Math.min(
          userQuestion?.collapsed ? 3 : Math.floor(rows / 2),
          available - dialogGap - panelReserve,
        ),
      )
    : 0;
  const panelHeights = allocatePanelHeights(
    available - dialogMaxHeight - dialogGap,
    Array.from({ length: panelCount }, () => 3),
  );
  const todoMaxHeight = hasTodos ? panelHeights[0]! : 1;
  const subagentMaxHeight = hasSubagents ? panelHeights[Number(hasTodos)]! : 1;
  useInput((event) => {
    const currentView = viewRef.current;
    if (currentView !== "chat") {
      if (event.type === "wheel") subagentScroll.current?.scrollBy(event.delta * 3);
      if (event.type !== "key") return;
      const { key } = event;
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        closeView();
        return;
      }
      if (currentView === "dashboard") {
        const agents = Object.values(conversation.getSnapshot().subagents);
        if (key.name === "up" || key.name === "down") {
          focusRef.current = Math.max(
            0,
            Math.min(agents.length - 1, focusRef.current + (key.name === "up" ? -1 : 1)),
          );
          setFocusIndex(focusRef.current);
          const viewport = subagentScroll.current?.getSnapshot();
          const selected = agents[focusRef.current];
          if (viewport && selected) {
            const preview = (agent: typeof selected) =>
              Number(agent.status === "running" && agent.outputLines.length > 0);
            const top = agents
              .slice(0, focusRef.current)
              .reduce((sum, agent) => sum + 3 + preview(agent), 0);
            const bottom = top + 1 + preview(selected);
            if (top < viewport.top) subagentScroll.current?.scrollBy(top - viewport.top);
            else if (bottom > viewport.top + viewport.height)
              subagentScroll.current?.scrollBy(bottom - viewport.top - viewport.height);
          }
        } else if (key.name === "enter" && !key.ctrl && !key.alt && !key.shift) {
          const selected = agents[focusRef.current];
          if (selected) openDetail(selected.agentId, "dashboard");
        }
      } else {
        if (key.name === "left" || key.name === "right") {
          const pages: DetailPage[] = ["summary", "output", "tools"];
          turnPage(pages[(pages.indexOf(pageRef.current) + (key.name === "left" ? 2 : 1)) % 3]!);
        } else if (key.name === "up" || key.name === "down")
          subagentScroll.current?.scrollBy(key.name === "up" ? -3 : 3);
        else if (!key.ctrl && !key.alt && event.input.toLowerCase() === "x")
          session.interruptSubagent(currentView.detail);
        else if (key.name === "enter" && !key.ctrl && !key.alt && !key.shift) {
          if (pageRef.current === "output") setThinkingOpen((open) => !open);
          else closeView();
        }
      }
      return;
    }
    if (
      event.type === "key" &&
      event.key.ctrl &&
      event.key.name === "a" &&
      !event.key.alt &&
      !event.key.shift
    ) {
      savedChatScroll.current = body.current?.getSnapshot();
      savedDashboardScroll.current = undefined;
      focusRef.current = 0;
      setFocusIndex(0);
      switchView("dashboard");
      return;
    }
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
    if (event.type === "paste" && interactions.getSnapshot()?.kind === "question") {
      if (!small) interactions.questionInput(event);
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
    if (
      key.name === "tab" &&
      key.shift &&
      !key.ctrl &&
      !key.alt &&
      pendingInteraction?.kind !== "question"
    ) {
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
    if (pendingInteraction?.kind === "question") {
      lastInterrupt.current = undefined;
      interactions.questionInput(event);
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
        if (draft.current) {
          history.reset();
          change("");
        } else {
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
              <Box key={index} flexDirection="column">
                <ToolCall
                  summary={entry.summary}
                  status={entry.isError ? "error" : "success"}
                  result={entry.result}
                  error={entry.error}
                />
                {entry.agentId &&
                  state.subagents[entry.agentId] &&
                  state.completed.findLastIndex(
                    (candidate) => candidate.type === "tool" && candidate.agentId === entry.agentId,
                  ) === index && (
                    <SubagentMessage
                      subagent={state.subagents[entry.agentId]!}
                      columns={columns}
                      effort={thinking}
                      locale={locale}
                      onClick={() => openDetail(entry.agentId!, "chat")}
                    />
                  )}
              </Box>
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
    [state.completed, state.subagents, columns, thinking, locale],
  );
  if (view === "dashboard")
    return (
      <SubagentDashboard
        subagents={Object.values(state.subagents)}
        focusIndex={focusIndex}
        scrollRef={subagentScroll}
        rows={rows}
        columns={columns}
        locale={locale}
        onClose={closeView}
        initialTop={savedDashboardScroll.current?.top ?? 0}
        onSelect={(id) => openDetail(id, "dashboard")}
      />
    );
  if (typeof view === "object" && selectedSubagent)
    return (
      <SubagentDetailScene
        subagent={selectedSubagent}
        page={page}
        thinkingOpen={thinkingOpen}
        scrollRef={subagentScroll}
        rows={rows}
        locale={locale}
        onBack={closeView}
        onPage={turnPage}
        onInterrupt={() => session.interruptSubagent(selectedSubagent.agentId)}
      />
    );
  return (
    <Box flexDirection="column" height={rows}>
      <ScrollBox
        ref={body}
        onScroll={setBodyScroll}
        initialFollow={savedChatScroll.current?.following ?? true}
        initialTop={savedChatScroll.current?.top ?? 0}
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
            {showReturnControl && (
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
                phase={
                  (state.waitingSubagents > 0 && !approvalOpen) || activity.phase === "idle"
                    ? "waiting"
                    : activity.phase
                }
                warnPct={
                  state.contextUsage && state.contextUsage.window > 0
                    ? Math.round((state.contextUsage.used / state.contextUsage.window) * 100)
                    : undefined
                }
                line={
                  state.waitingSubagents > 0 && !approvalOpen
                    ? t("subagent.waiting", { count: state.waitingSubagents })
                    : activity.line
                }
                suffix={` · ↑ ${fmtTokens(state.activityInput)} · ↓ ${fmtTokens(state.output + Math.ceil(state.streamedChars / 4))} tokens`}
              />
            )}
            <GoalTodoPanel
              todos={state.todos}
              working={state.running}
              collapsed={todosCollapsed}
              onToggle={toggleTodos}
              locale={locale}
              maxHeight={todoMaxHeight}
            />
            <SubagentPanel
              subagents={subagents}
              working={state.running}
              collapsed={subagentsCollapsed}
              onToggle={() => setSubagentsCollapsed((collapsed) => !collapsed)}
              onOpen={(id) => openDetail(id, "chat")}
              locale={locale}
              maxHeight={subagentMaxHeight}
            />
            {userQuestion && currentQuestion && (
              <QuestionDialog
                origin={userQuestion.request.origin}
                key={`${userQuestion.request.toolCallId}-${userQuestion.questionIndex}`}
                question={userQuestion.request.questions[userQuestion.questionIndex]!}
                questionIndex={userQuestion.questionIndex}
                questionCount={userQuestion.request.questions.length}
                selected={currentQuestion.selected}
                checked={currentQuestion.checked}
                answeredCount={userQuestion.drafts.filter((draft) => draft.answer).length}
                collapsed={userQuestion.collapsed}
                onToggle={() => {
                  if (isCurrentQuestion()) interactions.toggleQuestionFold();
                }}
                cursor={currentQuestion.cursor}
                attached={currentQuestion.attached}
                error={currentQuestion.error}
                onSelect={(index) => {
                  if (isCurrentQuestion()) interactions.selectQuestion(index);
                }}
                onOption={(index) => {
                  if (!isCurrentQuestion()) return;
                  if (userQuestion.request.questions[userQuestion.questionIndex]!.multiSelect)
                    interactions.toggleQuestion(index);
                  else interactions.answerQuestion(index);
                }}
                onSubmit={() => {
                  if (isCurrentQuestion()) interactions.answerQuestion();
                }}
                custom={currentQuestion.custom}
                maxHeight={dialogMaxHeight}
                columns={columns}
                locale={locale}
              />
            )}
            {question && (
              <PermissionDialog
                bottomGap={dialogGap}
                origin={question.request.origin}
                locale={locale}
                key={question.request.toolCallId}
                toolName={question.request.toolName}
                sessionAllow={question.request.sessionAllow}
                args={question.request.args}
                mode={question.request.mode}
                reason={question.request.reason}
                selected={question.selected}
                maxHeight={dialogMaxHeight}
                scrollRef={details}
                scrollFocused={scrollFocus === "details"}
              />
            )}
            <PromptInput
              readOnly={!!interaction && !userQuestion?.collapsed}
              compact={compactPrompt}
              maxLines={compactPrompt ? 1 : promptMaxLines}
              columns={columns}
              working={state.running}
              history={history}
              value={input}
              onChange={(value) => {
                const pending = interactions.getSnapshot();
                if (viewRef.current !== "chat") return;
                if (!pending || (pending.kind === "question" && pending.collapsed)) change(value);
              }}
              onSubmit={(prompt) => {
                const pending = interactions.getSnapshot();
                if (viewRef.current !== "chat") return;
                if (pending && (pending.kind !== "question" || !pending.collapsed)) return;
                if (submit(prompt)) {
                  body.current?.scrollToBottom();
                  change("");
                }
              }}
            />
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
