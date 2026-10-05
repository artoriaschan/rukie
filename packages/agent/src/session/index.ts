import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentOptions,
  type AgentTool,
  type AfterToolCallResult,
  type StreamFn,
  type Skill,
} from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import {
  branchTip,
  insertEntry,
  setValue,
  type Entry,
  type Session as StoredSession,
} from "@earendil-works/pi-agent-core/harness/session";
import type { Api, Model } from "@earendil-works/pi-ai";
import { resolve } from "node:path";
import { createUserVisibleError } from "@neant/shared";
import type {
  CustomSessionEvent,
  PermissionMode,
  RunResult,
  SessionEvent as SharedSessionEvent,
  Settings,
  HooksSettings,
  ContextReport,
} from "@neant/shared";
import {
  createSubagents,
  discoverSubagentTypes,
  SUBAGENT_PROMPT,
  subagentsState,
  subagentRunState,
  type SubagentRun,
  type SubagentIdentity,
} from "../subagents/index.ts";
import { isTrustedProject, resolveModel, modelState } from "../config/index.ts";
import { createJsonlStore, registerSessionReader, type SessionStore } from "../store/index.ts";
import {
  reconcileSubagents,
  recoverySummary,
  type SessionRecovery,
} from "../session-resume/index.ts";
import { repairUnknownToolOutcomes } from "../unknown-tool-outcomes/index.ts";
export type { SessionRecovery } from "../session-resume/index.ts";
import {
  createPermissionGate,
  parsePermissionRules,
  type PermissionAskRequest,
  type SessionAllowRule,
} from "../permissions/index.ts";
import {
  createBuiltinTools,
  createEnterPlanModeTool,
  createExitPlanModeTool,
  type QuestionRequest,
  type QuestionReply,
  type OnPlanReview,
} from "../tools/index.ts";
import { createFileTracking } from "../file-tracking/index.ts";
import { SYSTEM_PROMPT } from "../prompt/index.ts";
import {
  collectReminders,
  collectSourceReminders,
  convertToLlm,
  type ReminderSource,
} from "../reminders/index.ts";
import { discoverSkills, skillInvocation, skillsReminder } from "../skills/index.ts";
import { createMcpConnections } from "../mcp/index.ts";
import { compactTurn, estimateContextTokens, restoreContext } from "../compaction/index.ts";
import { createSessionTitle, titleSourceState, type TitleSource } from "../session-title/index.ts";
import { sideQuestion } from "../side-question/index.ts";
import { contextUsage, contextReport } from "../context-usage/index.ts";
import { createToolState, todoState, type TodoItem } from "../tool-state/index.ts";
import {
  createCheckpoints,
  checkpointState,
  cleanupExpiredBackups,
  type Checkpoint,
  type RewindResult,
} from "../checkpoint/index.ts";

import { planState, planModeReminder, PLAN_MODE_EXIT } from "../plan-mode/index.ts";
import {
  createGoalController,
  createGoalTools,
  goalState,
  renderGoalRoundPrompt,
  type GoalView,
} from "../goal/index.ts";
import type { OnInteractionStart } from "../interaction/index.ts";
import { createHooks, mergeHooks, type CommonHookResult, type HookInput } from "../hooks/index.ts";

export type { PermissionAskRequest, SessionAllowRule } from "../permissions/index.ts";
import type { OnToolCallAllowed } from "../permissions/index.ts";

import type { WebFetchOptions } from "../web-fetch/index.ts";

export interface SessionOptions {
  /** Test-only network boundary overrides; production frontends leave this unset. */
  webFetch?: WebFetchOptions;
  /** Project directory the session works in. */
  cwd: string;
  /** User home; `~/.neant` lives under it. Injectable for tests. */
  homeDir: string;
  /** Merged settings, see `loadSettings`. */
  settings?: Settings;
  /** Model call; defaults to pi-ai's `streamSimple` for the resolved model. Tests inject a fake. */
  streamFn?: StreamFn;
  /** Skips resolving `settings.model`; requires `streamFn`. Tests pair it with a fake one. */
  model?: Model<Api>;
  /** Defaults to the headless JSONL repo; injectable for other frontends/backends. */
  store?: SessionStore;
  /** Continue an existing Session in this project; never silently creates a new one. */
  resumeId?: string;
  /** Session allow rules in settings syntax, supplied by --allow-tools. */
  allowRules?: string[];
  /** Optional shared memory collection; never loaded from or written to Transcript. */
  sessionAllowRules?: SessionAllowRule[];
  /** Session permission policy; defaults to ask. */
  permissionMode?: PermissionMode;
  /** Decide tool calls requiring permission; defaults to deny. */
  onPermissionAsk?: (request: PermissionAskRequest) => Promise<"allow" | "deny" | "allow-session">;
  /** @internal Observe final allowed input without rewriting it or changing the decision. */
  onToolCallAllowed?: OnToolCallAllowed;
  /** Ask structured questions; the tool is absent when this callback is omitted. */
  onQuestion?: (request: QuestionRequest) => Promise<QuestionReply>;
  /** Review markdown plans; plan tools are absent when this callback is omitted. */
  onPlanReview?: OnPlanReview;
  /** Load this project's .mcp.json even when it is not in the user trust list. */
  trustProjectMcp?: boolean;
  /** Clock used for reminder dates and backup retention; defaults to the local current date. */
  now?: () => Date;
  /** Additional content sources, compared with the latest persisted reminder per source. */
  reminderSources?: ReminderSource[];
  /** Startup and discovery diagnostics; defaults to stderr via console.warn. */
  onWarning?: (warning: string) => void;
}

export type SessionEvent = SharedSessionEvent<AgentEvent>;

function promptText(message: Extract<AgentMessage, { role: "user" }>): string {
  return typeof message.content === "string"
    ? message.content
    : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

/** Project the same Transcript branch for startup/resume and in-place Rewind. */
function projectBranch(entries: Entry[]) {
  const transcriptMessages = entries.flatMap((entry) =>
    entry.type === "message" ? [entry.message] : [],
  );
  return {
    messages: restoreContext(entries),
    transcriptMessages,
    reminderStart: entries
      .slice(0, entries.findLastIndex((entry) => entry.type === "compaction") + 1)
      .filter((entry) => entry.type === "message").length,
    baselinePersisted: transcriptMessages.length > 0,
    promptTexts: new Map(
      entries.flatMap((entry) =>
        entry.type === "message" && entry.message.role === "user" && !("source" in entry.message)
          ? [[entry.id, promptText(entry.message)] as const]
          : [],
      ),
    ),
  };
}

export interface Session {
  /** Historical child Runs requiring attention on this Session Resume. No Run is started. */
  readonly recovery: SessionRecovery;
  /** Includes internal Hook and Goal Runs. */
  readonly running: boolean;
  /** Cancels the current run, including one started without a frontend controller. */
  interruptRun(): void;
  /** Queue another user instruction for the current Run, including Skill Invocation. */
  steer(prompt: string): void;
  /** Observe all runs; the first subscriber also receives events from startup autoruns. */
  subscribe(onEvent: (event: SessionEvent) => void): () => void;
  readonly id: string;
  readonly title: string;
  readonly titleSource: TitleSource | undefined;
  rename(title: string): Promise<void>;
  /** Current model identity, including a restored session selection. */
  readonly model: string;
  /** Persist a model selection for subsequent requests; requires idle state. */
  setModel(spec: string): Promise<void>;
  readonly permissionMode: PermissionMode;
  readonly planMode: boolean;
  /** Persisted Goal plus process-local activation; restored Sessions are always disarmed. */
  readonly goal: GoalView | undefined;
  /** Idle only. Creates and arms a Goal, immediately starting its first internal Run. */
  createGoal(objective: string, options?: { maxRounds?: number }): Promise<GoalView>;
  /** Idle only. Preserves rounds and activation; a complete Goal is replaced with a new one. */
  editGoal(objective: string): Promise<GoalView>;
  /** Run-safe. Stops continuation without interrupting the current Run. */
  pauseGoal(): Promise<GoalView>;
  /** Idle only. Arms a restored, paused or blocked Goal and starts the next round. */
  resumeGoal(): Promise<GoalView>;
  /** Run-safe. Persists a tombstone without interrupting the current Run. */
  clearGoal(): Promise<void>;
  /** Changes guidance for the next model call and persists the state, also outside a Run. */
  setPlanMode(on: boolean): Promise<void>;
  /** Applies to the next tool call; never persisted. */
  setPermissionMode(mode: PermissionMode): void;
  /** Snapshot the restored context; usable while idle or running. */
  contextReport(): ContextReport;
  /** Compress completed history while idle; focus only applies to this summary. */
  compact(options?: { instructions?: string }): Promise<void>;
  /** Answer once from current context without changing this Session or its Run. */
  sideQuestion(question: string, options?: { signal?: AbortSignal }): AsyncIterable<string>;
  /** Current restored context in memory, including reminders and any compaction. */
  readonly messages: readonly AgentMessage[];
  /** Current Tool State snapshot; undefined before the first write. */
  toolState(name: string): unknown;
  /** Prompt anchors and their file records, in chronological order. */
  checkpoints(): Checkpoint[];
  /** Restores files and/or the branch before a prompt while idle. */
  rewind(
    promptEntryId: string,
    options: { code: boolean; conversation: boolean },
  ): Promise<RewindResult>;
  /** Interrupt a child Run; missing and idle children are a no-op. */
  interruptSubagent(id: string): void;
  /** Ends the Session once, cancelling its Run and releasing external resources. */
  dispose(reason?: "exit" | "other"): Promise<void>;
  /** External completion boundary, including Hook autoruns; never await from a Run callback. */
  waitForIdle(): Promise<void>;
  /** Waits behind an internal Hook or Goal Run; a competing user Run is rejected. */
  run(
    prompt: string,
    options?: {
      signal?: AbortSignal;
      /** Ordered Run events; result follows storage close. Also receives disposal diagnostics without awaiting observers. */
      onEvent?: (event: SessionEvent) => void | Promise<void>;
    },
  ): Promise<RunResult>;
}

export async function createSession(options: SessionOptions): Promise<Session> {
  const session = await createSessionInternal(options);
  await cleanupExpiredBackups({
    homeDir: options.homeDir,
    sessionId: session.id,
    now: options.now?.() ?? new Date(),
    onWarning: options.onWarning ?? console.warn,
  });
  return session;
}

interface InternalSessionOptions {
  sessionSource?: "fork";
  parentSessionId?: string;
  onSubagentRunStarted?: (run: SubagentRun) => Promise<void>;
  originDescription?: string;
  agentType?: string;
  permissions?: {
    rules: ReturnType<typeof parsePermissionRules>;
    sessionAllowRules: SessionAllowRule[];
    sessionGrantListeners: Set<() => void>;
    onToolCallAllowed?: OnToolCallAllowed;
    getMode(): PermissionMode;
    setMode(mode: PermissionMode): void;
  };
  plan?: { getActive(): boolean; hasEntered(): boolean; setMode(on: boolean): Promise<void> };
  toolNames?: readonly string[];
  typePrompt?: string;
  typeHooks?: HooksSettings;
  initialMessages?: AgentMessage[];
  systemPrompt?: string;
  control?: { steer?: (message: AgentMessage) => void };
  /** Parent-owned recorder; children never open their own Checkpoint. */
  checkpoint?: ReturnType<typeof createCheckpoints>;
}

async function createSessionInternal(
  options: SessionOptions,
  internal: InternalSessionOptions = {},
): Promise<Session> {
  const settings = options.settings ?? {};
  const hookSettings = mergeHooks(settings.hooks, internal.typeHooks);
  const rules = internal.permissions?.rules ?? [
    ...parsePermissionRules(settings.permissions),
    ...parsePermissionRules({ allow: options.allowRules }, "--allow-tools"),
  ];
  let permissionMode = options.permissionMode ?? settings.permissionMode ?? "ask";
  const permissionConfiguration = internal.permissions ?? {
    rules,
    sessionAllowRules: options.sessionAllowRules ?? [],
    sessionGrantListeners: new Set<() => void>(),
    onToolCallAllowed: options.onToolCallAllowed,
    getMode: () => permissionMode,
    setMode: (mode: PermissionMode) => {
      permissionMode = mode;
    },
  };
  if (options.model && !options.streamFn) throw new Error("`model` requires `streamFn`.");
  const cwd = resolve(options.cwd);
  const store = options.store ?? createJsonlStore({ cwd, homeDir: options.homeDir });
  // Storage must finish even when the Run's signal is aborted.
  const context = BACKGROUND_CONTEXT;
  const metadata =
    options.resumeId !== undefined
      ? store.find
        ? await store.find(options.resumeId, { cwd }, context)
        : (await store.list({ cwd }, context)).find((item) => item.id === options.resumeId)
      : undefined;
  if (
    options.resumeId !== undefined &&
    (!metadata ||
      (metadata.parentSessionId && internal.parentSessionId !== metadata.parentSessionId))
  ) {
    throw createUserVisibleError(`Session not found: ${options.resumeId}`, {
      code: "session-not-found",
      params: { id: options.resumeId },
    });
  }
  const stored = metadata
    ? await store.open(metadata, context)
    : await store.create(
        { cwd, ...(internal.parentSessionId && { parentSessionId: internal.parentSessionId }) },
        context,
      );
  let entries;
  let initialTitle: string | undefined;
  try {
    const branch =
      (await stored.branch("main", context)) ?? (await stored.createBranch("main", null, context));
    // Fork preserves completed conversation, but a parent's Goal guidance is not
    // child guidance: children have no Goal state or continuation driver.
    for (const message of (internal.initialMessages ?? []).filter(
      (message) =>
        !(
          internal.parentSessionId &&
          message.role === "system-reminder" &&
          message.source === "goal"
        ),
    ))
      await branch.appendMessage(message, context);
    initialTitle = await stored.getName(context);
    entries = await branch.findEntries({ order: "oldestFirst" }, context);
    if (metadata) {
      entries = await repairUnknownToolOutcomes(branch, entries, context);
    }
  } finally {
    await stored.close(context);
  }
  const initialBranch = projectBranch(entries);
  const sessionObservers = new Set<(event: SessionEvent) => void>();
  const startupEvents: SessionEvent[] = [];
  let bufferingStartup = true;
  const broadcast = (event: SessionEvent) => {
    if (bufferingStartup) startupEvents.push(event);
    for (const observer of sessionObservers) observer(event);
  };
  let emitRunEvent: ((event: CustomSessionEvent<AgentEvent>) => void | Promise<void>) | undefined;
  const toolState = createToolState(
    [
      todoState,
      ...(internal.parentSessionId ? [] : [goalState]),
      subagentsState(stored.metadata.id),
      subagentRunState,
      planState,
      checkpointState,
      titleSourceState,
      modelState,
    ],
    entries,
    options.onWarning ?? console.warn,
  );
  let recovery =
    metadata && !internal.parentSessionId
      ? await reconcileSubagents(
          toolState.get("subagents") as SubagentIdentity[] | undefined,
          store,
          cwd,
          stored.metadata.id,
        )
      : { subagents: [] };
  let recoveryPending = recovery.subagents.length > 0;
  const restoredModel = toolState.get("model");
  let { model, streamFn } =
    typeof restoredModel === "string"
      ? await resolveModel({ ...settings, model: restoredModel }, options.homeDir)
      : options.model
        ? { model: options.model, streamFn: options.streamFn! }
        : await resolveModel(settings, options.homeDir);
  let planActive = (toolState.get("plan") as { active: boolean } | undefined)?.active ?? false;
  let planEntered = toolState.get("plan") !== undefined;
  let planWrites = Promise.resolve();
  let planRevision = 0;
  const pendingPlanEvents: CustomSessionEvent<AgentEvent>[] = [];
  const plan = internal.plan ?? {
    getActive: () => planActive,
    hasEntered: () => planEntered,
    setMode(on: boolean): Promise<void> {
      if (planActive === on) return planWrites;
      planActive = on;
      planEntered = true;
      const revision = ++planRevision;
      const write = planWrites.then(async () => {
        return withStore(async (target) => {
          if (!baselinePersisted) {
            const branch = await target.branch("main", context);
            if (!branch) throw new Error("Session has no main branch.");
            await branch.appendMessage(agent.state.messages[0]!, context);
            baselinePersisted = true;
          }
          return await toolState.set("plan", { active: on }, target, context);
        });
      });
      // Keep frontend callbacks outside the write queue so a callback may
      // await another state change without waiting on its own notification.
      const persisted = write.catch((error: unknown) => {
        if (revision === planRevision) {
          const snapshot = toolState.get("plan") as { active: boolean } | undefined;
          planActive = snapshot?.active ?? false;
          planEntered = snapshot !== undefined;
        }
        throw error;
      });
      planWrites = persisted.then(
        () => {},
        () => {},
      );
      return persisted.then(async (value) => {
        const event: CustomSessionEvent<AgentEvent> = {
          type: "tool_state_changed",
          name: "plan",
          value,
        };
        if (emitRunEvent) await emitRunEvent(event);
        else pendingPlanEvents.push(event);
      });
    },
  };
  let activeStore: StoredSession | undefined;
  let storeOperations = Promise.resolve();
  function serializeStore<T>(work: () => Promise<T>): Promise<T> {
    const operation = storeOperations.then(work);
    storeOperations = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
  function withStore<T>(work: (target: StoredSession) => Promise<T>): Promise<T> {
    return serializeStore(async () => {
      const current = activeStore;
      const target = current ?? (await store.open(stored.metadata, context));
      try {
        return await work(target);
      } finally {
        if (!current) await target.close(context);
      }
    });
  }
  const openActiveStore = () =>
    serializeStore(async () => {
      const target = await store.open(stored.metadata, context);
      activeStore = target;
      return target;
    });
  const closeActiveStore = (target?: StoredSession) =>
    serializeStore(async () => {
      activeStore = undefined;
      await target?.close(context);
    });
  const unregisterReader = registerSessionReader(store, stored.metadata.id, withStore);
  const promptTexts = initialBranch.promptTexts;
  const checkpoint =
    internal.checkpoint ??
    (internal.parentSessionId
      ? undefined
      : createCheckpoints({
          homeDir: options.homeDir,
          sessionId: stored.metadata.id,
          getState: () => toolState.get("checkpoint"),
          getPrompt: (id) => promptTexts.get(id),
          async persist(state) {
            if (!activeStore) throw new Error("Checkpoint writes require an active Run.");
            const value = await toolState.set("checkpoint", state, activeStore, context);
            await emitRunEvent?.({ type: "tool_state_changed", name: "checkpoint", value });
          },
        }));
  const setTodo = async (todos: TodoItem[]) => {
    if (!activeStore) throw new Error("Tool State writes require an active Run.");
    const value = await toolState.set("todo", todos, activeStore, context);
    await emitRunEvent?.({ type: "tool_state_changed", name: "todo", value });
  };
  const transcriptMessages = initialBranch.transcriptMessages;
  let reminderStart = initialBranch.reminderStart;
  // Older Sessions did not persist their implicit baseline. Do not append it
  // behind existing conversation messages; pi will seed it when restoring them.
  let baselinePersisted = initialBranch.baselinePersisted;
  let skills = new Map<string, Skill>();
  let mcpToolServers = new Map<string, string>();
  const origin =
    internal.originDescription === undefined
      ? undefined
      : { agentId: stored.metadata.id, description: internal.originDescription };
  const onQuestion = options.onQuestion
    ? (request: QuestionRequest) => options.onQuestion!({ ...request, ...(origin && { origin }) })
    : undefined;
  const hookInput = (): HookInput => ({
    session_id: stored.metadata.id,
    transcript_path:
      "path" in stored.metadata && typeof stored.metadata.path === "string"
        ? stored.metadata.path
        : "",
    cwd,
    permission_mode: permissionConfiguration.getMode(),
    ...(internal.parentSessionId && {
      agent_id: stored.metadata.id,
      agent_type: internal.agentType,
    }),
  });
  const pendingHookEvents: CustomSessionEvent<AgentEvent>[] = [];
  const pendingAsyncContexts: string[] = [];
  const pendingRewakes: string[] = [];
  const rewakeSteering = new Map<AgentMessage, string>();
  let rewakeChanged = Promise.withResolvers<void>();
  let scheduleRewake: (() => void) | undefined;
  let emitSessionEndEvent: typeof emitRunEvent;
  const hooks = createHooks({
    settings: hookSettings,
    cwd,
    homeDir: options.homeDir,
    projectDir: cwd,
    model: {
      getModel: async (selected) => {
        const choice = selected ?? settings.reviewModel;
        return choice
          ? (await resolveModel({ ...settings, model: choice }, options.homeDir)).model
          : model;
      },
      streamFn: options.streamFn ?? streamFn,
    },
    callMcpTool: async (server, tool, input, signal) => {
      if (!runMcp)
        throw createUserVisibleError(`Hook MCP server is not connected: ${server}`, {
          code: "hook-mcp-unconnected",
          params: { server },
        });
      return runMcp.callHookTool(server, tool, input, signal);
    },
    onWarning: options.onWarning ?? console.warn,
    onAsyncResult: (result, reason) => {
      pendingAsyncContexts.push(...result.additionalContext, ...result.systemMessages);
      if (reason !== undefined) pendingRewakes.push(reason);
      scheduleRewake?.();
    },
    onEvent: (event) => {
      if (event.type === "hook_warning" && event.event === "SessionEnd" && emitSessionEndEvent)
        return emitSessionEndEvent(event);
      if (emitRunEvent) return emitRunEvent(event);
      if (emitSessionEndEvent) return emitSessionEndEvent(event);
      pendingHookEvents.push(event);
    },
  });
  const toolDurations = new Map<string, number>();
  const measureTool = (tool: AgentTool): AgentTool => ({
    ...tool,
    async execute(id, ...args) {
      const started = performance.now();
      try {
        return await tool.execute(id, ...args);
      } finally {
        toolDurations.set(id, performance.now() - started);
      }
    },
  });
  const onInteractionStart: OnInteractionStart = (notification, signal) =>
    hooks
      .run(
        "Notification",
        { ...hookInput(), ...notification },
        {
          signal,
          matchQuery: notification.notification_type,
        },
      )
      .then(() => {});
  const toolHookContexts = new Map<string, string[]>();
  const hookDenials = new Map<string, { hook?: string; reason?: string }>();
  let hookStopped = false;
  let hookStopReason: string | undefined;
  const applyHookControl = (result: CommonHookResult) => {
    if (result.continue === false) {
      hookStopped = true;
      hookStopReason = result.stopReason;
    }
  };
  const consumeToolHookOutput = (
    id: string,
    result: Parameters<NonNullable<AgentOptions["afterToolCall"]>>[0]["result"],
  ): AfterToolCallResult | undefined => {
    const contexts = toolHookContexts.get(id) ?? [];
    toolHookContexts.delete(id);
    const denial = hookDenials.get(id);
    hookDenials.delete(id);
    if (!contexts.length && !denial && !hookStopped) return;
    return {
      ...(contexts.length && {
        content: [
          ...result.content,
          ...contexts.map((content) => ({
            type: "text" as const,
            text: `<system-reminder>\n${content}\n</system-reminder>`,
          })),
        ],
      }),
      ...(denial && {
        details: {
          ...(typeof result.details === "object" && result.details),
          permissionDenied: { by: "hook", ...denial },
        },
      }),
      ...(hookStopped && { terminate: true }),
    };
  };
  const permissions = createPermissionGate({
    onInteractionStart,
    cwd,
    homeDir: options.homeDir,
    rules,
    sessionAllowRules: permissionConfiguration.sessionAllowRules,
    sessionGrantListeners: permissionConfiguration.sessionGrantListeners,
    async onToolCallAllowed(call) {
      await permissionConfiguration.onToolCallAllowed?.(structuredClone(call));
      await checkpoint?.record(call, cwd, options.homeDir);
    },
    getMode: permissionConfiguration.getMode,
    setMode: permissionConfiguration.setMode,
    getAgentState: () => agent.state,
    getProjectInstructions: () =>
      transcriptMessages.flatMap((message) =>
        message.role === "system-reminder" &&
        ["project-instructions", "user-instructions"].includes(message.source)
          ? [message.content]
          : [],
      ),
    getReviewModel: () =>
      settings.reviewModel
        ? async () =>
            (await resolveModel({ ...settings, model: settings.reviewModel }, options.homeDir))
              .model
        : model,
    streamFn: options.streamFn ?? streamFn,
    onPermissionAsk: options.onPermissionAsk
      ? (request) => options.onPermissionAsk!({ ...request, ...(origin && { origin }) })
      : undefined,
    onEvent: (event) => {
      if (event.type === "permission_denied" && event.by === "hook")
        hookDenials.set(event.toolCallId, { hook: event.hook, reason: event.reason });
      return emitRunEvent?.(event);
    },
    ...(hookSettings.PreToolUse?.length && {
      preToolUse: async (call, signal) => {
        if (hookStopped)
          return {
            continue: false as const,
            stopReason: hookStopReason,
            systemMessages: [],
            additionalContext: [],
          };
        const result = await hooks.run(
          "PreToolUse",
          {
            ...hookInput(),
            tool_name: call.toolCall.name,
            tool_input: call.args,
            tool_use_id: call.toolCall.id,
          },
          { signal, matchQuery: call.toolCall.name },
        );
        toolHookContexts.set(call.toolCall.id, result.additionalContext);
        applyHookControl(result);
        return result;
      },
    }),
    onHookWarning: async (field, hook = "PermissionRequest") => {
      const message = `Ignoring invalid or unsupported hook output field: ${field}`;
      (options.onWarning ?? console.warn)(`PermissionRequest hook ${hook}: ${message}`);
      await emitRunEvent?.({
        type: "hook_warning",
        event: "PermissionRequest",
        hook,
        message,
        error: { code: "hook-output-ignored", params: { field } },
      });
    },
    permissionRequest: async (call, suggestions, signal) => {
      const result = await hooks.run(
        "PermissionRequest",
        {
          ...hookInput(),
          tool_name: call.toolCall.name,
          tool_input: call.args,
          permission_suggestions: suggestions,
        },
        { signal, matchQuery: call.toolCall.name },
      );
      toolHookContexts.set(call.toolCall.id, [
        ...(toolHookContexts.get(call.toolCall.id) ?? []),
        ...result.additionalContext,
      ]);
      applyHookControl(result);
      return result;
    },
    permissionDenied: async (call, denial, signal) => {
      const result = await hooks.run(
        "PermissionDenied",
        {
          ...hookInput(),
          tool_name: call.toolCall.name,
          tool_input: call.args,
          tool_use_id: call.toolCall.id,
          by: denial.by,
          reason: denial.reason,
          ...(denial.rule && { rule: denial.rule }),
        },
        { signal, matchQuery: call.toolCall.name },
      );
      toolHookContexts.set(call.toolCall.id, [
        ...(toolHookContexts.get(call.toolCall.id) ?? []),
        ...result.additionalContext,
        ...(result.retry
          ? ["Permission review denied this call. You may adjust the tool input and retry."]
          : []),
      ]);
      applyHookControl(result);
      return result;
    },
    isRunStopped: () => hookStopped,
    stopRun(reason) {
      applyHookControl({
        continue: false,
        stopReason: reason,
        systemMessages: [],
        additionalContext: [],
      });
    },
  });
  const childSessions = new Set<Session>();
  let currentResult: RunResult | undefined;
  let completedMessages = initialBranch.messages;
  const subagents = createSubagents({
    restored: toolState.get("subagents") as SubagentIdentity[] | undefined,
    warn: options.onWarning ?? console.warn,
    async persist(identities) {
      if (!activeStore) throw new Error("Tool State writes require an active Run.");
      const value = await toolState.set("subagents", identities, activeStore, context);
      await emitRunEvent?.({ type: "tool_state_changed", name: "subagents", value });
    },
    async createChild(type, description, fork = false, resumeId, onSubagentRunStarted) {
      const selected = fork ? undefined : (type.model ?? settings.subagentModel);
      const childModel =
        selected === undefined
          ? model
          : (await resolveModel({ ...settings, model: selected }, options.homeDir)).model;
      const control: NonNullable<InternalSessionOptions["control"]> = {};
      const session = await createSessionInternal(
        {
          ...options,
          resumeId,
          store,
          model: childModel,
          streamFn: options.streamFn ?? streamFn,
        },
        {
          control,
          parentSessionId: stored.metadata.id,
          onSubagentRunStarted,
          originDescription: description,
          agentType: type.name,
          permissions: permissionConfiguration,
          plan,
          checkpoint,
          toolNames:
            type.tools ??
            agent.state.tools
              .filter(
                (tool) =>
                  !["subagent", "subagent_fork", "send_message", "list_agents"].includes(tool.name),
              )
              .map((tool) => tool.name),
          typePrompt: type.prompt,
          typeHooks: type.hooks,
          ...(fork && {
            ...(!resumeId && { sessionSource: "fork" as const }),
            ...(!resumeId && { initialMessages: structuredClone(completedMessages) }),
            systemPrompt: agent.state.systemPrompt,
          }),
        },
      );
      childSessions.add(session);
      if (disposePromise) await session.dispose();
      return { session, steer: (message) => control.steer!(message) };
    },
    steer: (message) => agent.steer(message),
    emit: (event) => emitRunEvent?.(event),
    addUsage(usage) {
      if (currentResult)
        for (const key of Object.keys(usage) as (keyof typeof usage)[])
          currentResult.usage[key] += usage[key];
    },
  });
  const planTools =
    options.onPlanReview && !internal.parentSessionId
      ? [
          createEnterPlanModeTool(plan),
          createExitPlanModeTool(plan, options.onPlanReview, onInteractionStart),
        ]
      : [];
  let runDirectHuman = false;
  let runGoalRound = false;
  const goalTools = internal.parentSessionId
    ? []
    : createGoalTools(
        // Construction declares tools before Agent/controller initialization; execution occurs after both exist.
        {
          view: () => goal.view(),
          create: (...args) => goal.create(...args),
          edit: (...args) => goal.edit(...args),
          pause: () => goal.pause(),
          resume: (...args) => goal.resume(...args),
          finish: (...args) => goal.finish(...args),
        },
        {
          directHuman: () => runDirectHuman,
          goalRound: () => runGoalRound,
          wrapup(text) {
            const message = {
              role: "user" as const,
              content: [{ type: "text" as const, text }],
              timestamp: Date.now(),
              source: "goal",
            };
            agent.steer(message);
          },
        },
      );
  const fileTracking = createFileTracking(cwd);
  const initialTools = [
    ...createBuiltinTools(
      cwd,
      (name) => skills.get(name),
      setTodo,
      onQuestion,
      options.homeDir,
      onInteractionStart,
      options.webFetch,
      fileTracking,
    ),
    ...planTools,
    ...goalTools,
  ];
  if (!internal.parentSessionId) {
    const discovered = await discoverSubagentTypes(
      cwd,
      options.homeDir,
      initialTools.map((tool) => tool.name),
      { trusted: isTrustedProject(cwd, settings) },
    );
    // Seed pi's initial declaration; Run discovery owns diagnostics and later changes.
    subagents.setTypes(discovered.types);
  }
  let planTakenOver = false;
  const agent = new Agent({
    streamFn: (selected, request, requestOptions) =>
      (options.streamFn ?? streamFn)(selected, request, requestOptions),
    convertToLlm,
    beforeToolCall: permissions.beforeToolCall,
    async afterToolCall({ toolCall, args, result, isError }, signal) {
      const duration = toolDurations.get(toolCall.id) ?? 0;
      toolDurations.delete(toolCall.id);
      const output = await hooks.run(
        isError ? "PostToolUseFailure" : "PostToolUse",
        {
          ...hookInput(),
          tool_name: toolCall.name,
          tool_input: args,
          tool_use_id: toolCall.id,
          duration_ms: duration,
          ...(isError
            ? {
                error: result.content
                  .filter((item) => item.type === "text")
                  .map((item) => item.text)
                  .join("\n"),
                is_interrupt: signal?.aborted ?? false,
              }
            : { tool_response: { content: result.content, details: result.details } }),
        },
        {
          // An interrupted execution still needs its failure hook. Shutdown remains
          // cancellable through the hook runner's Session lifetime signal.
          signal: isError && signal?.aborted ? undefined : signal,
          matchQuery: toolCall.name,
        },
      );
      applyHookControl(output);
      const contexts = [...(toolHookContexts.get(toolCall.id) ?? []), ...output.additionalContext];
      if ("reason" in output && output.reason) contexts.push(output.reason);
      toolHookContexts.set(toolCall.id, contexts);
      const content = "updatedToolOutput" in output ? output.updatedToolOutput : undefined;
      const decorated = consumeToolHookOutput(toolCall.id, {
        ...result,
        ...(content && { content }),
      });
      return { ...(content && { content }), ...decorated };
    },
    finishTurn({ toolResults }) {
      if (hookStopped) return { action: "end" };
      // pi 0.99.2 stops on terminate only when every result in the batch opts in.
      // A takeover ends the Run after all sibling tools have emitted their results.
      if (
        toolResults.some(
          (result) =>
            result.toolName === "exit_plan_mode" &&
            typeof result.details === "object" &&
            result.details !== null &&
            "kind" in result.details &&
            result.details.kind === "takeover",
        )
      ) {
        planTakenOver = true;
        return { action: "end" };
      }
    },
    initialState: {
      model,
      messages: initialBranch.messages,
      systemPrompt:
        internal.systemPrompt ??
        (internal.parentSessionId
          ? `${SYSTEM_PROMPT}\n\n${SUBAGENT_PROMPT}${internal.typePrompt ? `\n\n${internal.typePrompt}` : ""}`
          : SYSTEM_PROMPT),
      tools: [
        ...initialTools,
        ...(internal.parentSessionId
          ? []
          : [subagents.tool, subagents.forkTool, subagents.sendTool, subagents.listTool]),
      ]
        .filter((tool) => !internal.toolNames || internal.toolNames.includes(tool.name))
        .map(measureTool),
      ...(settings.thinking && { thinkingLevel: settings.thinking }),
    },
  });
  const sessionTitle = createSessionTitle({
    title: initialTitle,
    source: toolState.get("title-source") as TitleSource | undefined,
    hasPrompt: initialBranch.promptTexts.size > 0,
    childDescription: internal.originDescription,
    getModel: async () =>
      settings.titleModel
        ? (await resolveModel({ ...settings, model: settings.titleModel }, options.homeDir)).model
        : agent.state.model,
    streamFn: (...args) => (options.streamFn ?? streamFn)(...args),
    persist: (title, source) =>
      withStore(async (target) => {
        await target.setName(title, context);
        await toolState.set("title-source", source, target, context);
      }),
    changed: (title, source) =>
      broadcast({ type: "session_title_changed", title, source, sessionId: stored.metadata.id }),
    warning: options.onWarning ?? console.warn,
  });
  await sessionTitle.initializeChild();
  if (internal.control) internal.control.steer = (message) => agent.steer(message);
  let running = false;
  let rewinding = false;
  let changingModel = false;
  let compacting = false;
  let compactSettled: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let hookRunActive = false;
  let runSettled: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let queuedUserRuns = 0;
  let runController: AbortController | undefined;
  const sidePendingCalls = new Set<string>();
  const sideLifetime = new AbortController();
  let runMcp: ReturnType<typeof createMcpConnections> | undefined;
  let disposePromise: Promise<void> | undefined;
  const goal = createGoalController({
    getSnapshot: () => toolState.get("goal"),
    assertAvailable(idle) {
      if (internal.parentSessionId)
        throw createUserVisibleError("Goals are only available in top-level Sessions.", {
          code: "goal-child-session",
          params: {},
        });
      if (disposePromise) throw new Error("Session has been disposed.");
      if (rewinding || compacting || changingModel || (idle && (running || queuedUserRuns)))
        throw createUserVisibleError("Goal operation requires an idle Session.", {
          code: "goal-busy",
          params: {},
        });
    },
    async persist(snapshot) {
      await withStore(async (target) => {
        if (!baselinePersisted) {
          const branch = await target.branch("main", context);
          if (!branch) throw new Error("Session has no main branch.");
          await branch.appendMessage(agent.state.messages[0]!, context);
          baselinePersisted = true;
        }
        return toolState.set("goal", snapshot, target, context);
      });
    },
    async changed(value) {
      const event = { type: "tool_state_changed" as const, name: "goal", value };
      if (emitRunEvent) await emitRunEvent(event);
      else broadcast({ ...event, sessionId: stored.metadata.id });
    },
    warn() {
      if (permissionConfiguration.getMode() === "ask")
        (options.onWarning ?? console.warn)(
          "Goal continuation may wait for permissions in ask mode. Consider switching to auto-review.",
        );
    },
    schedule: () => scheduleRewake?.(),
  });
  let inputTokens: number | undefined;
  // Preserve context_usage's existing resume estimate while reports can display
  // the last stored provider count until an operation invalidates it.
  const lastResponse = initialBranch.messages.findLast((message) => message.role === "assistant");
  let reportInputTokens =
    lastResponse?.role === "assistant"
      ? lastResponse.usage.input + lastResponse.usage.cacheRead + lastResponse.usage.cacheWrite ||
        undefined
      : undefined;
  let sessionStartControl: CommonHookResult | undefined = await hooks.run(
    "SessionStart",
    {
      ...hookInput(),
      source: options.resumeId ? "resume" : (internal.sessionSource ?? "startup"),
      model: `${model.provider}/${model.id}`,
    },
    { matchQuery: options.resumeId ? "resume" : (internal.sessionSource ?? "startup") },
  );
  const pendingSessionContexts = [...sessionStartControl.additionalContext];
  let userMessageSequence = 0;
  let sessionContextUserSequence = 0;
  const consumeSessionContext = () =>
    pendingSessionContexts.splice(0).map((content) => ({
      role: "system-reminder" as const,
      source: "session-start-hook",
      content,
      timestamp: Date.now(),
    }));
  const planReminder: ReminderSource = {
    source: "plan-mode",
    currentContent: () => {
      if (plan.getActive())
        return planModeReminder(agent.state.tools.some((tool) => tool.name === "exit_plan_mode"));
      const previous = transcriptMessages.findLast(
        (message) => message.role === "system-reminder" && message.source === "plan-mode",
      );
      return plan.hasEntered() &&
        !(previous?.role === "system-reminder" && previous.content === PLAN_MODE_EXIT)
        ? PLAN_MODE_EXIT
        : undefined;
    },
  };
  const reminderSources: ReminderSource[] = [
    planReminder,
    fileTracking.reminderSource,
    { source: "skills", currentContent: () => skillsReminder(skills) },
    {
      source: "mcp",
      currentContent: () => {
        const previous = transcriptMessages.findLast(
          (message) => message.role === "system-reminder" && message.source === "mcp",
        );
        if (runMcp?.hasServers || previous) {
          if (runMcp) return runMcp.reminder();
          return previous?.role === "system-reminder" ? previous.content : undefined;
        }
        return undefined;
      },
    },
    ...(options.reminderSources ?? []),
    ...toolState.reminderSources,
  ];
  const compactContext = async ({
    target,
    messages,
    trigger,
    instructions,
    signal,
    emit,
    control,
    injectAsyncContexts,
  }: {
    target: StoredSession;
    messages: AgentMessage[];
    trigger: "auto" | "manual";
    instructions?: string;
    signal?: AbortSignal;
    emit: (event: CustomSessionEvent<AgentEvent>) => void | Promise<void>;
    control: (result: CommonHookResult) => void;
    injectAsyncContexts: (messages: AgentMessage[]) => Promise<AgentMessage[]>;
  }) => {
    const branch = await target.branch("main", context);
    if (!branch) throw new Error("Session has no main branch.");
    const compacted = await compactTurn({
      messages,
      entries: () => branch.findEntries({ order: "oldestFirst" }, context),
      model,
      streamFn: options.streamFn ?? streamFn,
      thinkingLevel: agent.state.thinkingLevel,
      signal,
      trigger,
      instructions,
      beforeCompact: async () => {
        const result = await hooks.run(
          "PreCompact",
          {
            ...hookInput(),
            trigger,
            custom_instructions: trigger === "manual" ? (instructions ?? "") : null,
          },
          { signal, matchQuery: trigger },
        );
        control(result);
        signal?.throwIfAborted();

        if (result.decision !== "block") return true;
        const reason = result.reason || "PreCompact hook blocked compaction.";
        if (trigger === "manual")
          throw createUserVisibleError(`Compaction blocked by PreCompact hook: ${reason}`, {
            code: "hook-compaction-blocked",
            params: { reason },
          });
        const message = `Compaction skipped by PreCompact hook: ${reason}`;
        (options.onWarning ?? console.warn)(message);
        await emit({
          type: "hook_warning",
          event: "PreCompact",
          hook: "PreCompact",
          message,
          error: { code: "hook-compaction-blocked", params: { reason } },
        });
        return false;
      },
      onStart: (tokensBefore) => emit({ type: "compaction_start", trigger, tokensBefore }),
    });
    if (!compacted) return false;
    await target.mutate(async (mutator) => {
      const tip = await mutator.getValue(branchTip("main"), context);
      if (!tip) throw new Error("Session has no main branch.");
      const id = target.idGenerator.next();
      await mutator.commit(
        [
          insertEntry({
            ...compacted,
            id,
            parentId: tip.value,
            type: "compaction",
            fromHook: false,
          }),
          setValue(branchTip("main"), id),
        ],
        context,
      );
    }, context);
    reminderStart = transcriptMessages.length;
    const reminders = await collectReminders({
      messages: [],
      cwd,
      homeDir: options.homeDir,
      now: (options.now ?? (() => new Date()))(),
      sources: reminderSources,
      includeEnvironment: false,
    });
    for (const reminder of reminders) {
      await branch.appendMessage(reminder, context);
      transcriptMessages.push(reminder);
      await emit({
        type: "reminder_injected",
        source: reminder.source,
        content: reminder.content,
      });
    }
    const restored = await injectAsyncContexts(
      restoreContext(await branch.findEntries({ order: "oldestFirst" }, context)),
    );
    agent.state.messages = restored;
    if (trigger === "manual") completedMessages = structuredClone(restored);
    inputTokens = undefined;
    reportInputTokens = undefined;
    await emit({
      type: "compaction_end",
      trigger,
      summary: compacted.summary,
      tokensBefore: compacted.tokensBefore,
      tokensAfter: estimateContextTokens(restored),
    });
    const postCompact = await hooks.run(
      "PostCompact",
      {
        ...hookInput(),
        trigger,
        compact_summary: compacted.summary,
        ...(trigger === "manual" && { custom_instructions: instructions ?? "" }),
      },
      { signal, matchQuery: trigger },
    );
    control(postCompact);
    signal?.throwIfAborted();

    const compactStart = await hooks.run(
      "SessionStart",
      { ...hookInput(), source: "compact", model: `${model.provider}/${model.id}` },
      { signal, matchQuery: "compact" },
    );
    control(compactStart);
    pendingSessionContexts.push(...compactStart.additionalContext);
    sessionContextUserSequence = userMessageSequence;
    signal?.throwIfAborted();

    return true;
  };
  let rewakeObserver: ((event: SessionEvent) => void | Promise<void>) | undefined;
  const session = {
    get running() {
      return running;
    },
    get recovery() {
      return structuredClone(recovery);
    },
    interruptRun() {
      runController?.abort();
    },
    steer(prompt) {
      if (disposePromise) throw new Error("Session has been disposed.");
      if (!running) throw new Error("Session is not running.");
      if (!prompt.trim()) return;
      const invocation = skillInvocation(prompt, skills);
      // pi drains one queued message at a time. Keep the instruction and its
      // expansion together without changing scheduling of child notifications.
      const message = {
        role: "user" as const,
        content: [{ type: "text" as const, text: prompt }],
        ...(invocation === undefined ? {} : { skillInvocation: invocation }),
        timestamp: Date.now(),
      };
      runDirectHuman = true;
      agent.steer(message);
    },
    subscribe(onEvent: (event: SessionEvent) => void) {
      if (disposePromise) throw new Error("Session has been disposed.");
      sessionObservers.add(onEvent);
      bufferingStartup = false;
      for (const event of startupEvents.splice(0)) onEvent(event);
      return () => {
        sessionObservers.delete(onEvent);
      };
    },
    id: stored.metadata.id,
    sideQuestion(question, { signal } = {}) {
      if (disposePromise) throw new Error("Session has been disposed.");
      if (!question.trim())
        throw createUserVisibleError("Side question cannot be empty.", {
          code: "side-question-empty",
          params: {},
        });
      return sideQuestion({
        question,
        messages: structuredClone(agent.state.messages),
        systemPrompt: agent.state.systemPrompt,
        model: agent.state.model,
        streamFn: options.streamFn ?? streamFn,
        signal: signal ? AbortSignal.any([signal, sideLifetime.signal]) : sideLifetime.signal,
        running: new Set(sidePendingCalls),
      });
    },
    get title() {
      return sessionTitle.title;
    },
    get titleSource() {
      return sessionTitle.source;
    },
    async rename(title: string) {
      if (disposePromise) throw new Error("Session has been disposed.");
      if (rewinding)
        throw createUserVisibleError("Session is rewinding.", {
          code: "session-rewinding",
          params: {},
        });
      await sessionTitle.rename(title);
    },
    get model() {
      return `${model.provider}/${model.id}`;
    },
    async setModel(spec) {
      if (disposePromise) throw new Error("Session has been disposed.");
      if (running || rewinding || changingModel || compacting)
        throw createUserVisibleError("Model switching requires an idle Session.", {
          code: "model-switch-busy",
          params: {},
        });
      changingModel = true;
      try {
        const selected = await resolveModel({ ...settings, model: spec }, options.homeDir);
        if (disposePromise) throw new Error("Session has been disposed.");
        await withStore((target) => toolState.set("model", spec, target, context));
        model = selected.model;
        streamFn = selected.streamFn;
        agent.state.model = model;
        inputTokens = undefined;
        reportInputTokens = undefined;
        broadcast({
          type: "tool_state_changed",
          name: "model",
          value: spec,
          sessionId: stored.metadata.id,
        });
      } finally {
        changingModel = false;
        scheduleRewake?.();
      }
    },
    get permissionMode() {
      return permissionConfiguration.getMode();
    },
    setPermissionMode(mode) {
      permissionConfiguration.setMode(mode);
    },
    get goal() {
      return internal.parentSessionId ? undefined : goal.view();
    },
    createGoal(objective, options) {
      return goal.create(objective, options);
    },
    editGoal(objective) {
      return goal.edit(objective);
    },
    pauseGoal: goal.pause,
    resumeGoal() {
      return goal.resume();
    },
    clearGoal: goal.clear,
    get planMode() {
      return plan.getActive();
    },
    async setPlanMode(on) {
      if (compacting)
        throw createUserVisibleError("Session is compacting.", {
          code: "session-compacting",
          params: {},
        });
      if (rewinding)
        throw createUserVisibleError("Session is rewinding.", {
          code: "session-rewinding",
          params: {},
        });
      return plan.setMode(on);
    },
    async compact({ instructions } = {}) {
      if (disposePromise) throw new Error("Session has been disposed.");
      if (running)
        throw createUserVisibleError("Session already has an active Run.", {
          code: "session-run-active",
          params: {},
        });
      if (rewinding)
        throw createUserVisibleError("Session is rewinding.", {
          code: "session-rewinding",
          params: {},
        });
      if (compacting)
        throw createUserVisibleError("Session is compacting.", {
          code: "session-compacting",
          params: {},
        });
      if (changingModel)
        throw createUserVisibleError("Session is switching models.", {
          code: "session-switching-models",
          params: {},
        });
      compacting = true;
      const settled = Promise.withResolvers<void>();
      compactSettled = settled;
      const controller = new AbortController();
      runController = controller;
      const emit = (event: CustomSessionEvent<AgentEvent>) =>
        broadcast({ ...event, sessionId: stored.metadata.id });
      emitRunEvent = emit;
      let target: StoredSession | undefined;
      try {
        await planWrites;
        controller.signal.throwIfAborted();
        const discovered = await discoverSkills(cwd, options.homeDir);
        skills = discovered.skills;
        for (const warning of discovered.warnings) (options.onWarning ?? console.warn)(warning);
        target = await openActiveStore();
        await compactContext({
          target,
          messages: agent.state.messages,
          trigger: "manual",
          instructions,
          signal: controller.signal,
          emit,
          control: (result) => {
            if (result.continue === false)
              throw result.stopReason
                ? createUserVisibleError(result.stopReason, {
                    code: "compaction-hook-stopped-reason",
                    params: { reason: result.stopReason },
                  })
                : createUserVisibleError("Compaction stopped by hook.", {
                    code: "compaction-hook-stopped",
                    params: {},
                  });
          },
          injectAsyncContexts: async (messages) => messages,
        });
        await emit(contextUsage(agent.state.messages, model.contextWindow, inputTokens));
      } finally {
        try {
          await sessionTitle.settleWrites();
          await closeActiveStore(target);
        } finally {
          activeStore = undefined;
          emitRunEvent = undefined;
          runController = undefined;
          compacting = false;
          compactSettled = undefined;
          settled.resolve();
          scheduleRewake?.();
        }
      }
    },
    contextReport() {
      return contextReport({
        messages: agent.state.messages,
        model: `${model.provider}/${model.id}`,
        window: model.contextWindow,
        inputTokens: inputTokens ?? reportInputTokens,
        mcpServers: mcpToolServers,
      });
    },
    get messages() {
      return agent.state.messages;
    },
    toolState: (name) =>
      name === "plan" && (internal.plan || toolState.get("plan") !== undefined)
        ? { active: plan.getActive() }
        : toolState.get(name),
    checkpoints: () => (internal.parentSessionId ? [] : (checkpoint?.list() ?? [])),
    async rewind(promptEntryId, { code, conversation }) {
      if (disposePromise) throw new Error("Session has been disposed.");
      if (running || subagents.count || rewinding || changingModel || compacting)
        throw new Error("Rewind requires an idle Session.");
      if (internal.parentSessionId || !checkpoint)
        throw new Error("Subagent Sessions cannot rewind.");
      if (!code && !conversation) throw new Error("Rewind requires code or conversation.");
      rewinding = true;
      try {
        await planWrites;
        const prompt = checkpoint.prompt(promptEntryId);
        const files = code
          ? await checkpoint.restoreCode(promptEntryId)
          : { restored: [], deleted: [] };
        if (conversation) {
          await sessionTitle.cancelGeneration();
          const target = await store.open(stored.metadata, context);
          let restoredEntries;
          try {
            const branch = await target.branch("main", context);
            if (!branch) throw new Error("Session has no main branch.");
            const branchEntries = await branch.findEntries({ order: "oldestFirst" }, context);
            const index = branchEntries.findIndex((entry) => entry.id === promptEntryId);
            const anchor = branchEntries[index];
            if (!anchor || anchor.type !== "message" || anchor.message.role !== "user")
              throw new Error("Checkpoint prompt is not on the current branch.");
            restoredEntries = branchEntries.slice(0, index);
            const tip = await branch.getTipId(context);
            await target.createBranch(`rewind-${crypto.randomUUID()}`, tip, context);
            await target.setValue(branchTip("main"), anchor.parentId, context);
            // The native display name is session metadata, independent of conversation rewind.
            const restoredSource = createToolState(
              [titleSourceState],
              restoredEntries,
              () => {},
            ).get("title-source");
            if (sessionTitle.source && sessionTitle.source !== restoredSource) {
              await toolState.set("title-source", sessionTitle.source, target, context);
              restoredEntries = await branch.findEntries({ order: "oldestFirst" }, context);
            }
          } finally {
            await target.close(context);
          }
          const changes = toolState.restore(restoredEntries);
          subagents.restore(toolState.get("subagents") as SubagentIdentity[] | undefined);
          recovery = metadata
            ? await reconcileSubagents(
                toolState.get("subagents") as SubagentIdentity[] | undefined,
                store,
                cwd,
                stored.metadata.id,
              )
            : { subagents: [] };
          recoveryPending = false;
          planActive = (toolState.get("plan") as { active: boolean } | undefined)?.active ?? false;
          planEntered = toolState.get("plan") !== undefined;
          pendingPlanEvents.length = 0;
          goal.disarm();
          // A compact SessionStart hook may be waiting for the next user. Its
          // discarded branch context must not leak into the replacement prompt.
          pendingSessionContexts.length = 0;
          userMessageSequence = 0;
          sessionContextUserSequence = 0;
          const restoredBranch = projectBranch(restoredEntries);
          transcriptMessages.splice(
            0,
            transcriptMessages.length,
            ...restoredBranch.transcriptMessages,
          );
          reminderStart = restoredBranch.reminderStart;
          baselinePersisted = restoredBranch.baselinePersisted;
          promptTexts.clear();
          for (const [id, text] of restoredBranch.promptTexts) promptTexts.set(id, text);
          agent.reset();
          agent.state.messages = restoredBranch.messages;
          completedMessages = structuredClone(agent.state.messages);
          inputTokens = undefined;
          reportInputTokens = undefined;
          for (const change of changes)
            broadcast({ type: "tool_state_changed", ...change, sessionId: session.id });
          broadcast({ type: "conversation_rewound", promptEntryId, sessionId: session.id });
          broadcast({
            ...contextUsage(agent.state.messages, model.contextWindow),
            sessionId: session.id,
          });
        }
        return { prompt, ...files };
      } finally {
        rewinding = false;
        scheduleRewake?.();
      }
    },
    interruptSubagent: subagents.interrupt,
    async waitForIdle() {
      while (running) await runSettled?.promise;
      await goal.settle();
      if (running) await session.waitForIdle();
    },
    dispose(reason = "exit") {
      if (!disposePromise) {
        // Publish the promise before callbacks or hooks can re-enter dispose.
        disposePromise = Promise.resolve().then(async () => {
          goal.disarm();
          await goal.settle();
          sideLifetime.abort();
          const mcp = runMcp;
          hooks.dispose();
          await sessionTitle.dispose();
          runController?.abort();
          try {
            await compactSettled?.promise;
            await Promise.all([
              hooks.run("SessionEnd", { ...hookInput(), reason }, { matchQuery: reason }),
              ...[...childSessions].map((child) => child.dispose(reason)),
            ]);
          } finally {
            unregisterReader();
            await mcp?.close();
            sessionObservers.clear();
            bufferingStartup = false;
            startupEvents.length = 0;
          }
        });
      }
      return disposePromise;
    },
    async run(
      prompt: string,
      {
        signal,
        onEvent,
      }: { signal?: AbortSignal; onEvent?: (event: SessionEvent) => void | Promise<void> } = {},
      source: "user" | "hook" | "goal" = "user",
    ) {
      const fromHook = source === "hook";
      const fromGoal = source === "goal";
      // Human input waits behind internal Runs and takes precedence over continuation.
      if (running && hookRunActive && source === "user") {
        queuedUserRuns++;
        const cancelled = Promise.withResolvers<never>();
        const abortWaiting = () => cancelled.reject(signal?.reason);
        try {
          signal?.throwIfAborted();
          signal?.addEventListener("abort", abortWaiting, { once: true });
          await Promise.race([runSettled!.promise, cancelled.promise]);
          signal?.throwIfAborted();
        } finally {
          signal?.removeEventListener("abort", abortWaiting);
          queuedUserRuns--;
          if (!running && signal?.aborted) scheduleRewake?.();
        }
      }
      if (disposePromise) throw new Error("Session has been disposed.");
      if (rewinding)
        throw createUserVisibleError("Session is rewinding.", {
          code: "session-rewinding",
          params: {},
        });
      if (changingModel)
        throw createUserVisibleError("Session is switching models.", {
          code: "session-switching-models",
          params: {},
        });
      if (compacting)
        throw createUserVisibleError("Session is compacting.", {
          code: "session-compacting",
          params: {},
        });
      if (running)
        throw createUserVisibleError("Session already has an active Run.", {
          code: "session-run-active",
          params: {},
        });
      running = true;
      runDirectHuman = source === "user";
      runGoalRound = fromGoal;
      hookRunActive = source !== "user";
      const settled = Promise.withResolvers<void>();
      runSettled = settled;
      if (!fromHook) {
        bufferingStartup = false;
        startupEvents.length = 0;
      }
      rewakeObserver = onEvent;
      runController = new AbortController();
      signal = signal ? AbortSignal.any([signal, runController.signal]) : runController.signal;
      planTakenOver = false;
      hookStopped = false;
      hookStopReason = undefined;
      toolHookContexts.clear();
      hookDenials.clear();
      let stopHookContinuations = 0;
      const userPrompt: AgentMessage = {
        role: "user",
        content: [{ type: "text", text: prompt }],
        timestamp: Date.now(),
        ...(fromGoal && { source: "goal" }),
      };
      // pi prepareRequest has no end action. A private control exception exits its
      // loop; the synthetic failure it creates is consumed below, never persisted.
      const hookRequestStop = new Error(`Hook request stopped: ${crypto.randomUUID()}`);
      const isHookRequestStop = (message: AgentMessage) =>
        hookStopped &&
        message.role === "assistant" &&
        message.errorMessage === hookRequestStop.message;
      const stopPreparedRequest = () => {
        if (hookStopped) throw hookRequestStop;
      };
      const started = performance.now();
      const result: RunResult = {
        text: "",
        success: false,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        durationMs: 0,
      };
      const promptContexts: string[] = [];
      currentResult = result;
      subagents.begin();
      const emit = (event: AgentEvent | CustomSessionEvent<AgentEvent>) => {
        const identified = { ...event, sessionId: stored.metadata.id };
        broadcast(identified);
        return onEvent?.(identified);
      };
      emitSessionEndEvent = emit;
      const emitContextUsage = () =>
        emit(contextUsage(agent.state.messages, model.contextWindow, inputTokens));
      emitRunEvent = emit;
      const abort = () => {
        agent.abort();
        agent.clearSteeringQueue();
        subagents.abort();
      };
      const mcp = createMcpConnections();
      runMcp = mcp;
      const emitMcpErrors = async () => {
        for (const event of mcp.errors.splice(0)) {
          (options.onWarning ?? console.warn)(`MCP server ${event.server}: ${event.error}`);
          await emit(event);
        }
      };
      const childRun: SubagentRun | undefined = internal.parentSessionId
        ? {
            id: crypto.randomUUID(),
            sessionId: stored.metadata.id,
            parentSessionId: internal.parentSessionId,
            startedAt: Date.now(),
          }
        : undefined;
      let childRunSaved = false;
      let childModelStop: "aborted" | "length" | undefined;
      async function persistChildRun(run: SubagentRun) {
        try {
          await withStore(async (target) => {
            await toolState.set("subagent-run", { ...run }, target, context);
          });
        } catch (error) {
          (options.onWarning ?? console.warn)(
            `Could not save subagent Run fact for ${stored.metadata.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw error;
        }
      }
      let active: StoredSession | undefined;
      let unsubscribe;
      try {
        if (fromGoal) await goal.startRound();
        if (childRun) {
          await persistChildRun(childRun);
          childRunSaved = true;
          await internal.onSubagentRunStarted?.(childRun);
        }
        try {
          await mcp.connect({
            cwd,
            homeDir: options.homeDir,
            settings,
            trustProjectMcp: options.trustProjectMcp,
            signal,
          });
        } finally {
          const generalTools = [
            ...createBuiltinTools(
              cwd,
              (name) => skills.get(name),
              setTodo,
              onQuestion,
              options.homeDir,
              onInteractionStart,
              options.webFetch,
              fileTracking,
            ),
            ...planTools,
            ...goalTools,
            ...mcp.tools,
          ];
          if (!internal.parentSessionId) {
            const discovered = await discoverSubagentTypes(
              cwd,
              options.homeDir,
              generalTools.map((tool) => tool.name),
              { trusted: isTrustedProject(cwd, settings) },
            );
            subagents.setTypes(discovered.types);
            for (const warning of discovered.warnings) (options.onWarning ?? console.warn)(warning);
            for (const warning of discovered.hookWarnings)
              await emit({
                type: "hook_warning",
                event: "SubagentStart",
                hook: warning.source,
                message: warning.message,
                error: warning.error,
              });
          }
          mcpToolServers = mcp.toolServers;
          agent.state.tools = [
            ...generalTools,
            ...(internal.parentSessionId
              ? []
              : [subagents.tool, subagents.forkTool, subagents.sendTool, subagents.listTool]),
          ]
            .filter((tool) => !internal.toolNames || internal.toolNames.includes(tool.name))
            .map(measureTool);
          await emit({
            type: "session_start",
            model: `${model.provider}/${model.id}`,
            cwd,
            tools: agent.state.tools.map((tool) => tool.name),
          });
          await emitContextUsage();
        }
        await emitMcpErrors();
        try {
          signal?.addEventListener("abort", abort);
          signal?.throwIfAborted();
          await planWrites;
          for (const event of pendingPlanEvents.splice(0)) await emit(event);
          for (const event of pendingHookEvents.splice(0)) await emit(event);
          if (sessionStartControl) {
            applyHookControl(sessionStartControl);
            sessionStartControl = undefined;
          }
          if (hookStopped) {
            result.success = true;
            result.stopReason = "hook_stopped";
            result.reason = hookStopReason;
            return result;
          }
          if (!internal.parentSessionId && source === "user") {
            const promptHook = await hooks.run(
              "UserPromptSubmit",
              { ...hookInput(), prompt },
              { signal },
            );
            applyHookControl(promptHook);
            signal?.throwIfAborted();
            if (hookStopped || promptHook.decision === "block") {
              result.success = hookStopped;
              result.stopReason = hookStopped ? "hook_stopped" : "hook_blocked";
              result.reason = hookStopped ? hookStopReason : promptHook.reason;
              return result;
            }
            promptContexts.push(...promptHook.additionalContext);
          } else if (internal.parentSessionId) {
            const started = await hooks.run("SubagentStart", hookInput(), {
              signal,
              matchQuery: internal.agentType,
            });
            signal?.throwIfAborted();
            applyHookControl(started);
            if (hookStopped) {
              result.success = true;
              result.stopReason = "hook_stopped";
              result.reason = hookStopReason;
              return result;
            }
            // Ordinary block decisions do not prevent a child Run from starting.
            promptContexts.push(...started.additionalContext);
          }
          await sessionTitle.settleWrites();
          const runStore = await openActiveStore();
          active = runStore;
          activeStore = runStore;
          const branch = await runStore.branch("main", context);
          if (!branch) throw new Error("Session has no main branch.");
          if (!baselinePersisted) {
            await branch.appendMessage(agent.state.messages[0]!, context);
            baselinePersisted = true;
          }
          const injectAsyncContexts = async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
            const reminders = pendingAsyncContexts.splice(0).map((content) => ({
              role: "system-reminder" as const,
              source: "async-hook",
              content,
              timestamp: Date.now(),
            }));
            for (const reminder of reminders) {
              await branch.appendMessage(reminder, context);
              transcriptMessages.push(reminder);
              await emit({
                type: "reminder_injected",
                source: reminder.source,
                content: reminder.content,
              });
            }
            const injected = [...messages, ...reminders];
            return pendingAsyncContexts.length ? injectAsyncContexts(injected) : injected;
          };
          agent.prepareRequest = async ({ context: requestContext }, turnSignal) => {
            let contextChanged = false;
            // A compact hook may wait across tool turns. Consume its context only
            // once pi has emitted the next user, including Stop feedback or child notices.
            if (pendingSessionContexts.length && userMessageSequence > sessionContextUserSequence) {
              const reminders = consumeSessionContext();
              for (const reminder of reminders) {
                await branch.appendMessage(reminder, context);
                transcriptMessages.push(reminder);
                await emit({
                  type: "reminder_injected",
                  source: reminder.source,
                  content: reminder.content,
                });
              }
              const messages = [...requestContext.messages, ...reminders];
              agent.state.messages = messages;
              requestContext = { ...requestContext, messages };
              contextChanged = true;
            }
            const compacted = await compactContext({
              target: runStore,
              messages: requestContext.messages,
              trigger: "auto",
              signal: turnSignal,
              emit,
              control: (result) => {
                applyHookControl(result);
                stopPreparedRequest();
              },
              injectAsyncContexts,
            });
            if (!compacted) {
              await planWrites;
              const changed = await collectSourceReminders(
                transcriptMessages.slice(reminderStart),
                [planReminder, fileTracking.reminderSource],
                (options.now ?? (() => new Date()))(),
              );
              if (!changed.length && !pendingAsyncContexts.length)
                return contextChanged ? { context: requestContext } : undefined;
              for (const reminder of changed) {
                await branch.appendMessage(reminder, context);
                transcriptMessages.push(reminder);
                await emit({
                  type: "reminder_injected",
                  source: reminder.source,
                  content: reminder.content,
                });
              }
              const messages = await injectAsyncContexts([...requestContext.messages, ...changed]);
              agent.state.messages = messages;
              return { context: { ...requestContext, messages } };
            }

            await emitContextUsage();
            const messages = await injectAsyncContexts(agent.state.messages);
            agent.state.messages = messages;
            return { context: { ...requestContext, messages } };
          };
          unsubscribe = agent.subscribe(async (event) => {
            if ("message" in event && isHookRequestStop(event.message)) {
              if (event.type === "message_end")
                agent.state.messages = agent.state.messages.filter(
                  (message) => !isHookRequestStop(message),
                );
              return;
            }
            if (event.type === "agent_end")
              event = {
                ...event,
                messages: event.messages.filter((message) => !isHookRequestStop(message)),
              };
            // pi skips afterToolCall for blocked/invalid calls. Its end event still
            // precedes creation of the tool-result message and carries the same result.
            if (event.type === "tool_execution_end") {
              sidePendingCalls.delete(event.toolCallId);
              Object.assign(event.result, consumeToolHookOutput(event.toolCallId, event.result));
            }
            await emitMcpErrors();
            if (event.type === "turn_end") {
              sidePendingCalls.clear();
              completedMessages = structuredClone(agent.state.messages);
            }
            if (event.type === "message_end") {
              if (event.message.role === "assistant")
                for (const block of event.message.content)
                  if (block.type === "toolCall") sidePendingCalls.add(block.id);
              if (event.message.role === "user") userMessageSequence++;
              rewakeSteering.delete(event.message);
              subagents.delivered(event.message);
              const entryId = await branch.appendMessage(event.message, context);
              if (
                event.message.role === "system-reminder" &&
                event.message.source === "session-resume"
              )
                recoveryPending = false;
              if (event.message === userPrompt && source === "user" && !internal.parentSessionId) {
                promptTexts.set(entryId, prompt);
                await checkpoint?.start(entryId);
                await sessionTitle.firstPrompt(prompt);
              }
              transcriptMessages.push(event.message);
              if (event.message.role === "system-reminder") {
                await emit({
                  type: "reminder_injected",
                  source: event.message.source,
                  content: event.message.content,
                });
              }
              if (event.message.role === "assistant") {
                const message = event.message;
                const text = message.content
                  .flatMap((c) => (c.type === "text" ? [c.text] : []))
                  .join("");
                if (!internal.parentSessionId || text.trim()) result.text = text;
                result.usage.input += message.usage.input;
                result.usage.output += message.usage.output;
                result.usage.cacheRead += message.usage.cacheRead;
                result.usage.cacheWrite += message.usage.cacheWrite;
                result.usage.totalTokens += message.usage.totalTokens;
                childModelStop =
                  message.stopReason === "aborted" || message.stopReason === "length"
                    ? message.stopReason
                    : undefined;
                if (message.stopReason === "error" || message.stopReason === "aborted") {
                  result.error = message.errorMessage ?? `Model stopped: ${message.stopReason}`;
                }
              }
            }
            if (event.type === "message_end" && event.message.role === "assistant") {
              const { input, cacheRead, cacheWrite } = event.message.usage;
              inputTokens = input + cacheRead + cacheWrite || undefined;
              reportInputTokens = inputTokens;
            }
            await emit(event);
            if (event.type === "message_end" && event.message.role === "assistant")
              await emitContextUsage();
          });
          signal?.throwIfAborted();
          const discovered = await discoverSkills(cwd, options.homeDir);
          skills = discovered.skills;
          for (const warning of discovered.warnings) (options.onWarning ?? console.warn)(warning);
          const reminders = await collectReminders({
            messages: transcriptMessages.slice(reminderStart),
            cwd,
            homeDir: options.homeDir,
            now: (options.now ?? (() => new Date()))(),
            sources: reminderSources,
            includeEnvironment: !transcriptMessages.some((message) => message.role === "user"),
          });
          signal?.throwIfAborted();
          const invocation = skillInvocation(prompt, skills);
          await agent.prompt([
            ...reminders,
            userPrompt,
            ...(source === "user" && recoveryPending
              ? [
                  {
                    role: "system-reminder" as const,
                    source: "session-resume",
                    content: recoverySummary(recovery),
                    timestamp: Date.now(),
                  },
                ]
              : []),
            ...consumeSessionContext(),
            ...promptContexts.map((content) => ({
              role: "system-reminder" as const,
              source: internal.parentSessionId ? "subagent-start-hook" : "user-prompt-hook",
              content,
              timestamp: Date.now(),
            })),
            ...(invocation === undefined
              ? []
              : [
                  {
                    role: "system-reminder" as const,
                    source: "skill-invocation",
                    content: invocation,
                    timestamp: Date.now(),
                  },
                ]),
          ]);
          while (!planTakenOver && !hookStopped) {
            signal?.throwIfAborted();
            if (rewakeSteering.size || subagents.hasNotifications) {
              await agent.continue();
              continue;
            }
            if (subagents.count) {
              const changed = Promise.race([subagents.wait(), rewakeChanged.promise]);
              await emit({ type: "subagents_waiting", count: subagents.count });
              await changed;
              continue;
            }
            const lastAssistant = agent.state.messages.findLast(
              (message) => message.role === "assistant",
            );
            if (
              !lastAssistant ||
              lastAssistant.stopReason === "aborted" ||
              lastAssistant.stopReason === "error"
            )
              break;
            // Stop runs only after pi and all child notifications finish. Future Goal
            // checks belong after Stop allows completion; hook continuations are not Goal rounds.
            const stopEvent = internal.parentSessionId ? "SubagentStop" : "Stop";
            const input = hookInput();
            const stopped = await hooks.run(
              stopEvent,
              {
                ...input,
                ...(internal.parentSessionId && { agent_transcript_path: input.transcript_path }),
                stop_hook_active: stopHookContinuations > 0,
                last_assistant_message: lastAssistant.content
                  .flatMap((part) => (part.type === "text" ? [part.text] : []))
                  .join(""),
              },
              { signal, matchQuery: internal.agentType },
            );
            applyHookControl(stopped);
            signal?.throwIfAborted();
            if (hookStopped) break;
            if (stopped.decision !== "block") {
              if (rewakeSteering.size) {
                await agent.continue();
                continue;
              }
              break;
            }
            if (stopHookContinuations >= 8) {
              const message = `${stopEvent} hook reached the 8 continuation limit; ignoring block`;
              (options.onWarning ?? console.warn)(message);
              await emit({
                type: "hook_warning",
                event: stopEvent,
                hook: stopEvent,
                message,
                error: {
                  code: "hook-continuation-limit",
                  params: { event: stopEvent, limit: "8" },
                },
              });
              break;
            }
            stopHookContinuations++;
            const reason = stopped.reason || `${stopEvent} hook blocked completion.`;
            await emit({ type: "hook_continued", event: stopEvent, reason });
            signal?.throwIfAborted();
            const feedback = {
              role: "user" as const,
              source: "stop_hook",
              content: [{ type: "text" as const, text: reason }],
              timestamp: Date.now(),
            };
            await agent.prompt(feedback);
          }
        } finally {
          subagents.abort();
          agent.clearSteeringQueue();
          pendingRewakes.push(...rewakeSteering.values());
          rewakeSteering.clear();
          await subagents.settle();
          signal?.removeEventListener("abort", abort);
          unsubscribe?.();
          agent.prepareRequest = undefined;
          try {
            await planWrites;
          } finally {
            try {
              await sessionTitle.settleWrites();
              await closeActiveStore(active);
            } finally {
              activeStore = undefined;
            }
          }
        }
        signal?.throwIfAborted();
        if (result.error) throw new Error(result.error);
        if (agent.state.errorMessage && agent.state.errorMessage !== hookRequestStop.message)
          throw new Error(agent.state.errorMessage);
        result.success = true;
        if (hookStopped) {
          result.stopReason = "hook_stopped";
          result.reason = hookStopReason;
        }
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        try {
          await permissions.settleReviews();
          await mcp.close();
          await emitMcpErrors();
          result.durationMs = performance.now() - started;
          if (childRun && childRunSaved) {
            await persistChildRun({
              ...childRun,
              endedAt: Date.now(),
              outcome: signal?.aborted
                ? "aborted"
                : (result.stopReason ?? childModelStop ?? (result.success ? "completed" : "error")),
              ...(result.error && { error: result.error }),
              ...(result.reason && { reason: result.reason }),
            });
          }
          if (result.error || signal?.aborted || childModelStop) goal.disarm();
          await emit({ type: "result", ...result });
        } finally {
          currentResult = undefined;
          emitRunEvent = undefined;
          pendingRewakes.push(...rewakeSteering.values());
          rewakeSteering.clear();
          agent.clearSteeringQueue();
          runController = undefined;
          sidePendingCalls.clear();
          runMcp = undefined;
          running = false;
          hookRunActive = false;
          settled.resolve();
          if (!queuedUserRuns) scheduleRewake?.();
        }
      }
      return result;
    },
  } satisfies Session;
  scheduleRewake = () => {
    if (disposePromise || rewinding || compacting || changingModel) return;
    if (running) {
      for (const reason of pendingRewakes.splice(0)) {
        const message: AgentMessage = {
          role: "user",
          content: [{ type: "text", text: reason }],
          timestamp: Date.now(),
        };
        rewakeSteering.set(message, reason);
        agent.steer(message);
        rewakeChanged.resolve();
        rewakeChanged = Promise.withResolvers<void>();
      }
    } else if (queuedUserRuns) {
      return;
    } else if (pendingRewakes.length) {
      const reason = pendingRewakes.shift()!;
      void session.run(reason, { onEvent: rewakeObserver }, "hook").catch(() => {});
    } else {
      const current = goal.view();
      if (current?.phase === "active" && current.armed) {
        if (current.roundsStarted >= current.maxRounds)
          void goal.startRound().catch((error: unknown) => {
            goal.disarm();
            (options.onWarning ?? console.warn)(
              `Goal continuation failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        else
          void session
            .run(renderGoalRoundPrompt(current), { onEvent: rewakeObserver }, "goal")
            .catch(() => {});
      }
    }
  };
  scheduleRewake();
  return session;
}
