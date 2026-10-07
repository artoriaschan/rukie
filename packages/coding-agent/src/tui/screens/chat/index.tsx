import { createImagePresentation } from "./image-metadata";
import { alignSplitDiff } from "../../../ink/index.ts";
import { readSessionNotice, sessionNoticeFromHook, assistantThinkingDuration } from "@rukie/agent";
const conversationFacts = { readSessionNotice, sessionNoticeFromHook, assistantThinkingDuration };
import { SessionNoticeRow } from "../../components/notice";
import { completedEntryVisible } from "../../../view/conversation/completed-visibility";
import { transcriptMatches } from "../../../view/transcript/transcript-search";
import { TextInput } from "../../../ink/index.ts";
import { DiffLayoutProvider, useDiffLayout } from "../../components/tool-call/diff-layout";
import { SmoothRevealProvider } from "../../../ink/index.ts";
import {
  ToolWindowProvider,
  useToolWindowNavigation,
} from "../../components/tool-call/window-navigation";
import { FileActionsPanel } from "../../components/file-actions-panel";
import { PlanReviewRow } from "../../components/plan-review/plan-review-row";
import { showsToolCard } from "../../../view/conversation/conversation";
import { ThinkingRow } from "../../components/thinking-row";
import { realpath } from "node:fs/promises";
import { statSync } from "node:fs";
import { relative, join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  Fragment,
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
} from "@rukie/agent";
import type { Locale } from "@rukie/i18n";
import { PERMISSION_MODES, type ThinkingLevel } from "@rukie/shared";
import {
  Box,
  ScrollBox,
  ThemedText,
  createTextInputHistory,
  useInput,
  useTerminalSize,
  useDismissTooltip,
  useTheme,
  type ScrollHandle,
  type ScrollSnapshot,
} from "../../../ink/index.ts";
import {
  allocatePanelHeights,
  ImageGallery,
  ImagePreview,
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
  JobCard,
  JobsPanel,
  JobGroupHeader,
  ToolCall,
  SubagentMessage,
  SubagentPanel,
  SubagentDashboard,
  SubagentDetailScene,
  UserMessage,
  TimelineRail,
  CommandSuggestions,
  ModelPicker,
  McpPanel,
  SideQuestionPanel,
  SessionPicker,
} from "../../components";
import { rewindLayout, type RewindEntry, type RewindMode } from "../../components/rewind-picker";
import { formatError } from "../../../view/i18n";
import type { DetailPage } from "../../components/subagent-detail";
import { createTuiI18n } from "../../../view/i18n";
import { createImageViewer, type TuiHost } from "../../host";
import { createInputHistory } from "../../input-history";
import { createComposerImages, pastedImagePath } from "./composer-images";
import { createConversation } from "../../../view/conversation/conversation";
import { createInteractions } from "./interactions";
import { permissionChoices } from "../../components/permission-dialog";
import { fmtTokens, render as renderActivity } from "../../../view/conversation/activity/activity";
import { commandCatalog } from "../../../view/commands/commands";
import { createMcpCommands } from "./mcp-commands";
import { createMcpPanel } from "./mcp-panel";
import { mcpPanelHeight } from "../../components/mcp-panel";
import { SettingsScreen } from "../settings";

const modelLabelGraphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function imageWarningModelLabel(model: string, columns: number) {
  const label = model.replace(/\s/g, " ");
  const width = Math.max(1, columns - 3);
  if (Bun.stringWidth(label) <= width) return label;
  let shortened = "";
  for (const { segment } of modelLabelGraphemes.segment(label)) {
    if (Bun.stringWidth(shortened + segment) > width - 1) break;
    shortened += segment;
  }
  return shortened + "…";
}

/** Bind the Session and private stores to one chat screen for its lifetime. */
export async function createChat(
  options: SessionOptions,
  model: string,
  host: TuiHost,
  locale: Locale = "zh",
  writeTitle?: (title: string) => void,
) {
  const t = createTuiI18n(locale);
  const interactions = createInteractions(host, locale);
  const sessionOptions: SessionOptions = {
    ...options,
    reminderSources: [
      ...(options.reminderSources ?? []),
      { source: "narration", currentContent: () => t("narrate-instruction") },
    ],
    onPermissionAsk: options.onPermissionAsk ?? interactions.askPermission,
    onQuestion: options.onQuestion ?? interactions.askQuestion,
    onPlanReview: options.onPlanReview ?? interactions.askPlanReview,
    onMcpAuth: options.onMcpAuth ?? interactions.askMcpAuth,
  };
  let session = await createSession(sessionOptions);
  const checkpointCwd = await realpath(options.cwd);
  const skills = await listSkills(options);
  const models = listModels(options.settings);
  let conversation = createConversation(session, model, conversationFacts, locale);
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
    conversation = createConversation(session, model, conversationFacts, locale);
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
        <DiffLayoutProvider value={options.settings?.diffLayout}>
          <SmoothRevealProvider key={current.session.id}>
            <ToolWindowProvider>
              <Chat
                key={current.session.id}
                session={current.session}
                conversation={current.conversation}
                history={inputHistory}
                imageViewer={imageViewer}
                host={host}
                submit={submit}
                interactions={interactions}
                homeDir={options.homeDir}
                cwd={options.cwd}
                checkpointCwd={checkpointCwd}
                foldTerminalCommand={options.settings?.foldTerminalCommand ?? true}
                thinking={options.settings?.thinking}
                locale={locale}
                onExit={onExit}
                models={models}
                sessions={() => listSessions(options)}
                skills={skills}
                replaceSession={replaceSession}
                writeTitle={writeTitle}
              />
            </ToolWindowProvider>
          </SmoothRevealProvider>
        </DiffLayoutProvider>
      );
    },
  };
}

/** arm(undefined) cancels; the ref also handles consecutive keys in the same input chunk. */
function useDoublePressWindow(durationMs: number) {
  const startedAt = useRef<number | undefined>(undefined);
  const [armedAt, setArmedAt] = useState<number>();
  const arm = (at?: number) => {
    startedAt.current = at;
    setArmedAt(at);
  };
  useEffect(() => {
    if (armedAt === undefined) return;
    const timer = setTimeout(
      () => {
        startedAt.current = undefined;
        setArmedAt(undefined);
      },
      Math.max(0, durationMs - (performance.now() - armedAt)),
    );
    return () => clearTimeout(timer);
  }, [armedAt, durationMs]);
  return {
    armedAt,
    arm,
    isWithinWindow: (now: number) =>
      startedAt.current !== undefined && now - startedAt.current <= durationMs,
  };
}

function Chat({
  session,
  conversation,
  history,
  imageViewer,
  host,
  submit,
  interactions,
  cwd,
  homeDir,
  checkpointCwd,
  thinking,
  foldTerminalCommand,
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
  host: TuiHost;
  submit(prompt: string, initial?: boolean, images?: PromptImage[]): boolean;
  interactions: ReturnType<typeof createInteractions>;
  cwd: string;
  homeDir?: string;
  checkpointCwd: string;
  thinking?: ThinkingLevel;
  foldTerminalCommand: boolean;
  locale: Locale;
  onExit(): void;
  models: Readonly<ReturnType<typeof listModels>>;
  sessions(): Promise<SessionSummary[]>;
  skills: readonly { name: string; description: string }[];
  replaceSession(resumeId?: string): Promise<void>;
  writeTitle?: (title: string) => void;
}) {
  const t = createTuiI18n(locale);
  const theme = useTheme();
  const [clipboardImage, setClipboardImage] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      let image = false;
      try {
        image = await host.hasClipboardImage();
      } catch {
        // Unavailable clipboard offers remove the passive hint without notifying the user.
      }
      if (!active) return;
      setClipboardImage(image);
      timer = setTimeout(() => void check(), 1000);
    };
    void check();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [host]);
  const composer = useMemo(createComposerImages, [session]);
  const presentImage = useMemo(createImagePresentation, [session]);
  const [composerCursor, setComposerCursor] = useState(0);
  const composerCursorRef = useRef(0);
  const dismissedComposerImage = useRef<{ token: string; start: number }>(undefined);
  const [composerDismissed, setComposerDismissed] = useState(false);
  const composerImageDismissed = (image: ReturnType<typeof composer.atCursor>) =>
    !!image &&
    dismissedComposerImage.current?.token === image.token &&
    dismissedComposerImage.current.start === image.start;
  const updateComposerCursor = (offset: number) => {
    composerCursorRef.current = offset;
    if (!composerImageDismissed(composer.atCursor(draft.current, offset))) {
      dismissedComposerImage.current = undefined;
      setComposerDismissed(false);
    }
    setComposerCursor(offset);
  };
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
  const [modelImageNotice, setModelImageNotice] = useState<string>();
  const modelImageNoticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notifyModelImages = () => {
    clearTimeout(modelImageNoticeTimer.current);
    setModelImageNotice(undefined);
    const model = models.find((choice) => choice.spec === session.model);
    if (!model || model.input.includes("image")) return;
    setModelImageNotice(session.model);
    modelImageNoticeTimer.current = setTimeout(() => setModelImageNotice(undefined), 5000);
  };
  const notifyPastedImage = (token: string) => {
    notifyImage(t("image.pasted", { token }));
    notifyModelImages();
  };
  useEffect(() => () => clearTimeout(modelImageNoticeTimer.current), []);
  const state = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const toolWindows = useToolWindowNavigation();
  const promptNotice = imageNotice ?? state.notification;
  type FileActions = { path: string; focus: number; directory: boolean };
  const [fileActions, setFileActions] = useState<FileActions>();
  const fileActionsRef = useRef<FileActions | undefined>(undefined);
  const showFileActions = (next: FileActions | undefined) => {
    pasteEpoch.current++;
    fileActionsRef.current = next;
    setFileActions(next);
  };
  const openFileActions = (path: string) => {
    if (interactions.getSnapshot() || previewRef.current) return;
    const absolute = resolve(cwd, path);
    let directory = false;
    try {
      directory = statSync(absolute, { throwIfNoEntry: false })?.isDirectory() ?? false;
    } catch {
      /* Host actions report inaccessible paths. */
    }
    showFileActions({ path: absolute, focus: 0, directory });
  };
  const pickFileAction = async (index: number) => {
    const menu = fileActionsRef.current;
    if (!menu) return;
    showFileActions(undefined);
    try {
      if (index === 0) await host.openExternal(menu.path);
      else if (index === 1) await host.reveal(menu.path);
      else {
        const copied = await host.writeClipboard(menu.path);
        if (!copied) throw new Error(t("file-actions.copy-unavailable"));
        if (copied === "sent" && pasteOwner.current)
          conversation.notify(t("selection.sent"), "info");
      }
    } catch (error) {
      if (pasteOwner.current)
        conversation.notify(t("file-actions.failed", { error: formatError(error, t) }), "error");
    }
  };
  type Preview = { images: readonly PromptImage[]; index: number; composer?: boolean };
  const [preview, setPreview] = useState<Preview>();
  const previewRef = useRef<Preview | undefined>(undefined);
  const showPreview = (next: Preview | undefined) => {
    pasteEpoch.current++;
    previewRef.current = next;
    setPreview(next);
  };
  const imagePreviewBlocked = () =>
    !!(
      interactions.getSnapshot() ||
      fileActionsRef.current ||
      viewRef.current !== "chat" ||
      rewindRef.current ||
      mcpPanel.getSnapshot() ||
      modelPickerRef.current !== undefined ||
      resumePickerRef.current
    );
  const openImage = (entryIndex: number, imageIndex: number) => {
    if (imagePreviewBlocked()) return;
    const entries = conversation.getSnapshot().completed;
    const images = entries.flatMap((entry) => ("images" in entry ? (entry.images ?? []) : []));
    const before = entries
      .slice(0, entryIndex)
      .reduce((count, entry) => count + ("images" in entry ? (entry.images?.length ?? 0) : 0), 0);
    if (images[before + imageIndex]) showPreview({ images, index: before + imageIndex });
  };
  const stepImage = (delta: number) => {
    const current = previewRef.current;
    if (current)
      showPreview({
        ...current,
        index: Math.max(0, Math.min(current.images.length - 1, current.index + delta)),
      });
  };
  const [title, setTitle] = useState(session.title);
  useEffect(
    () =>
      session.subscribe((event) => {
        if (event.type === "session_title_changed") setTitle(event.title);
        if (event.type === "conversation_rewound") {
          showPreview(undefined);
          showFileActions(undefined);
        }
      }),
    [session],
  );
  useEffect(() => {
    const frames = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
    let frame = 0;
    const update = () =>
      writeTitle?.(`${state.running ? frames[frame++ % frames.length] : "✦"} ${title || "Rukie"}`);
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
  useLayoutEffect(() => {
    if (pendingInteraction) {
      showPreview(undefined);
      showFileActions(undefined);
    }
  }, [pendingInteraction?.request]);
  const interaction = side ? undefined : pendingInteraction;
  const question = interaction?.kind === "permission" ? interaction : undefined;
  const planReview = interaction?.kind === "plan" ? interaction : undefined;
  const userQuestion = interaction?.kind === "question" ? interaction : undefined;
  const currentQuestion = userQuestion?.drafts[userQuestion.questionIndex];
  const authDetails = useRef<ScrollHandle>(null);
  const isCurrentQuestion = () => {
    const live = interactions.getSnapshot();
    return (
      live?.kind === "question" &&
      live.request === userQuestion?.request &&
      live.questionIndex === userQuestion.questionIndex
    );
  };
  type View =
    | "chat"
    | "dashboard"
    | "settings"
    | "jobs"
    | { detail: string; from: "chat" | "dashboard"; agentView?: boolean };
  const [view, setView] = useState<View>("chat");
  const viewRef = useRef<View>("chat");
  const switchView = (next: View) => {
    if (next !== "chat") {
      closeSide();
      showPreview(undefined);
    }
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
  const [jobFocus, setJobFocus] = useState(0);
  const jobFocusRef = useRef(0);
  const [jobDetails, setJobDetails] = useState<ReadonlySet<string>>(new Set());
  const [killArmed, setKillArmed] = useState<{ id: string; until: number }>();
  const killArmRef = useRef<{ id: string; until: number } | undefined>(undefined);
  const jobsScroll = useRef<ScrollHandle>(null);
  const interruptedViewScroll = useRef<{ view: View; snapshot?: ScrollSnapshot } | undefined>(
    undefined,
  );
  if (interaction && view !== "chat" && interruptedViewScroll.current?.view !== view) {
    toolWindows?.beginSuspend();
    interruptedViewScroll.current = {
      view,
      snapshot: (view === "jobs" ? jobsScroll : subagentScroll).current?.getSnapshot(),
    };
  }
  const restoredViewScroll =
    interruptedViewScroll.current?.view === view
      ? interruptedViewScroll.current.snapshot
      : undefined;
  useLayoutEffect(() => {
    if (!interaction) {
      interruptedViewScroll.current = undefined;
      toolWindows?.finishRestore();
    }
  }, [interaction?.request, view]);
  const disarmKill = () => {
    killArmRef.current = undefined;
    setKillArmed(undefined);
  };
  useEffect(() => {
    if (!killArmed) return;
    const timer = setTimeout(disarmKill, 4000);
    return () => clearTimeout(timer);
  }, [killArmed]);
  useEffect(() => {
    if (
      killArmed &&
      state.jobs[killArmed.id]?.status !== "running" &&
      state.jobs[killArmed.id]?.status !== "stopping"
    )
      disarmKill();
  }, [state.jobs, killArmed]);
  const selectJob = (index: number) => {
    disarmKill();
    jobFocusRef.current = index;
    setJobFocus(index);
  };
  const openJobs = (id?: string) => {
    if (previewRef.current || mcpPanel.getSnapshot()) return;
    selectJob(
      Math.max(
        0,
        Object.values(conversation.getSnapshot().jobs).findIndex((job) => job.id === id),
      ),
    );
    setJobDetails(new Set(id ? [id] : []));
    savedChatScroll.current = body.current?.getSnapshot();
    switchView("jobs");
  };
  const openDetail = (id: string, from: "chat" | "dashboard", agentView = false) => {
    if (previewRef.current || mcpPanel.getSnapshot()) return;
    if (from === "chat") savedChatScroll.current = body.current?.getSnapshot();
    else savedDashboardScroll.current = subagentScroll.current?.getSnapshot();
    pageRef.current = agentView ? "output" : "summary";
    setPage(agentView ? "output" : "summary");
    setThinkingOpen(false);
    switchView({ detail: id, from, agentView });
    void conversation.loadSubagent(id).catch((error) => {
      if (pasteOwner.current) conversation.notice(formatError(error, t), true);
    });
  };
  const closeView = () => {
    const current = viewRef.current;
    const next = typeof current === "object" ? current.from : "chat";
    disarmKill();
    switchView(next);
  };
  const turnPage = (next: DetailPage) => {
    pageRef.current = next;
    setPage(next);
  };
  const [input, setInput] = useState("");
  const catalog = commandCatalog(t);
  const mcpCommands = useMemo(
    () => createMcpCommands(session, conversation, t),
    [session, conversation, locale],
  );
  useEffect(() => () => mcpCommands.stop(), [mcpCommands]);
  useSyncExternalStore(mcpCommands.subscribe, mcpCommands.getSnapshot);
  const mcpPanel = useMemo(
    () =>
      createMcpPanel(
        mcpCommands,
        {
          user: join(homeDir ?? homedir(), ".rukie/mcp.json"),
          project: join(cwd, ".mcp.json"),
        },
        t,
      ),
    [mcpCommands, cwd, homeDir, locale],
  );
  const mcp = useSyncExternalStore(mcpPanel.subscribe, mcpPanel.getSnapshot);
  const mcpBody = useRef<ScrollHandle>(null);
  const mcpOpening = useRef(false);
  useLayoutEffect(() => () => mcpPanel.stop(), [mcpPanel]);
  const mcpCanInteract = () =>
    !!mcpPanel.getSnapshot() && !interactions.getSnapshot() && !small && viewRef.current === "chat";

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
  const matches = (
    value: string,
  ): {
    name: string;
    description: string;
    skill?: boolean;
    completion?: string;
    needsArgument?: boolean;
  }[] =>
    /^\/[a-z0-9-]*$/i.test(value) && dismissedMenu.current !== value
      ? suggestions.filter((item) =>
          item.name.toLowerCase().startsWith(value.slice(1).toLowerCase()),
        )
      : dismissedMenu.current !== value
        ? mcpCommands.complete(value)
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
  const modelPickerDraftImages = useRef(false);
  const showModelPicker = (focus: number | undefined) => {
    modelPickerRef.current = focus;
    if (focus === undefined) modelPickerDraftImages.current = false;
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
    if (next) showPreview(undefined);
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
  const toggleTodos = () => {
    if (!previewRef.current && !mcpPanel.getSnapshot())
      setTodosCollapsed((collapsed) => !collapsed);
  };
  const [mode, setMode] = useState(session.permissionMode);
  const { columns, rows } = useTerminalSize();
  const small = columns < 40 || rows < 12;
  const dismissTooltip = useDismissTooltip();
  useEffect(() => {
    dismissTooltip?.();
  }, [
    dismissTooltip,
    small,
    view,
    preview,
    fileActions,
    mcp,
    modelPicker,
    resumePicker,
    rewind,
    interaction?.request,
  ]);
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
    if (subagentScroll.current?.getSnapshot().following) subagentScroll.current.scrollToBottom();
  }, [view, page, selectedSubagent?.output, selectedSubagent?.status]);

  const [scrollFocus, setScrollFocus] = useState<"body" | "details">("body");
  const [unread, setUnread] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [transcriptSearch, setTranscriptSearch] = useState<{
    editing: boolean;
    draft: string;
    query: string;
    index: number;
  }>({ editing: false, draft: "", query: "", index: 0 });
  const searchRef = useRef(transcriptSearch);
  const searchInputEvents = useRef(new WeakSet<object>());
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const diffSearchLayout = useDiffLayout();
  const searchMatches = useMemo(
    () =>
      transcriptMatches(
        state,
        transcriptSearch.query,
        columns,
        diffSearchLayout,
        locale,
        alignSplitDiff,
      ),
    [state, transcriptSearch.query, columns, diffSearchLayout, locale],
  );
  const currentMatch = searchMatches[transcriptSearch.index % Math.max(1, searchMatches.length)];
  const updateSearch = (next: typeof transcriptSearch) => {
    searchRef.current = next;
    setTranscriptSearch(next);
  };
  const closeTranscript = () => {
    expandedRef.current = false;
    setExpanded(false);
    updateSearch({ editing: false, draft: "", query: "", index: 0 });
  };
  useEffect(() => {
    if (expanded && currentMatch && !transcriptSearch.editing)
      body.current?.scrollToText(
        currentMatch.anchorId,
        transcriptSearch.query,
        currentMatch.occurrence,
      );
  }, [
    expanded,
    currentMatch?.anchorId,
    currentMatch?.occurrence,
    currentMatch?.line,
    transcriptSearch.query,
    transcriptSearch.editing,
  ]);
  const [jobGroupFolds, setJobGroupFolds] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(new Set());
  const [streamThinkingRows, setStreamThinkingRows] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (state.running) return;
    setStreamThinkingRows((rows) => (rows.size ? new Set() : rows));
  }, [state.running]);
  const toggleStreamThinking = (id: string) =>
    setStreamThinkingRows((rows) => {
      const next = new Set(rows);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleRow = (id: string) =>
    setExpandedRows((rows) => {
      const next = new Set(rows);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [selectedMessage, setSelectedMessage] = useState<string>();
  const selectedMessageRef = useRef<string | undefined>(undefined);
  const selectMessage = (id?: string) => {
    selectedMessageRef.current = id;
    setSelectedMessage(id);
  };
  const messageRows = [
    ...state.completed.flatMap((entry, index) => {
      if (
        !completedEntryVisible(state, index) ||
        entry.type === "subagent" ||
        (entry.type === "tool" && entry.jobId)
      )
        return [];
      const anchorId = entry.anchorId ?? `row-${index}`;
      return [
        {
          anchorId: entry.type === "tool" && entry.id ? `tool-${entry.id}-header` : anchorId,
          expansionId:
            entry.type === "tool"
              ? (entry.id ?? `row-${index}`)
              : entry.type === "plan-review"
                ? entry.id
                : entry.type === "thinking"
                  ? anchorId
                  : undefined,
          liveThinking: false,
        },
      ];
    }),
    ...(state.reasoning
      ? [
          {
            anchorId: `${state.assistantAnchor}-thinking`,
            expansionId: `${state.assistantAnchor}-thinking`,
            liveThinking: true,
          },
        ]
      : []),
    ...(state.assistant
      ? [{ anchorId: state.assistantAnchor, expansionId: undefined, liveThinking: false }]
      : []),
    ...state.tools
      .filter((tool) => showsToolCard(tool.name))
      .map((tool) => ({
        anchorId: `tool-${tool.id}-header`,
        expansionId: tool.id,
        liveThinking: false,
      })),
  ];
  useEffect(() => {
    if (small || view !== "chat") selectMessage(undefined);
    else if (selectedMessage && !messageRows.some((row) => row.anchorId === selectedMessage))
      selectMessage(messageRows.at(-1)?.anchorId);
  }, [
    small,
    view,
    selectedMessage,
    state.completed,
    state.reasoning,
    state.assistant,
    state.tools,
  ]);
  const previousOutput = useRef({
    completed: state.completed,
    assistant: state.assistant,
    tools: state.tools,
    subagents: state.subagents,
    jobs: state.jobs,
    error: state.error,
  });
  const draft = useRef("");
  const {
    armedAt: exitArmedAt,
    arm: armExit,
    isWithinWindow: isExitArmed,
  } = useDoublePressWindow(1000);
  const {
    armedAt: rewindArmedAt,
    arm: armRewind,
    isWithinWindow: isRewindArmed,
  } = useDoublePressWindow(3000);
  const [rewindEmpty, setRewindEmpty] = useState(false);
  const [now, setNow] = useState(Date.now);
  const currentTime = Math.max(now, Date.now());
  const activity = renderActivity(state.activity, currentTime);
  const speed = conversation.getTpsMetrics(currentTime);
  const jobsAlive = Object.values(state.jobs).some(
    (job) => job.status === "running" || job.status === "stopping",
  );
  const nextWakeAt = Math.min(
    state.running ? (activity.nextWakeAt ?? Infinity) : Infinity,
    state.running ? (speed.nextWakeAt ?? Infinity) : Infinity,
    jobsAlive ? now + 1000 : Infinity,
  );
  useEffect(() => {
    if (!Number.isFinite(nextWakeAt)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, nextWakeAt - Date.now()));
    return () => clearTimeout(timer);
  }, [nextWakeAt]);
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
        previous.jobs !== state.jobs ||
        previous.error !== state.error)
    )
      setUnread(true);
    previousOutput.current = {
      completed: state.completed,
      assistant: state.assistant,
      tools: state.tools,
      subagents: state.subagents,
      jobs: state.jobs,
      error: state.error,
    };
  }, [
    bodyScroll?.following,
    unread,
    state.completed,
    state.assistant,
    state.tools,
    state.subagents,
    state.jobs,
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
    armExit();
    setInput(value);
  };
  const stageImage = async (path: string, insert: (text: string) => void, epoch: number) => {
    if (!pasteOwner.current || epoch !== pasteEpoch.current) return;
    const image = await composer.read(path);
    if (!pasteOwner.current || epoch !== pasteEpoch.current) return;
    const token = composer.bind(image, draft.current);
    insert(token + " ");
    notifyPastedImage(token);
  };
  const pasteClipboard = (insert: (text: string) => void) => {
    const epoch = pasteEpoch.current;
    const owned = () => pasteOwner.current && epoch === pasteEpoch.current;
    const stage = async (path: string) => {
      try {
        if (/\.(tiff?|bmp)$/i.test(path)) {
          if (owned()) notifyImage(t("image.clipboard-unsupported"), true);
          return;
        }
        await stageImage(path, insert, epoch);
      } catch (error) {
        if (owned()) notifyImage(t("image.paste-error", { error: formatError(error, t) }), true);
      }
    };
    void host
      .readClipboard()
      .then(async (content) => {
        if (!owned()) return;
        if ("files" in content) {
          for (const path of content.files) {
            if (!owned()) return;
            if (/\.(png|jpe?g|gif|webp)$/i.test(path)) await stage(path);
            else insert(path + " ");
          }
        } else if ("image" in content) await stage(content.image.path);
        else if ("text" in content) insert(content.text);
        else
          notifyImage(
            t("empty" in content ? "image.clipboard-empty" : "image.clipboard-unavailable"),
            true,
          );
      })
      .catch(() => {
        if (owned()) notifyImage(t("image.clipboard-error"), true);
      });
  };
  const returnToBottom = () => {
    body.current?.scrollToBottom();
    armExit();
  };
  const switchModel = async (spec: string, hadDraftImages = false) => {
    const hadImages =
      hadDraftImages ||
      composer.ordered(draft.current).length > 0 ||
      conversation
        .getSnapshot()
        .completed.some(
          (entry) => (entry.type === "message" || entry.type === "tool") && !!entry.images?.length,
        );
    try {
      await session.setModel(spec);
      composer.reset();
      pasteEpoch.current++;
      conversation.notice(t("model.changed", { model: session.model }));
      clearTimeout(modelImageNoticeTimer.current);
      setModelImageNotice(undefined);
      if (hadImages) notifyModelImages();
    } catch (error) {
      conversation.notice(formatError(error, t), true);
    }
  };
  const selectModel = (index: number) => {
    const hadDraftImages = modelPickerDraftImages.current;
    showModelPicker(undefined);
    void switchModel(models[index]!.spec, hadDraftImages);
  };
  const executeCommand = (prompt: string) => {
    const parsed = /^\/([a-z0-9-]+)(?:\s|$)/.exec(prompt);
    // /new is the image-input contract's alias for the existing /clear action.
    const name = parsed?.[1] === "new" ? "clear" : parsed?.[1];
    const command = catalog.find((entry) => entry.name === name);
    if (!command) {
      const accepted = submit(prompt, false, composer.ordered(prompt));
      if (accepted) setRewindEmpty(false);
      return accepted;
    }
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
      const hadDraftImages = composer.ordered(prompt).length > 0;
      // Bound attachments are not model arguments; literal token text remains
      // an argument. Capture their presence before submit or model reset clears them.
      const commandText = composer
        .ranges(prompt)
        .toReversed()
        .reduce((text, range) => text.slice(0, range.start) + text.slice(range.end), prompt);
      const spec = commandText.slice(parsed![0].length).trim();
      if (spec) void switchModel(spec, hadDraftImages);
      else {
        modelPickerDraftImages.current = hadDraftImages;
        // Submit can run before Chat handles the same Enter event. Open after
        // that event finishes so it cannot also pick the current model.
        queueMicrotask(() =>
          showModelPicker(
            Math.max(
              0,
              models.findIndex((model) => model.spec === session.model),
            ),
          ),
        );
      }
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
    } else if (command.name === "mcp") {
      const args = prompt.slice(parsed![0].length).trim();
      if (args) mcpCommands.execute(args);
      else {
        if (
          interactions.getSnapshot() ||
          previewRef.current ||
          rewindRef.current ||
          modelPickerRef.current !== undefined ||
          resumePickerRef.current ||
          sideController.current ||
          viewRef.current !== "chat"
        )
          return false;
        // Invalidate pending host/image reads synchronously, including same-batch close.
        pasteEpoch.current++;
        mcpOpening.current = true;
        mcpPanel.open();
        queueMicrotask(() => {
          mcpOpening.current = false;
        });
      }
    } else if (command.name === "resume") void openResumePicker();
    else if (command.name === "jobs") openJobs();
    else if (command.name === "settings") switchView("settings");
    else if (command.name === "compact")
      void conversation
        .compact(prompt.slice(parsed![0].length).trim() || undefined)
        .catch((error: unknown) => conversation.notice(formatError(error, t), true));
    else if (command.name === "context")
      conversation.contextReport(
        session.contextReport(),
        prompt.slice(parsed![0].length).trim() === "all",
        models.find((choice) => choice.spec === session.model)?.name,
      );
    else if (command.name === "rewind") openRewind();
    else if (command.name === "clear")
      void replaceSession().catch((error: unknown) =>
        conversation.notice(formatError(error, t), true),
      );
    else conversation.notice(t("command.unsupported", { name: command.name }));
    return true;
  };
  const sendInput = (prompt: string) => {
    if (previewRef.current) return;
    if (executeCommand(prompt)) {
      if (!mcpPanel.getSnapshot() && viewRef.current !== "jobs") body.current?.scrollToBottom();
      change("");
      composer.clear();
    }
  };
  const pickCommand = (item: ReturnType<typeof matches>[number], submitCommand: boolean) => {
    const value = item.completion ?? `/${item.name}`;
    if (!submitCommand || (item.needsArgument && draft.current.trim() !== value)) {
      history.reset();
      change(`${value} `);
      setPromptRevision((revision) => revision + 1);
    } else sendInput(value);
  };
  const openRewind = () => {
    const entries = session.checkpoints().toReversed();
    setRewindEmpty(!entries.length);
    if (!entries.length) return;
    showRewind({ entries, focus: 0, confirm: false, mode: 0, busy: false });
    body.current?.scrollToBottom();
  };
  const inputPositions = new Map(bodyScroll?.anchors?.map((anchor) => [anchor.id, anchor.top]));
  const timelineInputs = state.completed.flatMap((entry, index) => {
    if (entry.type !== "message" || entry.role !== "user" || entry.source) return [];
    const id = entry.anchorId ?? `row-${index}`;
    const top = inputPositions.get(id);
    return top !== undefined ? [{ id, text: entry.text, top }] : [];
  });
  const activeInput =
    timelineInputs.findLast((input) => input.top <= (bodyScroll?.top ?? 0)) ?? timelineInputs[0];
  const pinnedInput =
    activeInput && activeInput.top < (bodyScroll?.top ?? 0) ? activeInput : undefined;
  const pinnedHeight = Number(!small && !!bodyScroll && !bodyScroll.following && !!activeInput);
  const showReturn = !!bodyScroll && !bodyScroll.following;
  const mcpVisible = !!mcp && !interaction;
  const showContextBar = !(state.goal && interaction && rows < 16) && !(mcpVisible && rows < 20);
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
  const footerHeight = statusHeight + Number(!small && !!state.jobNotice);
  // Dialogs take priority. Reserve a preview for every visible panel before
  // deciding whether the prompt needs to use its one-row form.
  const panelCount = Number(hasTodos) + Number(hasSubagents);
  const goalRows = state.goal ? 1 + Number(state.goal.phase === "blocked") : 0;
  // Goal root and blocker cannot collapse into a panel's one-row preview.
  const panelMinimum = panelCount + goalRows;
  const minimumDialogHeight = state.goal
    ? Math.min(
        preferredDialogHeight,
        Math.max(5, rows - pinnedHeight - footerHeight - panelMinimum - 1),
      )
    : preferredDialogHeight;
  const sideHeight = side
    ? Math.min(
        10,
        Math.max(
          3,
          Math.min(Math.floor(rows / 2), rows - pinnedHeight - footerHeight - 2 - panelMinimum),
        ),
      )
    : 0;
  const dialogGap =
    question && rows - pinnedHeight - footerHeight - minimumDialogHeight - panelMinimum - 1 >= 1
      ? 1
      : 0;
  const visibleModelNotice = !interaction || userQuestion?.collapsed ? modelImageNotice : undefined;
  const wrappedModelNotice = visibleModelNotice
    ? Bun.wrapAnsi(
        t("image.model-unsupported", {
          model: imageWarningModelLabel(visibleModelNotice, columns),
        }),
        Math.max(1, columns - 3),
      )
    : undefined;
  const modelNoticeHeight = wrappedModelNotice?.split("\n").length ?? 0;
  const compactPrompt =
    (modelNoticeHeight > 0 &&
      rows - pinnedHeight - footerHeight - panelMinimum - 1 <
        promptMaxLines + 3 + modelNoticeHeight) ||
    ((!!side || !!rewind || !!resumePicker || mcpVisible) && rows < 20) ||
    (!!interaction &&
      rows - pinnedHeight - footerHeight - minimumDialogHeight - dialogGap - panelMinimum <
        promptMaxLines + 3);
  const promptHeight =
    Number(expanded) * (transcriptSearch.editing ? 2 : 1) +
    (compactPrompt ? 1 + Number(!!promptNotice) : promptMaxLines + 3) +
    modelNoticeHeight;
  const transcriptHeight = rewind
    ? Number(!compactPrompt)
    : interaction
      ? Number(!compactPrompt)
      : 1;
  const commandMenuHeight = Math.min(
    8,
    Math.max(0, rows - pinnedHeight - footerHeight - 3 - modelNoticeHeight),
  );
  const chromeSpace =
    rows - footerHeight - promptHeight - transcriptHeight - sideHeight - pinnedHeight;
  const showReturnControl =
    !mcpVisible && showReturn && chromeSpace - minimumDialogHeight - dialogGap - panelMinimum >= 1;
  const compactReturn =
    showReturnControl &&
    chromeSpace - minimumDialogHeight - dialogGap - panelMinimum - Number(hasActivity) < 2;
  const returnHeight = showReturnControl ? (compactReturn ? 1 : 2) : 0;
  const showActivity =
    hasActivity &&
    !mcpVisible &&
    !userQuestion?.oauth &&
    chromeSpace - minimumDialogHeight - dialogGap - panelMinimum - returnHeight >= 1;
  const available = chromeSpace - returnHeight - Number(showActivity);
  const panelReserve =
    panelCount > 0 && available - dialogGap - minimumDialogHeight >= panelCount * 3 + goalRows
      ? panelCount * 3 + goalRows
      : panelMinimum;
  const dialogMaxHeight =
    interaction && view !== "chat"
      ? Math.max(1, rows - 2)
      : interaction
        ? Math.max(
            minimumDialogHeight,
            Math.min(
              userQuestion?.collapsed ? 3 : userQuestion?.oauth ? available : Math.floor(rows / 2),
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
  const mcpMaxHeight = mcpVisible ? Math.max(0, Math.min(14, available - panelMinimum)) : 0;
  const mcpHeight = mcpVisible
    ? mcpPanelHeight({
        page: mcp!.page,
        selected: mcp!.selected,
        columns,
        maxHeight: mcpMaxHeight,
        locale,
        busy: mcp!.busy,
        result: mcp!.result,
        onActivate: mcpPanel.activate,
      })
    : 0;
  const panelHeights = allocatePanelHeights(
    available -
      dialogMaxHeight -
      dialogGap -
      rewindHeight -
      modelPickerHeight -
      resumePickerHeight -
      mcpHeight -
      goalRows,
    Array.from({ length: panelCount }, () => 3),
  );
  const todoMaxHeight = hasTodos ? panelHeights[0]! + goalRows : 1;
  const subagentMaxHeight = hasSubagents ? panelHeights[Number(hasTodos)]! : 1;
  const caretImage = composer.atCursor(input, composerCursor);
  const composerPreview =
    !expanded &&
    !preview &&
    !small &&
    !imagePreviewBlocked() &&
    !(composerDismissed && composerImageDismissed(caretImage)) &&
    caretImage;
  useInput((event) => {
    if (event.handled) return;
    const fileMenu = fileActionsRef.current;
    if (fileMenu) {
      handledInput.current.add(event);
      if (event.type !== "key") return;
      const { key } = event;
      if (key.name === "escape" || (key.ctrl && key.name === "c")) showFileActions(undefined);
      else if (!key.ctrl && !key.alt && !key.shift) {
        if (key.name === "up" || key.name === "down")
          showFileActions({
            ...fileMenu,
            focus: (fileMenu.focus + (key.name === "up" ? 2 : 1)) % 3,
          });
        else if (key.name === "enter") void pickFileAction(fileMenu.focus);
        else if (["1", "2", "3"].includes(event.input))
          void pickFileAction(Number(event.input) - 1);
      }
      return;
    }
    const currentCaretImage = composer.atCursor(draft.current, composerCursorRef.current);
    if (
      event.type === "key" &&
      event.key.name === "escape" &&
      !previewRef.current &&
      !expandedRef.current &&
      !small &&
      !imagePreviewBlocked() &&
      currentCaretImage &&
      !composerImageDismissed(currentCaretImage)
    ) {
      dismissedComposerImage.current = currentCaretImage;
      setComposerDismissed(true);
      handledInput.current.add(event);
      return;
    }
    const currentMcp = mcpPanel.getSnapshot();
    if (currentMcp && !interactions.getSnapshot()) {
      handledInput.current.add(event);
      if (event.type !== "key") return;
      const { key } = event;
      if (mcpOpening.current && key.name === "enter") return;
      if (key.ctrl && key.name === "c") {
        if (conversation.isRunning()) conversation.interrupt();
        mcpPanel.close();
      } else if (key.ctrl && key.name === "d" && !conversation.isRunning()) {
        mcpPanel.close();
        onExit();
      } else if (key.name === "escape") mcpPanel.back();
      else if (!small && !key.ctrl && !key.alt && !key.shift) {
        if (key.name === "tab" && currentMcp.page.kind === "server") mcpPanel.focus();
        else if (key.name === "pageup" || key.name === "pagedown")
          mcpBody.current?.scrollBy(
            Math.max(1, (mcpBody.current.getSnapshot().height ?? 1) - 1) *
              (key.name === "pageup" ? -1 : 1),
          );
        else if (key.name === "up" || key.name === "down") {
          if (currentMcp.page.kind === "tool" || currentMcp.focus === "body")
            mcpBody.current?.scrollBy(key.name === "up" ? -1 : 1);
          else mcpPanel.move(key.name === "up" ? -1 : 1);
        } else if (
          key.name === "enter" &&
          (currentMcp.page.kind !== "server" || currentMcp.focus === "actions")
        )
          mcpPanel.activate(currentMcp.selected);
      }
      return;
    }
    if (previewRef.current && !interactions.getSnapshot()) {
      handledInput.current.add(event);
      if (event.type === "key") {
        const { key } = event;
        if (
          key.name === "escape" ||
          (key.ctrl && key.name === "c") ||
          (!key.ctrl && !key.alt && !key.shift && key.name === "enter")
        )
          showPreview(undefined);
        else if (
          !key.ctrl &&
          !key.alt &&
          !key.shift &&
          (key.name === "left" || key.name === "right")
        )
          stepImage(key.name === "left" ? -1 : 1);
      }
      return;
    }
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
        else if (key.name === "enter") selectModel(modelFocus);
      }
      return;
    }
    // A parent request temporarily owns a full-screen view without changing its return target.
    const currentView = interactions.getSnapshot() ? "chat" : viewRef.current;
    if (currentView === "jobs") {
      handledInput.current.add(event);
      if (event.type === "wheel") {
        disarmKill();
        jobsScroll.current?.scrollBy(event.delta * 3);
      }
      if (event.type !== "key") return;
      const { key } = event;
      if (key.name === "escape" || (key.ctrl && key.name === "c")) closeView();
      else if (key.name === "up" || key.name === "down") {
        const jobs = Object.values(conversation.getSnapshot().jobs);
        selectJob(
          Math.max(
            0,
            Math.min(jobs.length - 1, jobFocusRef.current + (key.name === "up" ? -1 : 1)),
          ),
        );
      } else if (key.name === "pageup" || key.name === "pagedown") {
        disarmKill();
        jobsScroll.current?.scrollBy(
          (jobsScroll.current.getSnapshot().height - 1) * (key.name === "pageup" ? -1 : 1),
        );
      } else if (!key.ctrl && !key.alt && !key.shift) {
        const selected = Object.values(conversation.getSnapshot().jobs)[jobFocusRef.current];
        if (
          event.input === "k" &&
          selected &&
          (selected.status === "running" || selected.status === "stopping")
        ) {
          if (
            killArmRef.current?.id === selected.id &&
            performance.now() < killArmRef.current.until
          ) {
            disarmKill();
            const stopping = session.killJob(selected.id);
            conversation.refreshJobs();
            void stopping.catch((error: unknown) =>
              conversation.notice(formatError(error, t), true),
            );
          } else {
            killArmRef.current = { id: selected.id, until: performance.now() + 4000 };
            setKillArmed(killArmRef.current);
          }
        } else {
          disarmKill();
          if (event.input === "e" && selected)
            setJobDetails((previous) => {
              const next = new Set(previous);
              if (next.has(selected.id)) next.delete(selected.id);
              else next.add(selected.id);
              return next;
            });
        }
      } else disarmKill();
      return;
    }
    if (currentView === "settings") return;
    if (currentView !== "chat") {
      if (!small && typeof currentView === "object" && toolWindows?.handle(event)) {
        handledInput.current.add(event);
        return;
      }
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
        if (!currentView.agentView && (key.name === "left" || key.name === "right")) {
          const pages: DetailPage[] = ["summary", "output", "tools"];
          turnPage(pages[(pages.indexOf(pageRef.current) + (key.name === "left" ? 2 : 1)) % 3]!);
        } else if (key.name === "up" || key.name === "down")
          subagentScroll.current?.scrollBy(key.name === "up" ? -3 : 3);
        else if (key.name === "pageup" || key.name === "pagedown")
          subagentScroll.current?.scrollBy(
            (subagentScroll.current.getSnapshot().height - 1) * (key.name === "pageup" ? -1 : 1),
          );
        else if (key.name === "home" || key.name === "end")
          subagentScroll.current?.scrollBy(key.name === "home" ? -Infinity : Infinity);
        else if (
          !currentView.agentView &&
          !key.ctrl &&
          !key.alt &&
          event.input.toLowerCase() === "x"
        )
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
      !small &&
      !interactions.getSnapshot() &&
      !sideController.current &&
      !previewRef.current &&
      !searchRef.current.editing &&
      toolWindows?.handle(event)
    ) {
      handledInput.current.add(event);
      return;
    }
    if (
      !small &&
      !interactions.getSnapshot() &&
      !sideController.current &&
      !previewRef.current &&
      !searchRef.current.editing &&
      viewRef.current === "chat" &&
      event.type === "key"
    ) {
      const { key } = event;
      const selectedMessage = selectedMessageRef.current;
      if (!key.ctrl && !key.alt && ((key.shift && key.name === "up") || selectedMessage)) {
        const index = messageRows.findIndex((row) => row.anchorId === selectedMessage);
        const row = selectedMessage ? messageRows[index] : messageRows.at(-1);
        if (key.name === "escape") selectMessage(undefined);
        else if (key.name === "enter" && row?.expansionId) {
          if (row.liveThinking) toggleStreamThinking(row.expansionId);
          else toggleRow(row.expansionId);
        } else if (["up", "down", "left", "right"].includes(key.name)) {
          const next = selectedMessage
            ? messageRows[
                Math.max(
                  0,
                  Math.min(
                    messageRows.length - 1,
                    index + (key.name === "up" || key.name === "left" ? -1 : 1),
                  ),
                )
              ]
            : row;
          selectMessage(next?.anchorId);
          if (next) body.current?.scrollToAnchor(next.anchorId);
        } else if (key.name !== "enter") return;
        handledInput.current.add(event);
        return;
      }
    }
    if (
      event.type === "key" &&
      event.key.ctrl &&
      event.key.name === "o" &&
      !event.key.alt &&
      !event.key.shift &&
      !small &&
      !interactions.getSnapshot() &&
      !sideController.current &&
      !previewRef.current
    ) {
      handledInput.current.add(event);
      selectMessage(undefined);
      if (expandedRef.current) closeTranscript();
      else {
        expandedRef.current = true;
        setExpanded(true);
      }
      return;
    }
    if (
      expandedRef.current &&
      !interactions.getSnapshot() &&
      !sideController.current &&
      !previewRef.current &&
      !small
    ) {
      if (event.type === "key" && event.key.name === "escape") {
        handledInput.current.add(event);
        closeTranscript();
        return;
      }
      if (searchRef.current.editing && (event.type === "key" || event.type === "paste")) {
        handledInput.current.add(event);
        searchInputEvents.current.add(event);
        return;
      }
      if (!searchRef.current.editing && event.type === "key" && !event.key.ctrl && !event.key.alt) {
        if (event.input === "/") {
          handledInput.current.add(event);
          updateSearch({ ...searchRef.current, editing: true, draft: "" });
          dismissTooltip?.();
          return;
        }
        if ((event.input === "n" || event.input === "N") && searchRef.current.query) {
          handledInput.current.add(event);
          const count = searchMatches.length;
          updateSearch({
            ...searchRef.current,
            index: count
              ? (searchRef.current.index + (event.input === "N" ? count - 1 : 1)) % count
              : 0,
          });
          return;
        }
      }
    }
    if (
      event.type === "key" &&
      event.key.ctrl &&
      event.key.name === "a" &&
      !interactions.getSnapshot() &&
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
      if (handledInput.current.has(event)) return;
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
      armExit();
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
      armExit();
      return;
    }
    if (handledInput.current.has(event)) return;
    const { key } = event;
    const pendingInteraction = sideController.current ? undefined : interactions.getSnapshot();
    if (
      !small &&
      !pendingInteraction &&
      !key.ctrl &&
      !key.alt &&
      !key.shift &&
      (key.name === "end" || (key.name === "enter" && !matches(draft.current).length)) &&
      body.current &&
      !body.current.getSnapshot().following
    ) {
      returnToBottom();
      // Return also reaches the editor/menu, as in the fixed reference.
      if (key.name === "end") {
        handledInput.current.add(event);
        return;
      }
    }
    if (pendingInteraction || key.name !== "escape") armRewind();
    const menu = !pendingInteraction && !small ? matches(draft.current) : [];
    if (menu.length && key.name === "tab" && key.shift && !key.ctrl && !key.alt) {
      handledInput.current.add(event);
      return;
    }
    if (menu.length && !key.ctrl && !key.alt && !key.shift) {
      if ((key.name === "up" || key.name === "down") && !history.isBrowsing()) {
        handledInput.current.add(event);
        commandSelectionRef.current =
          (commandSelectionRef.current + (key.name === "up" ? menu.length - 1 : 1)) % menu.length;
        setCommandSelection(commandSelectionRef.current);
        return;
      }
      if (key.name === "tab" || key.name === "enter") {
        handledInput.current.add(event);
        const item = menu[commandSelectionRef.current % menu.length]!;
        pickCommand(item, key.name === "enter");
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
      armExit();
      return;
    }
    if (
      key.name === "tab" &&
      key.shift &&
      !key.ctrl &&
      !key.alt &&
      pendingInteraction?.kind !== "question"
    ) {
      armExit();
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
      armExit();
      return;
    }
    if (!small && (key.name === "pageup" || key.name === "pagedown")) {
      const viewport =
        pendingInteraction?.kind === "question" && pendingInteraction.oauth
          ? authDetails.current
          : pendingInteraction?.kind === "plan" || (pending && scrollFocus === "details")
            ? details.current
            : body.current;
      viewport?.scrollBy(
        Math.max(1, (viewport.getSnapshot().height ?? 1) - 1) * (key.name === "pageup" ? -1 : 1),
      );
      armExit();
      return;
    }
    if (small && key.name !== "escape" && !(key.ctrl && (key.name === "c" || key.name === "d")))
      return;
    if (pendingInteraction?.kind === "plan" && !(key.ctrl && key.name === "c")) {
      armExit();
      interactions.planInput(event);
      return;
    }
    if (pendingInteraction?.kind === "question") {
      armExit();
      interactions.questionInput(event);
      return;
    }
    if (!small && pending && !(key.ctrl && key.name === "c")) {
      armExit();
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
        armExit();
      } else if (!key.ctrl) {
        if (draft.current) {
          history.reset();
          change("");
        } else if (!small) {
          const now = performance.now();
          if (isRewindArmed(now)) {
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
          if (isExitArmed(now)) onExit();
          else armExit(now);
        }
      }
    } else if (key.ctrl && key.name === "d" && !draft.current) {
      if (!conversation.isRunning()) onExit();
    } else armExit();
  });
  const completed = useMemo(
    () =>
      state.completed.map((entry, index) => {
        if (!completedEntryVisible(state, index)) return null;
        const hasJob = (candidate: typeof entry | undefined) =>
          candidate?.type === "tool" && candidate.jobId && state.jobs[candidate.jobId];
        if (hasJob(entry)) {
          if (hasJob(state.completed[index - 1])) return null;
          const group = [];
          for (let at = index; at < state.completed.length; at++) {
            const candidate = state.completed[at];
            if (candidate?.type !== "tool" || !candidate.jobId || !state.jobs[candidate.jobId])
              break;
            group.push({ entry: candidate, job: state.jobs[candidate.jobId]!, index: at });
          }
          if (group.length >= 2) {
            const groupId = group[0]!.job.id;
            const folded =
              !expanded &&
              (jobGroupFolds.get(groupId) ??
                (group.length >= 3 &&
                  group.every(({ job }) => job.status !== "running" && job.status !== "stopping")));
            return (
              <Box key={index} flexDirection="column">
                <JobGroupHeader
                  jobs={group.map(({ job }) => job)}
                  folded={folded}
                  columns={columns}
                  locale={locale}
                  onToggle={() =>
                    setJobGroupFolds((previous) => new Map(previous).set(groupId, !folded))
                  }
                />
                {!folded && (
                  <Box flexDirection="column">
                    {group.map(({ job, index: at }, position) => (
                      <Box key={at} flexDirection="column">
                        <JobCard
                          job={job}
                          output={job.output}
                          groupPosition={
                            position === 0
                              ? "first"
                              : position === group.length - 1
                                ? "last"
                                : "middle"
                          }
                          dropped={job.dropped}
                          expanded={expanded}
                          columns={columns}
                          locale={locale}
                          onOpen={openJobs}
                        />
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            );
          }
        }
        switch (entry.type) {
          case "tool":
            if (entry.jobId && state.jobs[entry.jobId])
              return (
                <JobCard
                  key={index}
                  job={state.jobs[entry.jobId]!}
                  output={state.jobs[entry.jobId]!.output}
                  dropped={state.jobs[entry.jobId]!.dropped}
                  expanded={expanded}
                  onOpen={openJobs}
                  columns={columns}
                  locale={locale}
                />
              );
            return (
              <Box key={index} flexDirection="column">
                <ToolCall
                  onPathClick={openFileActions}
                  foldTerminalCommand={foldTerminalCommand}
                  expanded={expanded || expandedRows.has(entry.id ?? `row-${index}`)}
                  onToggle={() => toggleRow(entry.id ?? `row-${index}`)}
                  locale={locale}
                  summary={entry.summary}
                  id={entry.id ?? `row-${index}`}
                  searchLocation={
                    currentMatch?.toolId === (entry.id ?? `row-${index}`)
                      ? {
                          part: currentMatch.part!,
                          line: currentMatch.line,
                          offset: currentMatch.offset,
                        }
                      : undefined
                  }
                  name={entry.name}
                  args={entry.args}
                  callView={entry.callView}
                  resultView={entry.resultView}
                  startedAt={entry.startedAt}
                  endedAt={entry.endedAt}
                  replayed={entry.replayed}
                  status={entry.isError ? "error" : "success"}
                  outcomeUnknown={entry.outcomeUnknown}
                  result={entry.result}
                  images={entry.images?.map(presentImage)}
                  onImageOpen={(imageIndex) => openImage(index, imageIndex)}
                  imagesSuspended={!!preview}
                  error={entry.error}
                />
              </Box>
            );
          case "question":
            return <ThemedText key={index}>{entry.text}</ThemedText>;
          case "plan-review":
            return (
              <PlanReviewRow
                key={index}
                {...entry}
                locale={locale}
                expanded={expanded || expandedRows.has(entry.id)}
                onToggle={() => toggleRow(entry.id)}
              />
            );
          case "subagent":
            return state.subagents[entry.agentId] ? (
              <SubagentMessage
                key={index}
                subagent={state.subagents[entry.agentId]!}
                columns={columns}
                effort={thinking}
                locale={locale}
                onClick={() => openDetail(entry.agentId, "chat")}
                onOpenView={() => openDetail(entry.agentId, "chat", true)}
              />
            ) : null;
          case "context-report":
            return (
              <ContextVisualization
                key={index}
                report={entry.report}
                expanded={entry.expanded}
                modelName={entry.modelName}
                columns={columns}
                locale={locale}
              />
            );
          case "thinking":
            return (
              <ThinkingRow
                key={index}
                text={entry.text}
                durationMs={entry.durationMs}
                revealKey={entry.anchorId ?? `thinking-${index}`}
                locale={locale}
                expanded={
                  expanded ||
                  expandedRows.has(entry.anchorId ?? `thinking-${index}`) ||
                  streamThinkingRows.has(entry.anchorId ?? `thinking-${index}`)
                }
                onToggle={() =>
                  (entry.thinkingOpen ? toggleStreamThinking : toggleRow)(
                    entry.anchorId ?? `thinking-${index}`,
                  )
                }
              />
            );
          case "session-notice":
            return <SessionNoticeRow key={index} notice={entry.notice} locale={locale} />;
          case "notice":
            return (
              <Notice
                key={index}
                kind="info"
                text={entry.text}
                report={entry.report}
                divider={!entry.report}
              />
            );
          case "message":
            return entry.role === "user" ? (
              <UserMessage
                key={index}
                text={entry.text}
                source={entry.source}
                locale={locale}
                images={entry.images?.map(presentImage)}
                onImageOpen={(imageIndex) => openImage(index, imageIndex)}
                imagesSuspended={!!preview}
              />
            ) : (
              <Fragment key={index}>
                <AssistantMessage
                  text={entry.text}
                  revealKey={entry.anchorId ?? `assistant-${index}`}
                  streaming={entry.fresh}
                />
                {!!entry.images?.length && (
                  <ImageGallery
                    images={entry.images?.map(presentImage)}
                    locale={locale}
                    suspended={!!preview}
                    onOpen={(imageIndex) => openImage(index, imageIndex)}
                  />
                )}
              </Fragment>
            );
        }
      }),
    [
      state.completed,
      state.subagents,
      state.jobs,
      expanded,
      expandedRows,
      streamThinkingRows,
      jobGroupFolds,
      columns,
      thinking,
      foldTerminalCommand,
      currentMatch,
      locale,
      !!preview,
    ],
  );
  const interactionPanel = (
    <>
      {userQuestion && currentQuestion && (
        <QuestionDialog
          auth={
            userQuestion.oauth
              ? {
                  scrollRef: authDetails,
                  detail: [
                    userQuestion.oauth.note,
                    t(userQuestion.oauth.opened ? "mcp.auth.opened" : "mcp.auth.manual"),
                    t(userQuestion.oauth.opened ? "mcp.auth.fallback" : "mcp.auth.copy-hint"),
                    userQuestion.oauth.authorizationUrl,
                  ]
                    .filter(Boolean)
                    .join("\n"),
                }
              : undefined
          }
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
    </>
  );
  if (interaction && view !== "chat")
    return (
      <Box height={rows} flexDirection="column">
        {small ? <ThemedText wrap="truncate">{t("window.small")}</ThemedText> : interactionPanel}
      </Box>
    );
  if (view === "jobs")
    return (
      <JobsPanel
        rows={rows}
        columns={columns}
        locale={locale}
        jobs={Object.values(state.jobs)}
        focusIndex={jobFocus}
        expanded={jobDetails}
        armed={killArmed?.id}
        scrollRef={jobsScroll}
        onSelect={selectJob}
        initialScroll={restoredViewScroll}
      />
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
        initialTop={restoredViewScroll?.top ?? savedDashboardScroll.current?.top ?? 0}
        onSelect={(id) => openDetail(id, "dashboard")}
      />
    );
  if (typeof view === "object" && selectedSubagent)
    return (
      <Box height={rows} flexDirection="column">
        <SubagentDetailScene
          subagent={selectedSubagent}
          agentView={typeof view === "object" && view.agentView}
          onPathClick={openFileActions}
          foldTerminalCommand={foldTerminalCommand}
          page={page}
          thinkingOpen={thinkingOpen}
          expanded={expanded}
          scrollRef={subagentScroll}
          initialScroll={restoredViewScroll}
          rows={rows}
          locale={locale}
          onBack={closeView}
          onPage={turnPage}
          onInterrupt={() => session.interruptSubagent(selectedSubagent.agentId)}
        />
        {fileActions && (
          <FileActionsPanel
            {...fileActions}
            columns={columns}
            rows={rows}
            locale={locale}
            onPick={(index) => void pickFileAction(index)}
          />
        )}
      </Box>
    );
  const railVisible =
    !small &&
    columns >= 60 &&
    timelineInputs.length >= 2 &&
    !!bodyScroll &&
    bodyScroll.height >= 3 &&
    bodyScroll.total > bodyScroll.height;
  const navigationEnabled =
    !interaction &&
    !side &&
    !preview &&
    !fileActions &&
    !mcp &&
    modelPicker === undefined &&
    !resumePicker &&
    !rewind;
  const seekInput = (id: string) => {
    if (!navigationEnabled) return;
    selectMessage(undefined);
    toolWindows?.clear();
    body.current?.scrollToAnchor(id);
  };
  const promptReadOnly =
    !!selectedMessage ||
    transcriptSearch.editing ||
    !!mcp ||
    !!fileActions ||
    !!preview ||
    modelPicker !== undefined ||
    !!resumePicker ||
    !!rewind ||
    (!!interaction && !userQuestion?.collapsed);
  return (
    <Box flexDirection="column" height={rows}>
      {pinnedHeight > 0 && (
        <Box
          height={1}
          flexShrink={0}
          selectable={false}
          onClick={pinnedInput && navigationEnabled ? () => seekInput(pinnedInput.id) : undefined}
        >
          <ThemedText color="userPromptLabel" bold wrap="truncate">
            {pinnedInput ? `❯ ${pinnedInput.text.replace(/\s+/gu, " ").trim()}` : " "}
          </ThemedText>
        </Box>
      )}
      <Box
        flexGrow={small && !preview ? 0 : 1}
        flexShrink={1}
        height={small && !preview ? 0 : undefined}
      >
        <ScrollBox
          textSelection={
            small || pendingInteraction || preview || imagePreviewBlocked()
              ? false
              : {
                  key: session.id,
                  backgroundColor: theme.badgeBackground,
                  onCopy: (text) => host.writeClipboard(text),
                  onResult: (result) => {
                    if (pasteOwner.current)
                      notifyImage(
                        t(`selection.${result}`),
                        result === "unavailable" || result === "stale",
                      );
                  },
                }
          }
          textSearch={
            expanded && transcriptSearch.query
              ? {
                  query: transcriptSearch.query,
                  color: theme.inverseText,
                  backgroundColor: theme.badgeBackground,
                }
              : undefined
          }
          ref={body}
          onScroll={setBodyScroll}
          initialFollow={savedChatScroll.current?.following ?? true}
          initialTop={savedChatScroll.current?.top ?? 0}
          initialAnchor={savedChatScroll.current?.anchor}
          height={small && !preview ? 0 : undefined}
          flexGrow={small && !preview ? 0 : 1}
        >
          <Logo
            locale={locale}
            key="startup-logo"
            model={state.model}
            cwd={cwd}
            thinking={thinking}
            working={state.running}
          />
          <Box flexDirection="column" gap={1}>
            {completed.map(
              (entry, index) =>
                entry && (
                  <Box
                    key={index}
                    backgroundColor={
                      selectedMessage ===
                      (state.completed[index]?.type === "tool" && state.completed[index].id
                        ? `tool-${state.completed[index].id}-header`
                        : (state.completed[index]?.anchorId ?? `row-${index}`))
                        ? theme.messageActionsBackground
                        : undefined
                    }
                    scrollAnchorId={state.completed[index]?.anchorId ?? `row-${index}`}
                    flexDirection="column"
                  >
                    {entry}
                  </Box>
                ),
            )}
            {state.reasoning && (
              <Box
                backgroundColor={
                  selectedMessage === `${state.assistantAnchor}-thinking`
                    ? theme.messageActionsBackground
                    : undefined
                }
                scrollAnchorId={`${state.assistantAnchor}-thinking`}
                flexDirection="column"
              >
                <ThinkingRow
                  text={state.reasoning}
                  durationMs={state.reasoningDurationMs}
                  streaming={!state.reasoningSettled}
                  preview={!state.reasoningSettled}
                  revealKey={`${state.assistantAnchor}-thinking`}
                  locale={locale}
                  expanded={expanded || streamThinkingRows.has(`${state.assistantAnchor}-thinking`)}
                  onToggle={() => toggleStreamThinking(`${state.assistantAnchor}-thinking`)}
                />
              </Box>
            )}
            {state.assistant && (
              <Box
                backgroundColor={
                  selectedMessage === state.assistantAnchor
                    ? theme.messageActionsBackground
                    : undefined
                }
                scrollAnchorId={state.assistantAnchor}
                flexDirection="column"
              >
                <AssistantMessage
                  text={state.assistant}
                  revealKey={state.assistantAnchor}
                  streaming
                />
              </Box>
            )}
            {state.tools
              .filter((tool) => showsToolCard(tool.name))
              .map((tool) => (
                <Box
                  key={tool.id}
                  backgroundColor={
                    selectedMessage === `tool-${tool.id}-header`
                      ? theme.messageActionsBackground
                      : undefined
                  }
                  flexDirection="column"
                >
                  <ToolCall
                    foldTerminalCommand={foldTerminalCommand}
                    key={tool.id}
                    onPathClick={openFileActions}
                    expanded={expanded || expandedRows.has(tool.id)}
                    onToggle={() => toggleRow(tool.id)}
                    id={tool.id}
                    searchLocation={
                      currentMatch?.toolId === tool.id
                        ? {
                            part: currentMatch.part!,
                            line: currentMatch.line,
                            offset: currentMatch.offset,
                          }
                        : undefined
                    }
                    name={tool.name}
                    args={tool.args}
                    callView={tool.callView}
                    startedAt={tool.startedAt}
                    locale={locale}
                    summary={tool.summary}
                    status="running"
                  />
                </Box>
              ))}
            {state.error && <Notice kind="error" text={state.error} />}
          </Box>
        </ScrollBox>
        {railVisible && bodyScroll && (
          <TimelineRail
            inputs={timelineInputs}
            snapshot={bodyScroll}
            enabled={navigationEnabled}
            onSeek={seekInput}
          />
        )}
      </Box>
      {composerPreview && (
        <ImagePreview
          key={`composer-${composerPreview.token}-${composerPreview.start}`}
          passive
          image={presentImage(composerPreview.image)}
          index={composerPreview.index}
          total={1}
          width={columns}
          height={bodyScroll?.height ?? Math.max(1, rows - promptHeight - footerHeight)}
          locale={locale}
        />
      )}
      {preview && (
        <ImagePreview
          key={preview.index}
          image={presentImage(preview.images[preview.index]!)}
          index={preview.index}
          total={preview.images.length}
          width={columns}
          height={
            small
              ? Math.max(1, rows - 1)
              : (bodyScroll?.height ?? Math.max(1, rows - promptHeight - footerHeight))
          }
          locale={locale}
          onClose={() => showPreview(undefined)}
          onStep={stepImage}
          onOriginal={async (image) => {
            try {
              await imageViewer.open(image);
            } catch (error) {
              if (pasteOwner.current)
                notifyImage(t("image.open-error", { error: formatError(error, t) }), true);
              throw error;
            }
          }}
        />
      )}
      <Box flexDirection="column" flexShrink={0}>
        {!small && state.jobNotice && (
          <Notice kind={state.jobNotice.kind} text={state.jobNotice.text} truncate />
        )}
        {small ? (
          <ThemedText wrap="truncate">{t("window.small")}</ThemedText>
        ) : (
          <>
            {showReturnControl && (
              <ScrollToBottom
                locale={locale}
                columns={columns}
                unread={unread}
                onClick={() => {
                  if (!previewRef.current && !mcpPanel.getSnapshot()) returnToBottom();
                }}
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
              onToggle={() => {
                if (!previewRef.current && !mcpPanel.getSnapshot())
                  setSubagentsCollapsed((collapsed) => !collapsed);
              }}
              onOpen={(id) => openDetail(id, "chat")}
              locale={locale}
              maxHeight={subagentMaxHeight}
            />
            {interactionPanel}
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
                onPick={selectModel}
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
            {mcpVisible && mcp && (
              <McpPanel
                page={mcp.page}
                selected={mcp.selected}
                focus={mcp.focus}
                result={mcp.result}
                busy={mcp.busy}
                columns={columns}
                maxHeight={mcpMaxHeight}
                locale={locale}
                interactive={!small && !interaction}
                scrollRef={mcpBody}
                initialTop={mcpPanel.top()}
                onScroll={(snapshot) => mcpPanel.scroll(snapshot.top)}
                onActivate={(key) => {
                  if (mcpCanInteract()) mcpPanel.activate(key);
                }}
                onListWheel={(delta) => {
                  if (mcpCanInteract()) mcpPanel.move(delta > 0 ? 1 : -1);
                }}
                onBodyFocus={() => {
                  if (mcpCanInteract()) mcpPanel.focus(true);
                }}
                onBodyWheel={(delta) => {
                  if (mcpCanInteract()) {
                    mcpPanel.focus(true);
                    mcpBody.current?.scrollBy(delta * 3);
                  }
                }}
              />
            )}
            {expanded && (
              <Box flexDirection="column">
                <ThemedText color="accent">
                  {transcriptSearch.editing
                    ? t("transcript.search-input")
                    : transcriptSearch.query
                      ? searchMatches.length
                        ? t("transcript.search-count", {
                            index: (transcriptSearch.index % searchMatches.length) + 1,
                            count: searchMatches.length,
                            query: transcriptSearch.query,
                          })
                        : t("transcript.search-none", { query: transcriptSearch.query })
                      : t("transcript.mode")}
                </ThemedText>
                {transcriptSearch.editing && (
                  <TextInput
                    isActive={!small && !interaction && !side && !preview && !fileActions && !mcp}
                    value={transcriptSearch.draft}
                    onChange={(draft) => updateSearch({ ...searchRef.current, draft })}
                    onSubmit={(query) =>
                      updateSearch({ editing: false, draft: query, query: query.trim(), index: 0 })
                    }
                    filterInput={(event) =>
                      !handledInput.current.has(event) || searchInputEvents.current.has(event)
                    }
                  />
                )}
              </Box>
            )}
            <PromptInput
              suggestions={
                !expanded &&
                !!commandMatches.length &&
                !mcp &&
                !preview &&
                !interaction &&
                !rewind &&
                !resumePicker &&
                modelPicker === undefined ? (
                  <CommandSuggestions
                    key={promptRevision}
                    items={commandMatches}
                    selected={commandSelection % commandMatches.length}
                    maxHeight={commandMenuHeight}
                    columns={columns}
                    query={input}
                    locale={locale}
                    planMode={state.planMode}
                    onPick={(index) => pickCommand(commandMatches[index]!, true)}
                    onWheel={(event) => {
                      handledInput.current.add(event);
                      commandSelectionRef.current = Math.max(
                        0,
                        Math.min(
                          commandMatches.length - 1,
                          commandSelectionRef.current + (event.delta > 0 ? 1 : -1),
                        ),
                      );
                      setCommandSelection(commandSelectionRef.current);
                    }}
                  />
                ) : undefined
              }
              notice={promptNotice}
              warning={wrappedModelNotice}
              tip={
                exitArmedAt !== undefined
                  ? t("exit.again")
                  : rewindArmedAt !== undefined
                    ? t("rewind.again")
                    : rewindEmpty
                      ? t("rewind.empty")
                      : clipboardImage && !promptReadOnly
                        ? t("image.clipboard-tip")
                        : undefined
              }
              initialCursorOffset={composerCursor}
              inputRevision={promptRevision}
              readOnly={promptReadOnly}
              compact={compactPrompt}
              maxLines={compactPrompt ? 1 : promptMaxLines}
              columns={columns}
              working={state.running}
              planMode={state.planMode}
              history={history}
              onHistoryRecall={() => {
                if (mcpPanel.getSnapshot()) return;
                composer.clear();
                pasteEpoch.current++;
              }}
              filterInput={(event, insert) => {
                if (
                  selectedMessageRef.current ||
                  (event.type === "key" &&
                    event.key.shift &&
                    !event.key.ctrl &&
                    !event.key.alt &&
                    event.key.name === "up" &&
                    !interactions.getSnapshot() &&
                    !small)
                )
                  return false;
                if (
                  expandedRef.current &&
                  event.type === "key" &&
                  !event.key.ctrl &&
                  !event.key.alt &&
                  (event.input === "/" ||
                    (searchRef.current.query && (event.input === "n" || event.input === "N")) ||
                    event.key.name === "escape")
                )
                  return false;
                if (searchRef.current.editing) return false;
                if (
                  !interactions.getSnapshot() &&
                  !small &&
                  event.type === "key" &&
                  !event.key.ctrl &&
                  !event.key.alt &&
                  !event.key.shift &&
                  event.key.name === "end" &&
                  body.current &&
                  !body.current.getSnapshot().following
                )
                  return false;
                if (
                  fileActionsRef.current ||
                  mcpPanel.getSnapshot() ||
                  previewRef.current ||
                  handledInput.current.has(event)
                )
                  return false;
                if (
                  event.type === "key" &&
                  !event.key.ctrl &&
                  !event.key.alt &&
                  !event.key.shift &&
                  ["up", "down"].includes(event.key.name) &&
                  history.isBrowsing() &&
                  viewRef.current === "chat" &&
                  modelPickerRef.current === undefined &&
                  resumePickerRef.current === undefined &&
                  !handledInput.current.has(event)
                ) {
                  // History may restore a slash draft and end its walk during this key.
                  // Let the editor consume it without navigating the newly opened menu.
                  handledInput.current.add(event);
                  return true;
                }
                if (
                  event.type === "key" &&
                  event.key.ctrl &&
                  event.key.name === "v" &&
                  viewRef.current === "chat" &&
                  modelPickerRef.current === undefined &&
                  resumePickerRef.current === undefined &&
                  !handledInput.current.has(event)
                ) {
                  pasteClipboard(insert);
                  return false;
                }
                return (
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
                    (["tab", "enter"].includes(event.key.name) ||
                      (!history.isBrowsing() && ["up", "down"].includes(event.key.name)))
                  )
                );
              }}
              onCursorChange={updateComposerCursor}
              onAtomicRangeClick={
                !expanded && !small && !preview && !imagePreviewBlocked()
                  ? (offset) => {
                      if (previewRef.current || imagePreviewBlocked()) return;
                      const selected = composer.atCursor(draft.current, offset);
                      if (!selected) return;
                      const images = composer.ordered(draft.current);
                      updateComposerCursor(offset);
                      // Closing this modal must not immediately reveal the caret card underneath.
                      dismissedComposerImage.current = selected;
                      setComposerDismissed(true);
                      showPreview({
                        images,
                        index: images.indexOf(selected.image),
                        composer: true,
                      });
                    }
                  : undefined
              }
              highlightRanges={composer.ranges(input).map((range) => ({
                ...range,
                color: theme.suggestion,
                inverse: preview?.composer
                  ? composer.atCursor(input, range.start)?.image === preview.images[preview.index]
                  : !!composerPreview && range.start === composerCursor,
              }))}
              atomicRanges={composer.ranges(input)}
              onPaste={(text, insert) => {
                if (fileActionsRef.current || mcpPanel.getSnapshot() || previewRef.current) return;
                const epoch = pasteEpoch.current;
                const path = pastedImagePath(text, homeDir ?? "");
                if (!path) {
                  insert(text);
                  return;
                }
                void stageImage(path, insert, epoch).catch((error: unknown) => {
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
                if (
                  fileActionsRef.current ||
                  mcpPanel.getSnapshot() ||
                  viewRef.current !== "chat" ||
                  rewindRef.current ||
                  previewRef.current
                )
                  return;
                if (!pending || (pending.kind === "question" && pending.collapsed))
                  change(value, edit);
              }}
              onSubmit={(prompt) => {
                const pending = sideController.current ? undefined : interactions.getSnapshot();
                if (
                  fileActionsRef.current ||
                  mcpPanel.getSnapshot() ||
                  viewRef.current !== "chat" ||
                  rewindRef.current ||
                  previewRef.current
                )
                  return;
                if (pending && (pending.kind !== "question" || !pending.collapsed)) return;
                sendInput(prompt);
              }}
            />
            <StatusLine
              jobs={Object.values(state.jobs)}
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
      {fileActions && (
        <FileActionsPanel
          {...fileActions}
          columns={columns}
          rows={rows}
          locale={locale}
          onPick={(index) => void pickFileAction(index)}
        />
      )}
    </Box>
  );
}
