import { realpath } from "node:fs/promises";
import { relative } from "node:path";
import { useLayoutEffect, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  createSession,
  listSkills,
  listModels,
  listSessions,
  type SessionSummary,
  type PromptImage,
  ImageValidationError,
  type Session,
  type SessionOptions,
} from "@neant/agent";
import type { Locale } from "@neant/i18n";
import { PERMISSION_MODES, type ThinkingLevel } from "@neant/shared";
import {
  Box,
  ScrollBox,
  ThemedText,
  createTextInputHistory,
  useInput,
  useTerminalSize,
  useTheme,
  type ScrollHandle,
  type ScrollSnapshot,
} from "@neant/tui";
import {
  allocatePanelHeights,
  AssistantMessage,
  ContextVisualization,
  ActivityLine,
  GoalTodoPanel,
  Logo,
  Notice,
  PermissionDialog,
  PlanReviewDialog,
  QuestionDialog,
  PromptInput,
  RewindPicker,
  ScrollToBottom,
  StatusLine,
  ToolCall,
  SubagentMessage,
  SubagentPanel,
  SubagentDashboard,
  SubagentDetailScene,
  UserMessage,
  CommandSuggestions,
  ModelPicker,
  SideQuestionPanel,
  SessionPicker,
} from "../../components";
import { rewindLayout, type RewindEntry, type RewindMode } from "../../components/rewind-picker";
import { formatError } from "../../i18n";
import type { DetailPage } from "../../components/subagent-detail";
import { createTuiI18n } from "../../i18n";
import { createImageViewer, type TuiHost } from "../../host";
import { createInputHistory } from "../../input-history";
import { createComposerImages, pastedImagePath } from "./composer-images";
import { createConversation } from "./conversation";
import { createInteractions } from "./interactions";
import { permissionChoices } from "../../components/permission-dialog";
import { fmtTokens, render as renderActivity } from "./activity/activity";
import { commandCatalog } from "./commands";
import { SettingsScreen } from "../settings";

/** Bind the Session and private stores to one chat screen for its lifetime. */
export async function createChat(
  options: SessionOptions,
  model: string,
  host: TuiHost,
  locale: Locale = "zh",
  writeTitle?: (title: string) => void,
) {
  const t = createTuiI18n(locale);
  const interactions = createInteractions(host);
  const sessionOptions: SessionOptions = {
    ...options,
    reminderSources: [
      ...(options.reminderSources ?? []),
      { source: "narration", currentContent: () => t("narrate-instruction") },
    ],
    onPermissionAsk: options.onPermissionAsk ?? interactions.askPermission,
    onQuestion: options.onQuestion ?? interactions.askQuestion,
    onPlanReview: options.onPlanReview ?? interactions.askPlanReview,
  };
  let session = await createSession(sessionOptions);
  const checkpointCwd = await realpath(options.cwd);
  const skills = await listSkills(options);
  const models = listModels(options.settings);
  let conversation = createConversation(session, model, locale);
  let binding = { session, conversation };
  const bindingListeners = new Set<() => void>();
  const history = await createInputHistory(options.cwd, options.homeDir);
  const inputHistory = createTextInputHistory(history.entries);
  const imageViewer = createImageViewer(host);
  const submit = (prompt: string, initial = false, images?: PromptImage[]) => {
    if (!conversation.submit(prompt, initial, images)) return false;
    history.remember(prompt);
    inputHistory.reset();
    return true;
  };
  const replaceSession = async (resumeId?: string) => {
    const branch = conversation.getSnapshot().activity.gitBranch;
    await session.dispose("other");
    await conversation.stop();
    session = await createSession({ ...sessionOptions, resumeId });
    conversation = createConversation(session, model, locale);
    if (branch) conversation.dispatchActivity({ type: "git-branch", branch });
    inputHistory.reset();
    binding = { session, conversation };
    bindingListeners.forEach((listener) => listener());
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
    submitInitial: (prompt: string) => submit(prompt, true),
    async stop() {
      try {
        await session.dispose();
        await conversation.stop();
      } finally {
        try {
          await history.flush();
        } finally {
          await imageViewer.dispose();
        }
      }
    },
    Chat({ onExit }: { onExit(): void }) {
      const current = useSyncExternalStore(
        (listener) => {
          bindingListeners.add(listener);
          return () => {
            bindingListeners.delete(listener);
          };
        },
        () => binding,
      );
      return (
        <Chat
          key={current.session.id}
          session={current.session}
          conversation={current.conversation}
          history={inputHistory}
          imageViewer={imageViewer}
          submit={submit}
          interactions={interactions}
          homeDir={options.homeDir}
          cwd={options.cwd}
          checkpointCwd={checkpointCwd}
          thinking={options.settings?.thinking}
          locale={locale}
          onExit={onExit}
          models={models}
          sessions={() => listSessions(options)}
          skills={skills}
          replaceSession={replaceSession}
          writeTitle={writeTitle}
        />
      );
    },
  };
}

function Chat({
  session,
  conversation,
  history,
  imageViewer,
  submit,
  interactions,
  cwd,
  homeDir,
  checkpointCwd,
  thinking,
  locale,
  onExit,
  skills,
  replaceSession,
  writeTitle,
  models,
  sessions,
}: {
  session: Session;
  conversation: ReturnType<typeof createConversation>;
  history: ReturnType<typeof createTextInputHistory>;
  imageViewer: ReturnType<typeof createImageViewer>;
  submit(prompt: string, initial?: boolean, images?: PromptImage[]): boolean;
  interactions: ReturnType<typeof createInteractions>;
  cwd: string;
  homeDir?: string;
  checkpointCwd: string;
  thinking?: ThinkingLevel;
  locale: Locale;
  onExit(): void;
  models: readonly { spec: string; name: string }[];
  sessions(): Promise<SessionSummary[]>;
  skills: readonly { name: string; description: string }[];
  replaceSession(resumeId?: string): Promise<void>;
  writeTitle?: (title: string) => void;
}) {
  const t = createTuiI18n(locale);
  const theme = useTheme();
  const composer = useMemo(createComposerImages, [session]);
  const pasteOwner = useRef(true);
  const pasteEpoch = useRef(0);
  useLayoutEffect(
    () => () => {
      pasteOwner.current = false;
    },
    [],
  );
  const [imageNotice, setImageNotice] = useState<{ text: string; warning: boolean }>();
  const imageNoticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notifyImage = (text: string, warning = false) => {
    clearTimeout(imageNoticeTimer.current);
    setImageNotice({ text, warning });
    imageNoticeTimer.current = setTimeout(() => setImageNotice(undefined), warning ? 5000 : 2500);
  };
  useEffect(() => () => clearTimeout(imageNoticeTimer.current), []);
  const openImage = (image: PromptImage) => {
    void imageViewer.open(image).catch((error: unknown) => {
      if (pasteOwner.current)
        notifyImage(t("image.open-error", { error: formatError(error, t) }), true);
    });
  };
  const state = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const [title, setTitle] = useState(session.title);
  useEffect(
    () =>
      session.subscribe((event) => {
        if (event.type === "session_title_changed") setTitle(event.title);
      }),
    [session],
  );
  useEffect(() => {
    const frames = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
    let frame = 0;
    const update = () =>
      writeTitle?.(`${state.running ? frames[frame++ % frames.length] : "✦"} ${title || "Neant"}`);
    update();
    if (!state.running || !writeTitle) return;
    const timer = setInterval(update, 120);
    return () => clearInterval(timer);
  }, [title, state.running, writeTitle]);
  const [side, setSide] = useState<{
    question: string;
    answer: string;
    error?: string;
    done: boolean;
  }>();
  const sideController = useRef<AbortController | undefined>(undefined);
  const sideScroll = useRef<ScrollHandle>(null);
  const closeSide = () => {
    sideController.current?.abort();
    sideController.current = undefined;
    setSide(undefined);
  };
  useEffect(() => () => sideController.current?.abort(), [session]);
  const pendingInteraction = useSyncExternalStore(interactions.subscribe, interactions.getSnapshot);
  const interaction = side ? undefined : pendingInteraction;
  const question = interaction?.kind === "permission" ? interaction : undefined;
  const planReview = interaction?.kind === "plan" ? interaction : undefined;
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
  type View = "chat" | "dashboard" | "settings" | { detail: string; from: "chat" | "dashboard" };
  const [view, setView] = useState<View>("chat");
  const viewRef = useRef<View>("chat");
  const switchView = (next: View) => {
    if (next !== "chat") closeSide();
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
  const catalog = commandCatalog(t);
  const suggestions = [
    ...catalog,
    ...skills
      .filter((skill) => !catalog.some((command) => command.name === skill.name))
      .map((skill) => ({ ...skill, skill: true })),
  ];
  const [commandSelection, setCommandSelection] = useState(0);
  const commandSelectionRef = useRef(0);
  const dismissedMenu = useRef<string | undefined>(undefined);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const handledInput = useRef(new WeakSet<object>());
  const matches = (value: string) =>
    /^\/[a-z0-9-]*$/i.test(value) && dismissedMenu.current !== value
      ? suggestions.filter((item) =>
          item.name.toLowerCase().startsWith(value.slice(1).toLowerCase()),
        )
      : [];
  const commandMatches = menuDismissed ? [] : matches(input);
  const [promptRevision, setPromptRevision] = useState(0);
  type Rewind = {
    entries: readonly RewindEntry[];
    focus: number;
    confirm: boolean;
    mode: number;
    busy: boolean;
  };
  const [modelPicker, setModelPicker] = useState<number>();
  const modelPickerRef = useRef<number | undefined>(undefined);
  const showModelPicker = (focus: number | undefined) => {
    modelPickerRef.current = focus;
    setModelPicker(focus);
  };
  type ResumePicker = { sessions: readonly SessionSummary[]; focus: number; busy: boolean };
  const [resumePicker, setResumePicker] = useState<ResumePicker>();
  const resumePickerRef = useRef<ResumePicker | undefined>(undefined);
  const showResumePicker = (next: ResumePicker | undefined) => {
    resumePickerRef.current = next;
    setResumePicker(next);
  };
  const openResumePicker = async () => {
    closeSide();
    const loading: ResumePicker = { sessions: [], focus: 0, busy: true };
    showResumePicker(loading);
    try {
      const previous = (await sessions()).filter((item) => item.id !== session.id);
      if (resumePickerRef.current !== loading) return;
      if (previous.length) showResumePicker({ sessions: previous, focus: 0, busy: false });
      else {
        showResumePicker(undefined);
        conversation.notice(t("resume.empty"));
      }
    } catch (error) {
      if (resumePickerRef.current !== loading) return;
      showResumePicker(undefined);
      conversation.notice(formatError(error, t), true);
    }
  };
  const resumeSession = async (index: number) => {
    const picker = resumePickerRef.current;
    if (!picker || picker.busy) return;
    showResumePicker({ ...picker, busy: true });
    try {
      await replaceSession(picker.sessions[index]!.id);
    } catch (error) {
      showResumePicker(undefined);
      conversation.notice(formatError(error, t), true);
    }
  };
  const [rewind, setRewind] = useState<Rewind>();
  const rewindRef = useRef<Rewind | undefined>(undefined);
  const showRewind = (next: Rewind | undefined) => {
    rewindRef.current = next;
    setRewind(next);
  };
  const rewindFiles = (picker: Rewind) => {
    const files = new Map<string, { path: string; backup: string | null }>();
    // Entries are newest first; earliest record after the target wins per path.
    for (const entry of picker.entries.slice(0, picker.focus + 1).toReversed())
      for (const file of entry.files) if (!files.has(file.path)) files.set(file.path, file);
    return [...files.values()];
  };
  const rewindModes = (picker: Rewind): readonly RewindMode[] =>
    rewindFiles(picker).length
      ? [
          { code: true, conversation: true },
          { code: false, conversation: true },
          { code: true, conversation: false },
        ]
      : [{ code: false, conversation: true }];
  const executeRewind = async (picker: Rewind) => {
    showRewind({ ...picker, busy: true });
    try {
      const choice = rewindModes(picker)[picker.mode]!;
      const result = await session.rewind(picker.entries[picker.focus]!.promptEntryId, choice);
      composer.reset();
      pasteEpoch.current++;
      if (choice.conversation) {
        history.reset();
        change(result.prompt);
        setPromptRevision((revision) => revision + 1);
        setUnread(false);
        savedChatScroll.current = undefined;
        savedDashboardScroll.current = undefined;
        conversation.notice(t("rewind.done"));
      } else
        conversation.notice(
          t("rewind.restored", { count: result.restored.length + result.deleted.length }),
        );
    } catch (error) {
      conversation.notice(formatError(error, t), true);
    } finally {
      showRewind(undefined);
      body.current?.scrollToBottom();
    }
  };
  const [todosCollapsed, setTodosCollapsed] = useState(false);
  const [subagentsCollapsed, setSubagentsCollapsed] = useState(false);
  const toggleTodos = () => setTodosCollapsed((collapsed) => !collapsed);
  const [mode, setMode] = useState(session.permissionMode);
  const { columns, rows } = useTerminalSize();
  const small = columns < 40 || rows < 12;
  useLayoutEffect(() => interactions.setQuestionEditingEnabled(!small), [interactions, small]);
  useLayoutEffect(() => {
    pasteEpoch.current++;
  }, [
    small,
    view,
    modelPicker,
    resumePicker,
    rewind,
    promptRevision,
    interaction?.request,
    userQuestion?.collapsed,
  ]);
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
  const rewindEsc = useRef<number | undefined>(undefined);
  const [rewindArmedAt, setRewindArmedAt] = useState<number>();
  const armRewind = (at?: number) => {
    rewindEsc.current = at;
    setRewindArmedAt(at);
  };
  useEffect(() => {
    if (rewindArmedAt === undefined) return;
    const timer = setTimeout(
      () => {
        rewindEsc.current = undefined;
        setRewindArmedAt(undefined);
      },
      Math.max(0, 3000 - (performance.now() - rewindArmedAt)),
    );
    return () => clearTimeout(timer);
  }, [rewindArmedAt]);
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
    if (bodyScroll?.following) {
      if (unread) setUnread(false);
    } else if (
      !unread &&
      (previous.completed !== state.completed ||
        previous.assistant !== state.assistant ||
        previous.tools !== state.tools ||
        previous.subagents !== state.subagents ||
        previous.error !== state.error)
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
    unread,
    state.completed,
    state.assistant,
    state.tools,
    state.subagents,
    state.error,
  ]);
  const change = (value: string, edit?: { start: number; end: number; text: string }) => {
    composer.prune(value, edit);
    if (!value && draft.current) pasteEpoch.current++;
    armRewind();
    dismissedMenu.current = undefined;
    setMenuDismissed(false);
    commandSelectionRef.current = 0;
    setCommandSelection(0);
    draft.current = value;
    lastInterrupt.current = undefined;
    setInput(value);
  };
  const returnToBottom = () => {
    body.current?.scrollToBottom();
    lastInterrupt.current = undefined;
  };
  const switchModel = async (spec: string) => {
    try {
      await session.setModel(spec);
      composer.reset();
      pasteEpoch.current++;
      conversation.notice(t("model.changed", { model: session.model }));
    } catch (error) {
      conversation.notice(formatError(error, t), true);
    }
  };
  const executeCommand = (prompt: string) => {
    const parsed = /^\/([a-z0-9-]+)(?:\s|$)/.exec(prompt);
    // /new is the image-input contract's alias for the existing /clear action.
    const name = parsed?.[1] === "new" ? "clear" : parsed?.[1];
    const command = catalog.find((entry) => entry.name === name);
    if (!command) return submit(prompt, false, composer.ordered(prompt));
    if (conversation.isRunning() && !command.duringRun) {
      conversation.notice(t("command.busy", { name: command.name }));
      return true;
    }
    if (command.name === "help")
      conversation.notice(
        [
          t("command.help-title"),
          ...suggestions.map(
            (item) =>
              `/${item.name}${"parameters" in item && item.parameters ? ` ${item.parameters}` : ""}${"skill" in item ? " [skill]" : ""}  ${item.description}`,
          ),
        ].join("\n"),
      );
    else if (command.name === "exit") {
      conversation.interrupt();
      void conversation.stop().then(onExit);
    } else if (command.name === "plan") {
      const on = !session.planMode;
      void session
        .setPlanMode(on)
        .then(() => conversation.notice(t(on ? "plan.enabled" : "plan.disabled")))
        .catch((error: unknown) => conversation.notice(formatError(error, t), true));
    } else if (command.name === "goal") {
      const input = prompt.slice(parsed![0].length).trim();
      const control = input.toLowerCase();
      if (conversation.isRunning() && !["", "pause", "clear"].includes(control)) {
        conversation.notice(t("command.busy", { name: "goal" }));
      } else if (!input) {
        const goal = session.goal;
        const hint = !goal
          ? ""
          : goal.phase === "complete"
            ? "/goal <objective>, /goal clear"
            : goal.phase === "active" && goal.armed
              ? "/goal edit <objective>, /goal pause, /goal clear"
              : "/goal edit <objective>, /goal resume, /goal clear";
        conversation.notice(
          goal
            ? [
                t("goal.status", { value: goal.phase }),
                ...(goal.blockedReason ? [t("goal.blocker", { value: goal.blockedReason })] : []),
                t("goal.objective", { value: goal.objective }),
                t("goal.rounds", { value: `${goal.roundsStarted}/${goal.maxRounds}` }),
                t("goal.activation", { value: t(goal.armed ? "goal.armed" : "goal.disarmed") }),
                "",
                t("goal.commands", { value: hint }),
              ].join("\n")
            : `${t("goal.empty")}\n${t("goal.usage")}`,
        );
      } else if (control === "edit") {
        conversation.notice(`${t("goal.edit-empty")}\n${t("goal.usage")}`, true);
      } else if (/^edit(?=\s)/iu.test(input)) {
        void session
          .editGoal(input.slice(4).trim())
          .catch((error: unknown) => conversation.notice(formatError(error, t), true));
      } else if (control === "resume") {
        void session
          .resumeGoal()
          .catch((error: unknown) => conversation.notice(formatError(error, t), true));
      } else if (control === "pause") {
        void session
          .pauseGoal()
          .catch((error: unknown) => conversation.notice(formatError(error, t), true));
      } else if (control === "clear") {
        void session
          .clearGoal()
          .catch((error: unknown) => conversation.notice(formatError(error, t), true));
      } else if (input) {
        void session
          .createGoal(input)
          .catch((error: unknown) => conversation.notice(formatError(error, t), true));
      }
    } else if (command.name === "rename") {
      const title = prompt.slice(parsed![0].length).trim();
      if (!title) {
        change(`/rename ${session.title}`);
        setPromptRevision((revision) => revision + 1);
        return false;
      }
      void session
        .rename(title)
        .catch((error: unknown) => conversation.notice(formatError(error, t), true));
    } else if (command.name === "model") {
      const spec = prompt.slice(parsed![0].length).trim();
      if (spec) void switchModel(spec);
      else
        showModelPicker(
          Math.max(
            0,
            models.findIndex((model) => model.spec === session.model),
          ),
        );
    } else if (command.name === "btw") {
      const question = prompt.slice(parsed![0].length).trim();
      if (!question) conversation.notice(t("btw.usage"));
      else {
        sideController.current?.abort();
        const controller = new AbortController();
        sideController.current = controller;
        setSide({ question, answer: "", done: false });
        void (async () => {
          try {
            for await (const delta of session.sideQuestion(question, {
              signal: controller.signal,
            })) {
              if (sideController.current !== controller) return;
              setSide((current) =>
                current ? { ...current, answer: current.answer + delta } : current,
              );
            }
            if (sideController.current === controller)
              setSide((current) => (current ? { ...current, done: true } : current));
          } catch (error) {
            if (!controller.signal.aborted && sideController.current === controller)
              setSide((current) =>
                current ? { ...current, done: true, error: formatError(error, t) } : current,
              );
          }
        })();
      }
    } else if (command.name === "resume") void openResumePicker();
    else if (command.name === "settings") switchView("settings");
    else if (command.name === "compact")
      void conversation
        .compact(prompt.slice(parsed![0].length).trim() || undefined)
        .catch((error: unknown) => conversation.notice(formatError(error, t), true));
    else if (command.name === "context") conversation.contextReport(session.contextReport());
    else if (command.name === "rewind") openRewind();
    else if (command.name === "clear")
      void replaceSession().catch((error: unknown) =>
        conversation.notice(formatError(error, t), true),
      );
    else conversation.notice(t("command.unsupported", { name: command.name }));
    return true;
  };
  const sendInput = (prompt: string) => {
    if (executeCommand(prompt)) {
      body.current?.scrollToBottom();
      change("");
      composer.clear();
    }
  };
  const openRewind = () => {
    const entries = session.checkpoints().toReversed();
    if (!entries.length) conversation.notice(t("rewind.empty"));
    else showRewind({ entries, focus: 0, confirm: false, mode: 0, busy: false });
    body.current?.scrollToBottom();
  };
  const showReturn = !!bodyScroll && !bodyScroll.following;
  const showContextBar = !(state.goal && interaction && rows < 16);
  const statusHeight = showContextBar && state.contextUsage && columns - 2 >= 14 ? 3 : 2;
  const hasActivity = state.running && (activity.phase !== "idle" || state.waitingSubagents > 0);
  const promptMaxLines = Math.max(1, Math.min(6, Math.floor(rows / 3)) - 3);
  const hasTodos =
    !!state.goal || state.todos.some((todo) => state.running || todo.status !== "completed");
  const subagents = Object.values(state.subagents);
  // Restored identities belong in the dashboard; only a live child opens the dock.
  const panelSubagents = subagents.some((agent) => agent.status === "running")
    ? subagents.filter((agent) => agent.status !== "idle")
    : [];
  const hasSubagents = panelSubagents.length > 0;
  const preferredDialogHeight = rewind
    ? 6
    : question
      ? permissionChoices(question.request.mode).length + 3
      : userQuestion
        ? userQuestion.collapsed
          ? 2
          : 6
        : planReview
          ? 6
          : 0;
  // Dialogs take priority. Reserve a preview for every visible panel before
  // deciding whether the prompt needs to use its one-row form.
  const panelCount = Number(hasTodos) + Number(hasSubagents);
  const goalRows = state.goal ? 1 + Number(state.goal.phase === "blocked") : 0;
  // Goal root and blocker cannot collapse into a panel's one-row preview.
  const panelMinimum = panelCount + goalRows;
  const minimumDialogHeight = state.goal
    ? Math.min(preferredDialogHeight, Math.max(5, rows - statusHeight - panelMinimum - 1))
    : preferredDialogHeight;
  const sideHeight = side
    ? Math.min(
        10,
        Math.max(3, Math.min(Math.floor(rows / 2), rows - statusHeight - 2 - panelMinimum)),
      )
    : 0;
  const dialogGap =
    question && rows - statusHeight - minimumDialogHeight - panelMinimum - 1 >= 1 ? 1 : 0;
  const compactPrompt =
    ((!!side || !!rewind || !!resumePicker) && rows < 20) ||
    (!!interaction &&
      rows - statusHeight - minimumDialogHeight - dialogGap - panelMinimum < promptMaxLines + 3);
  const promptHeight = compactPrompt ? 1 : promptMaxLines + 3;
  const transcriptHeight = rewind
    ? Number(!compactPrompt)
    : interaction
      ? Number(!compactPrompt)
      : 1;
  const commandMenuHeight =
    commandMatches.length && !interaction && !rewind
      ? Math.min(
          commandMatches.length,
          14,
          Math.max(
            1,
            rows -
              statusHeight -
              promptHeight -
              transcriptHeight -
              panelMinimum -
              sideHeight -
              Number(hasActivity),
          ),
        )
      : 0;
  const chromeSpace =
    rows - statusHeight - promptHeight - transcriptHeight - commandMenuHeight - sideHeight;
  const showReturnControl =
    showReturn && chromeSpace - minimumDialogHeight - dialogGap - panelMinimum >= 1;
  const compactReturn =
    showReturnControl &&
    chromeSpace - minimumDialogHeight - dialogGap - panelMinimum - Number(hasActivity) < 2;
  const returnHeight = showReturnControl ? (compactReturn ? 1 : 2) : 0;
  const showActivity =
    hasActivity && chromeSpace - minimumDialogHeight - dialogGap - panelMinimum - returnHeight >= 1;
  const available = chromeSpace - returnHeight - Number(showActivity);
  const panelReserve =
    panelCount > 0 && available - dialogGap - minimumDialogHeight >= panelCount * 3 + goalRows
      ? panelCount * 3 + goalRows
      : panelMinimum;
  const dialogMaxHeight = interaction
    ? Math.max(
        minimumDialogHeight,
        Math.min(
          userQuestion?.collapsed ? 3 : Math.floor(rows / 2),
          available - dialogGap - panelReserve,
        ),
      )
    : 0;
  // Six rows keep the focused item, file summary, bash warning and footer visible
  // even at 40×12 with both persistent panels. Activity/return rows yield first.
  const rewindMaxHeight = rewind ? Math.min(14, available - panelMinimum) : 0;
  const rewindHeight = rewind
    ? rewindLayout(
        rewind.entries,
        rewind.confirm,
        rewindModes(rewind).length,
        rewindFiles(rewind).length,
        rewindMaxHeight,
      ).height
    : 0;
  const modelPickerHeight = modelPicker === undefined ? 0 : Math.min(12, available - panelMinimum);
  const resumePickerHeight = resumePicker ? Math.min(14, available - panelMinimum) : 0;
  const panelHeights = allocatePanelHeights(
    available -
      dialogMaxHeight -
      dialogGap -
      rewindHeight -
      modelPickerHeight -
      resumePickerHeight -
      goalRows,
    Array.from({ length: panelCount }, () => 3),
  );
  const todoMaxHeight = hasTodos ? panelHeights[0]! + goalRows : 1;
  const subagentMaxHeight = hasSubagents ? panelHeights[Number(hasTodos)]! : 1;
  useInput((event) => {
    if (sideController.current && event.type === "key") {
      const { key } = event;
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        handledInput.current.add(event);
        closeSide();
        return;
      }
      if (
        !draft.current &&
        !key.ctrl &&
        !key.alt &&
        !key.shift &&
        ["up", "down"].includes(key.name)
      ) {
        handledInput.current.add(event);
        sideScroll.current?.scrollBy(key.name === "up" ? -3 : 3);
        return;
      }
    }
    const resume = resumePickerRef.current;
    if (resume) {
      if (event.type !== "key") return;
      handledInput.current.add(event);
      const { key } = event;
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        if (!resume.busy || !resume.sessions.length) showResumePicker(undefined);
      } else if (!resume.busy && !small && !key.ctrl && !key.alt && !key.shift) {
        if (key.name === "up" || key.name === "down")
          showResumePicker({
            ...resume,
            focus:
              (resume.focus + (key.name === "up" ? resume.sessions.length - 1 : 1)) %
              resume.sessions.length,
          });
        else if (key.name === "enter") void resumeSession(resume.focus);
      }
      return;
    }
    const modelFocus = modelPickerRef.current;
    if (modelFocus !== undefined) {
      if (event.type !== "key") return;
      handledInput.current.add(event);
      const { key } = event;
      if (key.name === "escape" || (key.ctrl && key.name === "c")) showModelPicker(undefined);
      else if (!small && !key.ctrl && !key.alt && !key.shift) {
        if (key.name === "up" || key.name === "down")
          showModelPicker(
            (modelFocus + (key.name === "up" ? models.length - 1 : 1)) % models.length,
          );
        else if (key.name === "enter") {
          showModelPicker(undefined);
          void switchModel(models[modelFocus]!.spec);
        }
      }
      return;
    }
    const currentView = viewRef.current;
    if (currentView === "settings") return;
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
    const picker = rewindRef.current;
    if (picker && !interactions.getSnapshot()) {
      if (event.type !== "key" || picker.busy) return;
      const { key } = event;
      if (small && key.name !== "escape" && !(key.ctrl && key.name === "c")) return;
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        showRewind(picker.confirm && !key.ctrl ? { ...picker, confirm: false } : undefined);
      } else if (key.name === "up" || key.name === "down") {
        const count = picker.confirm ? rewindModes(picker).length : picker.entries.length;
        const field = picker.confirm ? "mode" : "focus";
        showRewind({
          ...picker,
          [field]: (picker[field] + (key.name === "up" ? count - 1 : 1)) % count,
        });
      } else if (key.name === "enter" && !key.ctrl && !key.alt && !key.shift) {
        if (picker.confirm) void executeRewind(picker);
        else showRewind({ ...picker, confirm: true, mode: 0 });
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
        (question || planReview) &&
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
    if (
      !sideController.current &&
      event.type === "paste" &&
      interactions.getSnapshot()?.kind === "plan"
    ) {
      if (!small) interactions.planInput(event);
      return;
    }
    if (
      !sideController.current &&
      event.type === "paste" &&
      interactions.getSnapshot()?.kind === "question"
    ) {
      if (!small) interactions.questionInput(event);
      return;
    }
    if (event.type !== "key") {
      lastInterrupt.current = undefined;
      return;
    }
    const { key } = event;
    const pendingInteraction = sideController.current ? undefined : interactions.getSnapshot();
    if (pendingInteraction || key.name !== "escape") armRewind();
    const menu = !pendingInteraction && !small ? matches(draft.current) : [];
    if (menu.length && !key.ctrl && !key.alt && !key.shift) {
      if (key.name === "up" || key.name === "down") {
        handledInput.current.add(event);
        commandSelectionRef.current =
          (commandSelectionRef.current + (key.name === "up" ? menu.length - 1 : 1)) % menu.length;
        setCommandSelection(commandSelectionRef.current);
        return;
      }
      if (key.name === "tab" || key.name === "enter") {
        handledInput.current.add(event);
        const item = menu[commandSelectionRef.current % menu.length]!;
        if (key.name === "tab") {
          history.reset();
          change(`/${item.name} `);
          setPromptRevision((revision) => revision + 1);
        } else sendInput(`/${item.name}`);
        return;
      }
      if (key.name === "escape") {
        dismissedMenu.current = draft.current;
        setMenuDismissed(true);
        return;
      }
    }
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
      const viewport =
        pendingInteraction?.kind === "plan" || (pending && scrollFocus === "details")
          ? details.current
          : body.current;
      viewport?.scrollBy(
        Math.max(1, (viewport.getSnapshot().height ?? 1) - 1) * (key.name === "pageup" ? -1 : 1),
      );
      lastInterrupt.current = undefined;
      return;
    }
    if (small && key.name !== "escape" && !(key.ctrl && (key.name === "c" || key.name === "d")))
      return;
    if (pendingInteraction?.kind === "plan" && !(key.ctrl && key.name === "c")) {
      lastInterrupt.current = undefined;
      interactions.planInput(event);
      return;
    }
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
        armRewind();
        conversation.interrupt();
        lastInterrupt.current = undefined;
      } else if (!key.ctrl) {
        if (draft.current) {
          history.reset();
          change("");
        } else if (!small) {
          const now = performance.now();
          if (rewindEsc.current !== undefined && now - rewindEsc.current <= 3000) {
            armRewind();
            openRewind();
          } else {
            armRewind(now);
          }
          body.current?.scrollToBottom();
        }
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
                  planReview={entry.planReview}
                  locale={locale}
                  summary={entry.summary}
                  status={entry.isError ? "error" : "success"}
                  outcomeUnknown={entry.outcomeUnknown}
                  result={entry.result}
                  images={entry.images}
                  onImageOpen={openImage}
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
          case "context-report":
            return (
              <ContextVisualization
                key={index}
                report={entry.report}
                columns={columns}
                locale={locale}
              />
            );
          case "notice":
            return <Notice key={index} kind="info" text={entry.text} />;
          case "message":
            return entry.role === "user" ? (
              <UserMessage
                key={index}
                text={entry.text}
                source={entry.source}
                locale={locale}
                images={entry.images}
                onImageOpen={openImage}
              />
            ) : (
              <AssistantMessage key={index} text={entry.text} />
            );
        }
      }),
    [state.completed, state.subagents, columns, thinking, locale],
  );
  if (view === "settings") return <SettingsScreen locale={locale} onClose={closeView} />;
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
              goal={state.goal}
              todos={state.todos}
              working={state.running}
              collapsed={todosCollapsed}
              onToggle={toggleTodos}
              locale={locale}
              maxHeight={todoMaxHeight}
            />
            <SubagentPanel
              subagents={panelSubagents}
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
            {planReview && (
              <PlanReviewDialog
                key={planReview.request.toolCallId}
                plan={planReview.request.plan}
                selected={planReview.selected}
                feedback={planReview.feedback}
                cursor={planReview.cursor}
                columns={columns}
                locale={locale}
                maxHeight={dialogMaxHeight}
                scrollRef={details}
                onSelect={(index) => {
                  if (interactions.getSnapshot()?.request === planReview.request)
                    interactions.selectPlan(index);
                }}
                onOption={(index) => {
                  if (interactions.getSnapshot()?.request === planReview.request)
                    interactions.confirmPlan(index);
                }}
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
            {rewind && (
              <RewindPicker
                entries={rewind.entries}
                focus={rewind.focus}
                confirm={rewind.confirm}
                mode={rewind.mode}
                modes={rewindModes(rewind)}
                files={rewindFiles(rewind).map((file) => ({
                  ...file,
                  path: relative(checkpointCwd, file.path),
                }))}
                busy={rewind.busy}
                maxHeight={rewindMaxHeight}
                columns={columns}
                locale={locale}
                onFocus={(focus) => {
                  const picker = rewindRef.current;
                  if (picker && !picker.busy) showRewind({ ...picker, focus });
                }}
                onMode={(mode) => {
                  const picker = rewindRef.current;
                  if (picker && !picker.busy) void executeRewind({ ...picker, mode });
                }}
              />
            )}
            {modelPicker !== undefined && (
              <ModelPicker
                models={models}
                focus={modelPicker}
                current={session.model}
                maxHeight={modelPickerHeight}
                locale={locale}
                onPick={(index) => {
                  showModelPicker(undefined);
                  void switchModel(models[index]!.spec);
                }}
              />
            )}
            {side && (
              <SideQuestionPanel
                {...side}
                height={sideHeight}
                locale={locale}
                scrollRef={sideScroll}
              />
            )}
            {resumePicker && (
              <SessionPicker
                sessions={resumePicker.sessions}
                focus={resumePicker.focus}
                maxHeight={resumePickerHeight}
                locale={locale}
                onPick={(index) => {
                  void resumeSession(index);
                }}
              />
            )}
            {!!commandMatches.length &&
              !interaction &&
              !rewind &&
              !resumePicker &&
              modelPicker === undefined && (
                <CommandSuggestions
                  items={commandMatches}
                  selected={commandSelection % commandMatches.length}
                  maxHeight={commandMenuHeight}
                />
              )}
            <PromptInput
              notice={imageNotice}
              tip={rewindArmedAt === undefined ? undefined : t("rewind.again")}
              key={promptRevision}
              readOnly={
                modelPicker !== undefined ||
                !!resumePicker ||
                !!rewind ||
                (!!interaction && !userQuestion?.collapsed)
              }
              compact={compactPrompt}
              maxLines={compactPrompt ? 1 : promptMaxLines}
              columns={columns}
              working={state.running}
              planMode={state.planMode}
              history={history}
              onHistoryRecall={() => {
                composer.clear();
                pasteEpoch.current++;
              }}
              filterInput={(event) =>
                viewRef.current === "chat" &&
                modelPickerRef.current === undefined &&
                resumePickerRef.current === undefined &&
                !handledInput.current.has(event) &&
                !(
                  event.type === "key" &&
                  !event.key.ctrl &&
                  !event.key.alt &&
                  !event.key.shift &&
                  (!interactions.getSnapshot() || !!sideController.current) &&
                  matches(draft.current).length &&
                  ["up", "down", "tab", "enter"].includes(event.key.name)
                )
              }
              highlightRanges={composer
                .ranges(input)
                .map((range) => ({ ...range, color: theme.suggestion }))}
              atomicRanges={composer.ranges(input)}
              onPaste={(text, insert) => {
                const epoch = pasteEpoch.current;
                const path = pastedImagePath(text, homeDir ?? "");
                if (!path) {
                  insert(text);
                  return;
                }
                void composer
                  .read(path)
                  .then((image) => {
                    if (!pasteOwner.current || epoch !== pasteEpoch.current) return;
                    const token = composer.bind(image, draft.current);
                    insert(token + " ");
                    notifyImage(t("image.pasted", { token }));
                  })
                  .catch((error: unknown) => {
                    if (!pasteOwner.current || epoch !== pasteEpoch.current) return;
                    if (
                      error instanceof ImageValidationError &&
                      ["image-too-large", "image-dimensions"].includes(error.code)
                    )
                      notifyImage(t("image.paste-error", { error: formatError(error, t) }), true);
                    else insert(text);
                  });
              }}
              value={input}
              onChange={(value, edit) => {
                const pending = sideController.current ? undefined : interactions.getSnapshot();
                if (viewRef.current !== "chat" || rewindRef.current) return;
                if (!pending || (pending.kind === "question" && pending.collapsed))
                  change(value, edit);
              }}
              onSubmit={(prompt) => {
                const pending = sideController.current ? undefined : interactions.getSnapshot();
                if (viewRef.current !== "chat" || rewindRef.current) return;
                if (pending && (pending.kind !== "question" || !pending.collapsed)) return;
                sendInput(prompt);
              }}
            />
            <StatusLine
              showContextBar={showContextBar}
              goal={state.goal}
              locale={locale}
              columns={columns}
              mode={mode}
              planMode={state.planMode}
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
