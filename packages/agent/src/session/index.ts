import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context, JsonValue } from "@earendil-works/chord";
import type { Api, Model, Models, Message, ToolCall, UserMessage } from "@earendil-works/pi-ai";
import {
  Harness,
  createRegistry,
  defineDoc,
  hook,
  GenerationTask,
  ToolTask,
  LiveDoc,
  type SubmissionId,
  type ToolRegistration,
  type EntryDraft,
  type Storage,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
  createUserVisibleError,
  type PermissionMode,
  type RunResult,
  type Settings,
  type ContextReport,
  type ContextUsageEvent,
  type McpSnapshot,
  type JobView,
  type JobOutput,
} from "@rukie/shared";
import type { SessionEvent } from "./events.ts";
import { transcriptMessages, type TranscriptMessage } from "./messages.ts";
export type { SessionEvent } from "./events.ts";
import { createJobs } from "../tools/jobs/index.ts";
import { resolveModel, isTrustedProject, modelState } from "../config/index.ts";
import {
  createJsonlStore,
  registerSessionReader,
  SessionMetadataDoc,
  type SessionStore,
} from "../store/index.ts";
import { createToolState } from "../tool-state/index.ts";
import {
  createPermissionGate,
  parsePermissionRules,
  type PermissionAskRequest,
  type SessionAllowRule,
  type OnToolCallAllowed,
} from "../permissions/index.ts";
export type { PermissionAskRequest, SessionAllowRule } from "../permissions/index.ts";
import { createFileTracking, fileTrackingState } from "../file-tracking/index.ts";
import { collectReminders, type ReminderSource, type SystemReminder } from "../reminders/index.ts";
import { discoverSkills, skillInvocation, skillsReminder } from "../skills/index.ts";
import {
  createMcpConnections,
  createMcpAuthState,
  type OnMcpAuth,
  type McpAuthOutcome,
} from "../mcp/index.ts";
import { createSessionTitle, titleSourceState, type TitleSource } from "../session-title/index.ts";
import { sideQuestion } from "../side-question/index.ts";
import { contextUsage, contextReport } from "../context-usage/index.ts";
import { todoState, type TodoItem } from "../tools/todo/index.ts";
import {
  createCheckpoints,
  checkpointState,
  cleanupExpiredBackups,
  type Checkpoint,
  type RewindResult,
} from "../checkpoint/index.ts";
import {
  createPlanModeController,
  planModeReminder,
  planState,
  type OnPlanReview,
} from "../tools/plan-mode/index.ts";
import {
  createGoalController,
  goalState,
  renderGoalRoundPrompt,
  type GoalView,
} from "../tools/goal/index.ts";
import { subagentsState, subagentRunState, type SubagentRun } from "../tools/subagents/state.ts";
import type { QuestionReply, QuestionRequest } from "../tools/question.ts";
import { createHooks, type CommonHookResult, type HookInput } from "../hooks/index.ts";
import type { WebFetchOptions } from "../tools/web-fetch/index.ts";
import { validateImage, type PromptImage } from "../images/index.ts";
import { SYSTEM_PROMPT } from "../prompt/index.ts";
import { createThinkingTiming } from "./thinking.ts";
import { createBuiltinTools } from "../tools/builtin.ts";
import { createSubagentController } from "../tools/subagents/index.ts";
import { createBaseTools, createSubagentTools, refreshSubagentTypes } from "./tools.ts";
import { createConversationObservation } from "./observation.ts";

export type RequestResult = RunResult & { requestId: string };
interface RunSummaryFact {
  afterMessage: number;
  durationMs: number;
  endedAt: number;
  success: boolean;
}
export interface SessionOptions {
  /** Test network boundary overrides; production frontends leave this unset. */
  webFetch?: WebFetchOptions;
  /** Project directory the session works in. */
  cwd: string;
  /** User home; `~/.rukie` lives under it. Injectable for tests. */
  homeDir: string;
  /** Merged settings, see `loadSettings`. */
  settings?: Settings;
  /** Model call; defaults to pi-ai's `streamSimple` for the resolved model. Tests inject a fake. */
  models?: Models;
  /** Skips resolving `settings.model`; requires `models`. Tests pair it with a fake one. */
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
  /** Present MCP OAuth authorization; authentication tools are absent without this callback. */
  onMcpAuth?: OnMcpAuth;
  /** Load this project's .mcp.json even when it is not in the user trust list. */
  trustProjectMcp?: boolean;
  /** Clock used for reminder dates and backup retention; defaults to the local current date. */
  now?: () => Date;
  /** Additional content sources, compared with the latest persisted reminder per source. */
  reminderSources?: ReminderSource[];
  /** Startup and discovery diagnostics; defaults to stderr via console.warn. */
  onWarning?: (warning: string) => void;
}

export interface Session {
  /** Historical child Runs requiring attention on this Session Resume. No Run is started. */
  /** Includes internal Hook and Goal Runs. */
  readonly running: boolean;
  /** Cancels the current run, including one started without a frontend controller. */
  abort(): Promise<void>;
  /** Queue another user instruction for the current Run, including Skill Invocation. */
  steer(prompt: string, options?: { images?: PromptImage[] }): Promise<void>;
  /** Observe all runs; the first subscriber also receives events from startup autoruns. */
  subscribe(onEvent: (event: SessionEvent) => void): () => void;
  /** Current Session's background jobs, including settled records; excludes foreground work. */
  jobs(): JobView[];
  /** Read from an absolute UTF-8 byte offset without moving the model's job_output cursor. */
  readJob(id: string, offset: number): JobOutput;
  /** Stop a job; inform the active Run or queue input for the next human prompt while idle. */
  killJob(id: string): Promise<void>;
  readonly currentRequestId: string | undefined;
  waitForRequest(requestId: string): Promise<RequestResult>;
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
  createGoal(
    objective: string,
    options?: { maxRounds?: number },
  ): Promise<GoalView & { requestId: string }>;
  /** Idle only. Preserves rounds and activation; a complete Goal is replaced with a new one. */
  editGoal(objective: string): Promise<GoalView & { requestId?: string }>;
  /** Run-safe. Stops continuation without interrupting the current Run. */
  pauseGoal(): Promise<GoalView & { requestId?: string }>;
  /** Idle only. Arms a restored, paused or blocked Goal and starts the next round. */
  resumeGoal(): Promise<GoalView & { requestId?: string }>;
  /** Run-safe. Persists a tombstone without interrupting the current Run. */
  clearGoal(): Promise<void>;
  /** Changes guidance for the next model call and persists the state, also outside a Run. */
  setPlanMode(on: boolean): Promise<void>;
  /** Applies to the next tool call; never persisted. */
  setPermissionMode(mode: PermissionMode): void;
  /** Snapshot the restored context; usable while idle or running. */
  contextReport(): ContextReport;
  /** Snapshot current usage, retaining the latest provider input count on resume. */
  contextUsage(): ContextUsageEvent;
  /** Completed Runs anchored after a one-based message position in the current restored context. */
  runSummaries(): readonly RunSummaryFact[];
  /**
   * Returns an independent copy of the latest committed snapshot; cached reads never reconnect.
   * Concurrent first reads share a probe that closes its connections before resolving.
   * Explicit refresh rereads complete configuration and shares concurrent probes while idle;
   * a Run rejects it as busy. Refresh never starts OAuth or writes Transcript or Tool State.
   * Subscribe to mcp_servers_changed, then read without refresh to observe committed changes.
   */
  mcpServers(options?: { refresh?: boolean }): Promise<McpSnapshot>;
  /** Idle only; resolves to authenticated or cancelled without writing Transcript. */
  authenticateMcp(name: string): Promise<McpAuthOutcome>;
  /** Idle only; removes this server identity's credential and remembered authorization failure. */
  clearMcpAuth(name: string): Promise<void>;
  /** Idle only; forgets remembered authorization failure and probes this server again. */
  reconnectMcp(name: string): Promise<void>;
  /** Compress completed history while idle; focus only applies to this summary. */
  compact(options?: { instructions?: string }): Promise<void>;
  /** Answer once from current context without changing this Session or its Run. */
  sideQuestion(question: string, options?: { signal?: AbortSignal }): AsyncIterable<string>;
  /** Current restored context in memory, including reminders and any compaction. */
  readonly messages: readonly TranscriptMessage[];
  /** Current Tool State snapshot; undefined before the first write. */
  toolState(name: string): unknown;
  /** Prompt anchors and their file records, in chronological order. */
  checkpoints(): Checkpoint[];
  /** Restores files and/or the branch before a prompt while idle. */
  rewind(
    promptEntryId: string,
    options: { code: boolean; conversation: boolean },
  ): Promise<RewindResult>;
  /** Read a known child's current Transcript and Run facts without starting or repairing it. */
  readSubagent(id: string): Promise<
    | {
        messages: readonly TranscriptMessage[];
        /** Committed context before the latest Run's native start entry; excludes its current Turns. */
        title: string;
        description: string;
        historyMessages?: readonly TranscriptMessage[];
        model?: string;
        run?: SubagentRun;
      }
    | undefined
  >;
  /** Interrupt a child Run; missing and idle children are a no-op. */
  interruptSubagent(id: string): void;
  /** Ends the Session once, cancelling its Run and releasing external resources. */
  close(reason?: "exit" | "other"): Promise<void>;
  /** External completion boundary, including Hook autoruns; never await from a Run callback. */
  waitForIdle(): Promise<void>;
  /** Waits behind an internal Hook or Goal Run; a competing user Run is rejected. */
  run(
    prompt: string,
    options?: {
      images?: PromptImage[];
      signal?: AbortSignal;
      /** Ordered Run events; result follows storage close. Also receives disposal diagnostics without awaiting observers. */
      onEvent?: (event: SessionEvent) => void | Promise<void>;
    },
  ): Promise<RequestResult>;
}

const GoalActivationDoc = defineDoc<{ taskId: number | null; requestId: string | null }>({
  kind: "rukie.goal-activation",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ taskId: null, requestId: null }),
});
const ChildFactsDoc = defineDoc<{ title: string; description: string }>({
  kind: "rukie.child-facts",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ title: "", description: "" }),
});
const RequestDoc = defineDoc<{
  requests: Record<
    string,
    { submissions: number[]; tasks: number[]; startedAt: number; result: JsonValue | null }
  >;
}>({
  kind: "rukie.requests",
  version: 1,
  scope: "session",
  initial: () => ({ requests: {} }),
});
const reminderEntry = (reminder: SystemReminder): EntryDraft => ({
  kind: "rukie.reminder",
  data: { source: reminder.source, content: reminder.content, timestamp: reminder.timestamp },
  model: [
    {
      role: "user",
      content: [
        { type: "text", text: `<system-reminder>\n${reminder.content}\n</system-reminder>` },
      ],
      timestamp: reminder.timestamp,
    },
  ],
});
class PromptHookBlocked extends Error {
  constructor(readonly result: RequestResult) {
    super(result.error);
  }
}
const textOf = (message: Message): string => {
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
};
const zeroUsage = (): RunResult["usage"] => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
});

function storedRequestResult(value: JsonValue | null): RequestResult | undefined {
  if (value === null) return;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.requestId !== "string" ||
    typeof value.text !== "string" ||
    typeof value.success !== "boolean" ||
    typeof value.durationMs !== "number" ||
    !value.usage ||
    typeof value.usage !== "object" ||
    Array.isArray(value.usage)
  )
    throw new Error("Invalid persisted request result.");
  const usage = zeroUsage();
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
    const count = value.usage[key];
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0)
      throw new Error("Invalid persisted request usage.");
    usage[key] = count;
  }
  if (value.error !== undefined && typeof value.error !== "string")
    throw new Error("Invalid persisted request error.");
  return {
    requestId: value.requestId,
    text: value.text,
    success: value.success,
    durationMs: value.durationMs,
    usage,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

/** One native Harness owns every request, task, entry and conversation of this Session. */
export async function createSession(options: SessionOptions): Promise<Session> {
  const context = BACKGROUND_CONTEXT;
  const settings = options.settings ?? {};
  const cwd = resolve(options.cwd);
  const warn = options.onWarning ?? console.warn;
  const resolved =
    options.model && options.models
      ? { model: options.model, models: options.models }
      : await resolveModel(settings, options.homeDir);
  let model = resolved.model;
  const models = resolved.models;
  const selectedModel = (spec: string) => {
    const slash = spec.indexOf("/");
    const selected = models.getModel(spec.slice(0, slash), spec.slice(slash + 1));
    if (!selected) throw new Error(`Unknown model: ${spec}`);
    return selected;
  };
  const store = options.store ?? createJsonlStore({ cwd, homeDir: options.homeDir });
  const lease = await store.open({ id: options.resumeId }, context);
  const failedCleanup: (() => Promise<void>)[] = [lease.release];
  try {
    const registry = createRegistry();
    const env = new NodeExecutionEnv({ cwd });
    failedCleanup.push(() => env.cleanup(context));
    const listeners = new Set<(event: SessionEvent) => void>();
    const emit = (event: SessionEvent) => {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          warn(String(error));
        }
      }
    };
    type EventPayload<E = SessionEvent> = E extends { sessionId: string }
      ? Omit<E, "sessionId">
      : never;
    const custom = (event: EventPayload) => emit({ ...event, sessionId: lease.id } as SessionEvent);
    let closed = false;
    let closing: Promise<void> | undefined;
    let currentRequestId: string | undefined;
    let contextMessages: readonly Message[] = [];
    let runSummaries: RunSummaryFact[] = [];
    const thinking = createThinkingTiming(() => performance.now());
    let thinkingTask: number | undefined;
    let modelFact = `${model.provider}/${model.id}`;
    const auxiliaryLifetime = new AbortController();
    let stopped = false;
    let goalRound = false;
    let wrapup: string | undefined;
    let permissionMode = options.permissionMode ?? settings.permissionMode ?? "ask";
    let observation: Awaited<ReturnType<typeof createConversationObservation>>;
    const storageFault = Promise.withResolvers<never>();
    void storageFault.promise.catch(() => {});
    const commitStorage = lease.storage.commit.bind(lease.storage);
    // A failed backend admission poisons native ownership and must wake local callers
    // even though no durable submission receipt can be fabricated for that failure.
    const observedStorage = new Proxy(lease.storage, {
      get(target, key) {
        if (key === "commit")
          return async (...args: Parameters<Storage["commit"]>) => {
            try {
              return await commitStorage(...args);
            } catch (error) {
              storageFault.reject(error);
              throw error;
            }
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const harness = await Harness.open(
      observedStorage,
      {
        models,
        registry,
        env: () => env,
        settings: {
          retry: { enabled: false },
          progress: { partialIntervalMs: 0, outputIntervalMs: 0 },
          compaction: { enabled: true },
        },
        onReport: (error) => warn(String(error)),
      },
      context,
    );
    failedCleanup.push(() => harness.close(context));
    let conversation = await harness.root(context, {
      agent: {
        model: { provider: model.provider, modelId: model.id },
        cwd,
        instructions: SYSTEM_PROMPT,
      },
      init: async (tx, id) => {
        await tx.appendEntry(id, { kind: "rukie.initial" });
      },
    });
    let metadata = await harness.snapshot(SessionMetadataDoc, context);
    if (metadata?.id && metadata.id !== lease.id)
      throw new Error("Session metadata identity does not match storage.");
    if (metadata?.activeConversationId) {
      // Persisted numeric identity is validated against the native conversation table before branding.
      const found = (
        await lease.storage.scanConversations({}, 100000, undefined, context)
      ).items.find((row) => Number(row.id) === metadata!.activeConversationId);
      if (!found) throw new Error("Active conversation is missing.");
      conversation = (await harness.conversation(found.id, context))!;
    }
    const savedModel = (await conversation.agent(context)).model;
    if (savedModel) {
      const restored = models.getModel(savedModel.provider, savedModel.modelId);
      if (!restored)
        throw new Error(`Unknown restored model: ${savedModel.provider}/${savedModel.modelId}`);
      model = restored;
    }
    const subagentsDefinition = subagentsState(lease.id);
    const definitions = [
      todoState,
      planState,
      goalState,
      checkpointState,
      fileTrackingState,
      modelState,
      titleSourceState,
      subagentRunState,
      subagentsDefinition,
    ];
    let state = await createToolState(definitions, harness, conversation, context);
    const writeMetadata = async (
      title = metadata?.title ?? "",
      source: TitleSource = metadata?.titleSource ?? "prompt",
    ) => {
      await harness.commit(async (tx) => {
        const doc = await tx.doc(SessionMetadataDoc);
        Object.assign(doc, {
          id: lease.id,
          cwd,
          title,
          titleSource: source,
          model: `${model.provider}/${model.id}`,
          activeConversationId: Number(conversation.id),
          updatedAt: Date.now(),
          messageCount: observation?.messages().length ?? 0,
        });
      }, context);
      metadata = await harness.snapshot(SessionMetadataDoc, context);
    };
    await writeMetadata();
    const assertAvailable = (idle = false) => {
      if (closed) throw new Error("Session is closed.");
      if (idle && observation?.running()) throw new Error("Session is busy.");
    };
    const hooks = createHooks({
      settings: settings.hooks,
      cwd,
      homeDir: options.homeDir,
      projectDir: cwd,
      model: {
        models,
        getModel: async (selected) =>
          selected || settings.reviewModel
            ? selectedModel(selected ?? settings.reviewModel!)
            : model,
      },
      onWarning: warn,
      onEvent: (event) => custom(event),
      onAsyncResult: (result) => {
        void applyHookResult(result, "hook-async").catch(warn);
      },
    });
    const hookInput = (extra: Record<string, unknown> = {}): HookInput => ({
      session_id: lease.id,
      transcript_path: join(store.key(lease.id), "main.jsonl"),
      cwd,
      permission_mode: permissionMode,
      ...extra,
    });
    const appendReminder = async (reminder: SystemReminder, ctx: Context = context) => {
      await conversation.commit(
        (tx) => tx.appendEntry(conversation.id, reminderEntry(reminder)),
        ctx,
      );
    };
    async function appendNotice(
      notice: import("./session-notice.ts").SessionNotice,
      ctx = context,
    ) {
      await conversation.commit(
        (tx) =>
          tx.appendEntry(conversation.id, {
            kind: "rukie.notice",
            data: { role: "session-notice", notice, timestamp: Date.now() },
          }),
        ctx,
      );
    }
    async function applyHookResult(result: CommonHookResult, source: string, ctx = context) {
      for (const text of result.systemMessages)
        await appendNotice({ kind: "hook_message", message: text }, ctx);
      for (const text of result.additionalContext)
        await appendReminder(
          { role: "system-reminder", source, content: text, timestamp: Date.now() },
          ctx,
        );
      if (result.continue === false) stopped = true;
    }
    const notifyInteraction: import("../interaction/index.ts").OnInteractionStart = async (
      notification,
      signal,
    ) => {
      const result = await hooks.run("Notification", hookInput({ ...notification }), {
        signal,
        matchQuery: notification.notification_type,
      });
      await applyHookResult(
        { systemMessages: result.systemMessages, additionalContext: result.additionalContext },
        "hook:Notification",
      );
    };
    const checkpoints = createCheckpoints({
      homeDir: options.homeDir,
      sessionId: lease.id,
      getState: () => state.get("checkpoint"),
      persist: async (value) => {
        await state.set("checkpoint", value, context);
      },
      getPrompt: (id) =>
        observation
          ?.view()
          .entries.find((entry) => String(entry.id) === id)
          ?.model?.filter((message) => message.role === "user")
          .map(textOf)
          .join(""),
    });
    const tracking = createFileTracking(cwd, {
      initialState: state.get("file-tracking"),
      previousReminder: transcriptMessages((await conversation.context(context)).entries)
        .flatMap((message) =>
          message.role === "system-reminder" && message.source === "file-changes"
            ? [message.content]
            : [],
        )
        .at(-1),
      persist: async (value, reminder) => {
        await state.set(
          "file-tracking",
          value,
          context,
          reminder ? reminderEntry(reminder) : undefined,
        );
      },
    });
    const plan = createPlanModeController({
      getSnapshot: () => state.get("plan"),
      persist: async (active) => {
        await state.set("plan", { active }, context);
      },
      changed: () => {},
    });
    const activation = await harness.snapshot(GoalActivationDoc, conversation.id, context);
    const nativeLive = await harness.snapshot(LiveDoc, conversation.id, context);
    const goal = createGoalController({
      initialArmed: !!nativeLive?.run && activation?.taskId === Number(nativeLive.run.taskId),
      getSnapshot: () => state.get("goal"),
      persist: async (value, armed) => {
        await conversation.commit(async (tx) => {
          (await tx.doc(goalState.document, conversation.id)).value = value;
          const activation = await tx.doc(GoalActivationDoc, conversation.id);
          const live = await tx.doc(LiveDoc, conversation.id);
          activation.taskId = armed && live.run ? Number(live.run.taskId) : null;
          activation.requestId = armed ? (currentRequestId ?? null) : null;
        }, context);
      },
      changed: () => {},
      assertAvailable,
      warn: () => {},
      // Public Session admissions and native onYield own Goal scheduling.
      schedule: () => {},
    });
    const title = createSessionTitle({
      title: metadata?.title,
      source: metadata?.titleSource,
      hasPrompt: (await conversation.context(context)).messages.some(
        (message) => message.role === "user",
      ),
      models,
      getModel: async () => (settings.titleModel ? selectedModel(settings.titleModel) : model),
      persist: async (value, source) => {
        await state.set("title-source", source, context);
        await writeMetadata(value, source);
      },
      changed: (value, source) => custom({ type: "session_title_changed", title: value, source }),
      warning: warn,
    });
    const mcp = createMcpConnections(createMcpAuthState());
    const jobs = createJobs({
      onEvent: (event) => custom(event),
      onNotify: (job) => {
        if (!closed)
          void appendReminder({
            role: "system-reminder",
            source: `job:${job.id}`,
            content: `Background job ${job.id} ${job.status}.`,
            timestamp: Date.now(),
          }).catch(warn);
      },
    });
    failedCleanup.push(async () => {
      await jobs.dispose(true);
      await mcp.close();
      hooks.dispose();
    });
    let skills = (await discoverSkills(cwd, options.homeDir)).skills;
    let tools: ToolRegistration[] = [];
    const gate = createPermissionGate({
      cwd,
      homeDir: options.homeDir,
      rules: parsePermissionRules({
        ...settings.permissions,
        allow: [...(settings.permissions?.allow ?? []), ...(options.allowRules ?? [])],
      }),
      sessionAllowRules: options.sessionAllowRules,
      getMode: () => permissionMode,
      getTools: () => tools,
      getMessages: async () => {
        const view = await conversation.context(context);
        const submissions = await lease.storage.scanSubmissions(
          { conversationId: conversation.id },
          100000,
          undefined,
          context,
        );
        const human = new Set(
          submissions.items.flatMap((record) =>
            record.type === "input" && record.requestId?.startsWith("human:") && record.entry
              ? [record.entry]
              : [],
          ),
        );
        return view.entries.flatMap((entry) =>
          (entry.model ?? []).filter(
            (message) =>
              message.role === "assistant" || (message.role === "user" && human.has(entry.id)),
          ),
        );
      },
      getProjectInstructions: () =>
        observation
          .messages()
          .flatMap((message) =>
            message.role === "system-reminder" &&
            (message.source === "project-instructions" || message.source === "user-instructions")
              ? [message.content]
              : [],
          ),
      getReviewModel: () => async () =>
        settings.reviewModel ? selectedModel(settings.reviewModel) : model,
      models,
      onPermissionAsk: options.onPermissionAsk,
      onInteractionStart: notifyInteraction,
      onToolCallAllowed: async (call) => {
        await checkpoints.record(call, cwd, options.homeDir);
        await options.onToolCallAllowed?.(call);
      },
      onEvent: (event) => custom(event),
      setMode: (value) => {
        permissionMode = value;
      },
      onHookWarning: warn,
      isRunStopped: () => stopped,
      stopRun: () => {
        stopped = true;
      },
      isMcpAuthTool: (name) => mcp.authTools.has(name),
      preToolUse: async (call, signal) => {
        const result = await hooks.run(
          "PreToolUse",
          hookInput({
            tool_name: call.toolCall.name,
            tool_input: call.args,
            tool_use_id: call.toolCall.id,
          }),
          { signal, matchQuery: call.toolCall.name },
        );
        await applyHookResult(result, "hook:PreToolUse");
        return result;
      },
      permissionRequest: (call, suggestions, signal) =>
        hooks.run(
          "PermissionRequest",
          hookInput({
            tool_name: call.toolCall.name,
            tool_input: call.args,
            permission_suggestions: suggestions,
          }),
          { signal, matchQuery: call.toolCall.name },
        ),
      permissionDenied: (call, denial, signal) =>
        hooks.run(
          "PermissionDenied",
          hookInput({
            tool_name: call.toolCall.name,
            tool_input: call.args,
            permission_denial: denial,
          }),
          { signal, matchQuery: call.toolCall.name },
        ),
    });
    const childResources = new Map<
      number,
      {
        observation: Awaited<ReturnType<typeof createConversationObservation>>;
        jobs: ReturnType<typeof createJobs>;
      }
    >();
    const subagents = createSubagentController({
      harness,
      parent: conversation,
      parentSessionId: lease.id,
      state: subagentsDefinition,
      restored: state.get("subagents") as
        | import("../tools/subagents/state.ts").SubagentIdentity[]
        | undefined,
      forkAt: () =>
        observation
          ?.view()
          .entries.findLast((entry) =>
            entry.model?.some(
              (message) => message.role === "assistant" && message.stopReason === "stop",
            ),
          )?.id,
      async beforeStart(request, child, ctx) {
        const result = await hooks.run(
          "SubagentStart",
          hookInput({
            agent_id: request.agentId,
            agent_type: request.type,
            prompt: request.prompt,
          }),
          { signal: ctx.abortSignal, matchQuery: request.type },
        );
        for (const content of result.additionalContext)
          await child.commit(
            (tx) =>
              tx.appendEntry(
                child.id,
                reminderEntry({
                  role: "system-reminder",
                  source: "hook:SubagentStart",
                  content,
                  timestamp: Date.now(),
                }),
              ),
            ctx,
          );
        await applyHookResult({ ...result, additionalContext: [] }, "hook:SubagentStart", ctx);
        return result.continue === false
          ? { stop: result.stopReason ?? "Stopped by SubagentStart hook." }
          : undefined;
      },
      async childAgent(type, child) {
        const selected = type.model
          ? selectedModel(type.model)
          : settings.subagentModel
            ? selectedModel(settings.subagentModel)
            : model;
        const directory = subagents.list().find((row) => row.conversationId === Number(child.id));
        const description = directory?.description ?? type.description;
        const childId = directory?.id ?? String(child.id);
        const childState = await createToolState(definitions, harness, child, context);
        await child.commit(async (tx) => {
          const facts = await tx.doc(ChildFactsDoc, child.id);
          facts.title ||= description;
          facts.description = description;
        }, context);
        const childJobs = childResources.get(Number(child.id))?.jobs ?? createJobs();
        const childTracking = createFileTracking(cwd, {
          initialState: childState.get("file-tracking"),
          persist: async (value, reminder) => {
            await childState.set(
              "file-tracking",
              value,
              context,
              reminder ? reminderEntry(reminder) : undefined,
            );
          },
        });
        let childTools: ToolRegistration[] = [];
        const childGate = createPermissionGate({
          cwd,
          homeDir: options.homeDir,
          rules: parsePermissionRules({
            ...settings.permissions,
            allow: [...(settings.permissions?.allow ?? []), ...(options.allowRules ?? [])],
          }),
          sessionAllowRules: options.sessionAllowRules,
          getMode: () => permissionMode,
          getTools: () => childTools,
          getMessages: async () => {
            const view = await conversation.context(context);
            const inputs = await lease.storage.scanSubmissions(
              { conversationId: conversation.id },
              100000,
              undefined,
              context,
            );
            const human = new Set(
              inputs.items.flatMap((record) =>
                record.requestId?.startsWith("human:") && record.entry ? [record.entry] : [],
              ),
            );
            return view.entries.flatMap((entry) =>
              (entry.model ?? []).filter(
                (message) =>
                  message.role === "assistant" || (message.role === "user" && human.has(entry.id)),
              ),
            );
          },
          getProjectInstructions: () => [],
          getReviewModel: () => async () =>
            settings.reviewModel ? selectedModel(settings.reviewModel) : selected,
          models,
          onPermissionAsk: options.onPermissionAsk,
          onInteractionStart: notifyInteraction,
          onToolCallAllowed: async (call) => {
            await checkpoints.record(call, cwd, options.homeDir);
            await options.onToolCallAllowed?.(call);
          },
          onEvent: (event) => custom(event),
          setMode: (value) => {
            permissionMode = value;
          },
          onHookWarning: warn,
          isRunStopped: () => false,
          stopRun: () => {},
          isMcpAuthTool: (name) => mcp.authTools.has(name),
        });
        const beforeInput = await child.context(context);
        for (const reminder of await collectReminders({
          messages: transcriptMessages(beforeInput.entries),
          cwd,
          homeDir: options.homeDir,
          now: options.now?.() ?? new Date(),
          sources: [
            ...childState.reminderSources,
            {
              source: "plan-mode",
              currentContent: () =>
                plan.getActive() ? planModeReminder(!!options.onPlanReview) : undefined,
            },
          ],
        }))
          await child.commit((tx) => tx.appendEntry(child.id, reminderEntry(reminder)), context);
        const rawTools = [
          ...createBuiltinTools({
            cwd,
            homeDir: options.homeDir,
            jobs: childJobs,
            getSkill: (name) => skills.get(name),
            setTodo: async (todos) => {
              await childState.set("todo", todos, context);
            },
            onQuestion: options.onQuestion,
            onInteractionStart: notifyInteraction,
            webFetch: options.webFetch,
            fileTracking: childTracking,
          }),
          ...mcp.tools,
        ];
        childTools = rawTools.map((tool) => ({
          ...tool,
          async execute(args, api, ctx) {
            await childGate.authorizeExecute(
              {
                type: "toolCall",
                id: api.callId,
                name: tool.name,
                arguments: args as Record<string, JsonValue>,
              },
              args as Record<string, unknown>,
              api,
              ctx,
            );
            return tool.execute(args, api, ctx);
          },
        }));
        const extension = {
          name: `rukie.child.${child.id}`,
          tools: childTools,
          hooks: [
            hook(ToolTask, { beforeTool: childGate.beforeTool }),
            hook(GenerationTask, {
              beforeRequest: async (_request, _api, ctx) => {
                const view = await child.context(ctx);
                const reminders = await collectReminders({
                  messages: transcriptMessages(view.entries),
                  cwd,
                  homeDir: options.homeDir,
                  now: options.now?.() ?? new Date(),
                  sources: [
                    ...childState.reminderSources,
                    childTracking.reminderSource,
                    {
                      source: "plan-mode",
                      currentContent: () =>
                        plan.getActive() ? planModeReminder(!!options.onPlanReview) : undefined,
                    },
                  ],
                });
                for (const reminder of reminders)
                  if (reminder.source === "file-changes")
                    await childTracking.persistReminder(reminder);
                  else
                    await child.commit(
                      (tx) => tx.appendEntry(child.id, reminderEntry(reminder)),
                      ctx,
                    );
                childTracking.finishRequest();
                return { messages: (await child.context(ctx)).messages };
              },
              afterTools: async (_assistant, results, _api, ctx) => {
                const committed = await Promise.all(
                  results.map((id) => lease.storage.entry(id, ctx)),
                );
                await childTracking.commitResults(
                  committed.flatMap(
                    (value) =>
                      value?.entry.model?.flatMap((message) =>
                        message.role === "toolResult" && !message.isError
                          ? [message.toolCallId]
                          : [],
                      ) ?? [],
                  ),
                );
              },
            }),
          ],
        };
        registry.install(extension);
        const previous = childResources.get(Number(child.id));
        if (!previous) {
          const childObservation = await createConversationObservation({
            harness,
            conversation: child,
            sessionId: childId,
            tools: () => childTools,
            adopt: (publication) => {
              childState.adopt(publication);
            },
            facts: () => ({
              toolStates: childState.snapshot(),
              runSummaries: [],
              model: `${selected.provider}/${selected.id}`,
              planMode: plan.getActive(),
              background: [],
            }),
            publish: (events) => {
              for (const event of events)
                if (event.type !== "request_settled")
                  custom({
                    type: "subagent_event",
                    agentId: childId,
                    description,
                    subagentType: type.name,
                    event,
                  });
            },
          });
          childResources.set(Number(child.id), { observation: childObservation, jobs: childJobs });
        }
        return {
          model: { provider: selected.provider, modelId: selected.id },
          cwd,
          instructions: SYSTEM_PROMPT,
          extensions: [extension],
          tools: childTools,
        };
      },
    });
    failedCleanup.push(async () => {
      subagents.close();
      for (const resource of childResources.values()) {
        await resource.observation.close();
        await resource.jobs.dispose(true);
      }
    });
    async function prepareReminders(ctx = context) {
      const sources: ReminderSource[] = [
        { source: "skills", currentContent: () => skillsReminder(skills) },
        {
          source: "mcp",
          currentContent: () =>
            mcp.hasServers
              ? mcp.reminder()
              : observation
                    ?.messages()
                    .some(
                      (message) => message.role === "system-reminder" && message.source === "mcp",
                    )
                ? "MCP servers: none."
                : undefined,
        },
        {
          source: "plan-mode",
          currentContent: () =>
            plan.getActive()
              ? planModeReminder(!!options.onPlanReview)
              : plan.hasEntered()
                ? "You have exited Plan Mode."
                : undefined,
        },
        ...state.reminderSources,
        tracking.reminderSource,
        ...(options.reminderSources ?? []),
      ];
      const reminders = await collectReminders({
        messages: observation
          ? [...observation.messages()]
          : transcriptMessages((await conversation.context(ctx)).entries),
        cwd,
        homeDir: options.homeDir,
        now: options.now?.() ?? new Date(),
        sources,
      });
      for (const reminder of reminders)
        if (reminder.source === "file-changes") await tracking.persistReminder(reminder);
        else await appendReminder(reminder, ctx);
      tracking.finishRequest();
    }
    const rebuildTools = async (reportDiscovery = false) => {
      skills = (await discoverSkills(cwd, options.homeDir)).skills;
      const base = createBaseTools({
        isChild: false,
        builtin: {
          cwd,
          homeDir: options.homeDir,
          jobs,
          getSkill: (name) => skills.get(name),
          setTodo: async (todos: TodoItem[]) => {
            await state.set("todo", todos, context);
          },
          onQuestion: options.onQuestion,
          onInteractionStart: notifyInteraction,
          webFetch: options.webFetch,
          fileTracking: tracking,
        },
        planMode: {
          controller: plan,
          onPlanReview: options.onPlanReview,
          onInteractionStart: notifyInteraction,
        },
        goal: {
          controller: goal,
          execution: {
            directHuman: () => !goalRound,
            goalRound: () => goalRound,
            wrapup: (text) => {
              wrapup = text;
            },
          },
        },
      });
      tools = [
        ...base,
        ...createSubagentTools({ isChild: false, controller: subagents }),
        ...mcp.tools,
      ].map((tool) => ({
        ...tool,
        async execute(args, api, ctx) {
          const call: ToolCall = {
            type: "toolCall",
            id: api.callId,
            name: tool.name,
            arguments: args as Record<string, JsonValue>,
          };
          await gate.authorizeExecute(call, args as Record<string, unknown>, api, ctx);
          return tool.execute(args, api, ctx);
        },
      }));
      const extension = {
        name: "rukie.session",
        tools,
        hooks: [
          hook(ToolTask, {
            beforeTool: gate.beforeTool,
            afterTool: async (call, result, api, ctx) => {
              const changed = await hooks.run(
                result.isError ? "PostToolUseFailure" : "PostToolUse",
                hookInput({
                  tool_name: call.name,
                  tool_input: call.arguments,
                  tool_response: result.content,
                  tool_use_id: call.id,
                }),
                { signal: ctx.abortSignal, matchQuery: call.name },
              );
              await applyHookResult(changed, "hook:PostToolUse", ctx);
              if (changed.decision === "block" && changed.reason)
                return {
                  ...result,
                  content: [
                    ...result.content,
                    {
                      type: "text" as const,
                      text: `<system-reminder>\n${changed.reason}\n</system-reminder>`,
                    },
                  ],
                };
              return "updatedToolOutput" in changed && changed.updatedToolOutput
                ? { ...result, content: changed.updatedToolOutput }
                : result;
            },
          }),
          hook(GenerationTask, {
            beforeRequest: async (_request, api, ctx) => {
              const live = await harness.snapshot(LiveDoc, conversation.id, ctx);
              if (live?.run) {
                if (goal.view()?.armed)
                  await conversation.commit(async (tx) => {
                    const activation = await tx.doc(GoalActivationDoc, conversation.id);
                    activation.taskId = Number(live.run!.taskId);
                    activation.requestId = currentRequestId ?? null;
                  }, ctx);
                const placed = await Promise.all(
                  live.run.inputs.map((id) => lease.storage.submission(id, ctx)),
                );
                for (const record of placed)
                  if (record?.requestId) {
                    let requestId = record.requestId;
                    const report = /^subagent:(\d+):report$/.exec(requestId);
                    if (report) {
                      const all = await lease.storage.scanTasks({}, 100000, undefined, ctx);
                      const driver = all.items.find(
                        (task) => Number(task.id) === Number(report[1]),
                      );
                      const original = driver && (await causalRequestForTask(driver, all.items));
                      if (original) requestId = original;
                    }
                    await harness.commit(async (tx) => {
                      const doc = await tx.doc(RequestDoc);
                      doc.requests[requestId] ??= {
                        submissions: [],
                        tasks: [],
                        startedAt: Date.now(),
                        result: null,
                      };
                      const request = doc.requests[requestId]!;
                      if (!request.submissions.includes(Number(record.id)))
                        request.submissions.push(Number(record.id));
                      if (!request.tasks.includes(Number(live.run!.taskId)))
                        request.tasks.push(Number(live.run!.taskId));
                    }, ctx);
                  }
              }
              for (const id of live?.run?.inputs ?? []) {
                const record = await lease.storage.submission(id, ctx);
                if (
                  record?.requestId?.startsWith("human:") &&
                  record.status !== "queued" &&
                  record.entry &&
                  !checkpoints
                    .list()
                    .some((checkpoint) => checkpoint.promptEntryId === String(record.entry))
                )
                  await checkpoints.start(String(record.entry));
              }
              if (wrapup) {
                const content = wrapup;
                const timestamp = Date.now();
                await conversation.commit(async (tx) => {
                  const placed = await tx.appendEntry(conversation.id, {
                    kind: "rukie.goal-wrapup",
                    model: [
                      { role: "user", content: [{ type: "text", text: content }], timestamp },
                    ],
                  });
                  await tx.appendEntry(conversation.id, {
                    kind: "rukie.message-facts",
                    data: { entryId: Number(placed.id), source: "goal" },
                  });
                }, ctx);
                wrapup = undefined;
              }
              await prepareReminders(ctx);
              contextMessages = (await conversation.context(ctx)).messages;
              return { messages: contextMessages };
            },
            afterResponse: async (message, api, ctx) => {
              const measured = {
                content: structuredClone(message.content),
                rukieThinkingDurationMs: undefined as number | undefined,
              };
              thinking.update(measured);
              thinking.settle(measured);
              if (measured.rukieThinkingDurationMs !== undefined)
                await conversation.commit(
                  (tx) =>
                    tx.appendEntry(conversation.id, {
                      kind: "rukie.message-facts",
                      data: {
                        taskId: Number(api.taskId),
                        timestamp: message.timestamp,
                        thinkingDurationMs: measured.rukieThinkingDurationMs!,
                      },
                    }),
                  ctx,
                );
            },
            afterTools: async (_assistant, results, _api, ctx) => {
              const committed = await Promise.all(
                results.map((id) => lease.storage.entry(id, ctx)),
              );
              await tracking.commitResults(
                committed.flatMap(
                  (value) =>
                    value?.entry.model?.flatMap((message) =>
                      message.role === "toolResult" && !message.isError ? [message.toolCallId] : [],
                    ) ?? [],
                ),
              );
            },
            onYield: async (_answer, api, ctx) => {
              const continuation = async (content: string, source: string) => {
                await conversation.commit(
                  (tx) =>
                    tx.appendEntry(conversation.id, {
                      kind: "rukie.message-facts",
                      data: { taskId: Number(api.taskId), content, source },
                    }),
                  ctx,
                );
                return { continue: content };
              };
              if (wrapup) {
                const content = wrapup;
                wrapup = undefined;
                return continuation(content, "goal");
              }
              const result = await hooks.run("Stop", hookInput({ stop_hook_active: false }), {
                signal: ctx.abortSignal,
              });
              await applyHookResult(result, "hook:Stop", ctx);
              if (result.decision === "block" && result.reason) {
                custom({ type: "hook_continued", event: "Stop", reason: result.reason });
                return continuation(result.reason, "hook");
              }
              const active = goal.view();
              if (active?.armed && active.phase === "active" && !stopped) {
                const content = renderGoalRoundPrompt(active);
                await goal.startRound();
                if (goal.view()?.phase === "active") {
                  goalRound = true;
                  return continuation(content, "goal");
                }
              }
              return undefined;
            },
          }),
        ],
      };
      registry.install(subagents.extension);
      registry.install(extension);
      await refreshSubagentTypes({
        cwd,
        homeDir: options.homeDir,
        trusted: isTrustedProject(cwd, settings),
        tools: tools.filter(
          (tool) =>
            ![
              "subagent",
              "subagent_fork",
              "send_message",
              "list_agents",
              "goal",
              "enter_plan_mode",
              "exit_plan_mode",
            ].includes(tool.name),
        ),
        controller: subagents,
        report: reportDiscovery
          ? (discovery) => {
              for (const warning of discovery.warnings) warn(warning);
            }
          : undefined,
      });
      await conversation.configure(
        { extensions: [extension, subagents.extension], tools },
        context,
      );
    };
    await rebuildTools();
    contextMessages = (await conversation.context(context)).messages;
    observation = await createConversationObservation({
      harness,
      conversation,
      sessionId: lease.id,
      tools: () => tools,
      adopt: (publication) => {
        state.adopt(publication);
        for (const change of publication.changes) {
          if (
            change.type === "document" &&
            change.conversationId === conversation.id &&
            change.record.kind === "pi.agent" &&
            change.value
          ) {
            const stored = change.value.model;
            if (
              stored &&
              typeof stored === "object" &&
              !Array.isArray(stored) &&
              typeof stored.provider === "string" &&
              typeof stored.modelId === "string"
            )
              modelFact = `${stored.provider}/${stored.modelId}`;
          }
          if (
            change.type === "document" &&
            change.conversationId === conversation.id &&
            change.record.kind === "pi.live" &&
            change.value
          ) {
            const value = change.value;
            const run = value.run;
            const generation = value.generation;
            if (
              run &&
              typeof run === "object" &&
              !Array.isArray(run) &&
              typeof run.taskId === "number" &&
              thinkingTask !== run.taskId
            ) {
              thinkingTask = run.taskId;
              thinking.start();
            }
            if (generation && typeof generation === "object" && !Array.isArray(generation)) {
              const message = generation.message;
              if (
                message &&
                typeof message === "object" &&
                !Array.isArray(message) &&
                Array.isArray(message.content)
              ) {
                const blocks = message.content.flatMap((block) =>
                  block &&
                  typeof block === "object" &&
                  !Array.isArray(block) &&
                  typeof block.type === "string"
                    ? [
                        {
                          type: block.type,
                          ...(typeof block.text === "string" ? { text: block.text } : {}),
                          ...(typeof block.thinking === "string"
                            ? { thinking: block.thinking }
                            : {}),
                        },
                      ]
                    : [],
                );
                thinking.update({ content: blocks });
              }
            }
          }
          if (
            change.type === "entry" &&
            change.value.conversationId === conversation.id &&
            change.value.kind === "rukie.run-summary"
          ) {
            const value = change.value.data;
            if (
              value &&
              typeof value === "object" &&
              !Array.isArray(value) &&
              typeof value.afterMessage === "number" &&
              typeof value.durationMs === "number" &&
              typeof value.endedAt === "number" &&
              typeof value.success === "boolean"
            )
              runSummaries = [
                ...runSummaries,
                {
                  afterMessage: value.afterMessage,
                  durationMs: value.durationMs,
                  endedAt: value.endedAt,
                  success: value.success,
                },
              ];
          }
        }
      },
      facts: () => ({
        toolStates: state.snapshot(),
        runSummaries,
        model: modelFact,
        planMode: !!(state.get("plan") as { active?: boolean } | undefined)?.active,
        background: subagents.list().map((row) => ({
          id: row.id,
          description: row.description,
          subagentType: row.type,
          active: row.active ?? false,
        })),
      }),
      publish: (events) => {
        for (const event of events) {
          emit(event);
          if (
            event.type === "run_start" ||
            (event.type === "message_end" &&
              event.messages.some((message) => message.role === "assistant"))
          )
            custom(
              contextUsage(
                observation.view().entries.flatMap((entry) => entry.model ?? []),
                model.contextWindow,
                latestInputTokens(),
              ),
            );
        }
      },
    });
    const unregister = registerSessionReader(store, lease.id, async () => {
      const value = await harness.snapshot(SessionMetadataDoc, context);
      if (!value) throw new Error("Session metadata missing.");
      return {
        id: lease.id,
        title: value.title,
        titleSource: value.titleSource,
        updatedAt: value.updatedAt,
        messageCount: observation.messages().length,
        model: value.model,
      };
    });
    const readRequest = async (requestId: string) =>
      (await harness.snapshot(RequestDoc, context))?.requests[requestId];
    const registerSubmission = async (requestId: string, submissionId: SubmissionId) => {
      await harness.commit(async (tx) => {
        const doc = await tx.doc(RequestDoc);
        doc.requests[requestId] ??= {
          submissions: [],
          tasks: [],
          startedAt: Date.now(),
          result: null,
        };
        const request = doc.requests[requestId]!;
        if (!request.submissions.includes(Number(submissionId)))
          request.submissions.push(Number(submissionId));
      }, context);
    };
    const resultFor = async (
      requestId: string,
      submissionId: SubmissionId,
    ): Promise<RequestResult> => {
      const submission = await harness.submission(submissionId, context);
      if (!submission) throw new Error(`Request submission missing: ${requestId}`);
      const receipt = await Promise.race([submission.wait(context), storageFault.promise]);
      const view = await conversation.context(context);
      contextMessages = view.messages;
      const usage = zeroUsage();
      for (const entry of view.entries)
        if (receipt.entry && entry.id >= receipt.entry)
          for (const message of entry.model ?? [])
            if (message.role === "assistant") {
              usage.input += message.usage.input;
              usage.output += message.usage.output;
              usage.cacheRead += message.usage.cacheRead;
              usage.cacheWrite += message.usage.cacheWrite;
              usage.totalTokens += message.usage.totalTokens;
            }
      const answer =
        receipt.status === "done" && receipt.type === "input"
          ? await lease.storage.entry(receipt.answer, context)
          : undefined;
      const text =
        answer?.entry.model
          ?.filter((message) => message.role === "assistant")
          .map(textOf)
          .join("") ?? "";
      const request = await readRequest(requestId);
      await observation.flush();
      return {
        requestId,
        text,
        success: receipt.status === "done",
        usage,
        durationMs: Date.now() - (request?.startedAt ?? Date.now()),
        ...(receipt.status === "unanswered" ? { error: receipt.reason } : {}),
      };
    };
    async function submit(
      prompt: string,
      images: PromptImage[] = [],
      whenBusy: "reject" | "steer" | "followUp" = "reject",
      requestId = `human:${randomUUID()}`,
      signal?: AbortSignal,
    ) {
      assertAvailable();
      images.forEach(validateImage);
      const hookResult = await hooks.run("UserPromptSubmit", hookInput({ prompt }), { signal });
      signal?.throwIfAborted();
      await applyHookResult(hookResult, "hook:UserPromptSubmit");
      if (hookResult.decision === "block") {
        const reason = hookResult.reason ?? "Prompt blocked by hook.";
        const result: RequestResult = {
          requestId,
          text: "",
          success: false,
          error: reason,
          usage: zeroUsage(),
          durationMs: 0,
        };
        await harness.commit(async (tx) => {
          const requests = await tx.doc(RequestDoc);
          requests.requests[requestId] = {
            submissions: [],
            tasks: [],
            startedAt: Date.now(),
            result: { ...result, usage: { ...result.usage } },
          };
          await tx.appendEntry(conversation.id, {
            kind: "rukie.notice",
            data: {
              role: "session-notice",
              notice: { kind: "hook_blocked", reason },
              timestamp: Date.now(),
            },
          });
        }, context);
        throw new PromptHookBlocked(result);
      }
      await prepareReminders();
      await title.firstPrompt(prompt);
      const invocation = skillInvocation(prompt, skills);
      if (invocation)
        await appendReminder({
          role: "system-reminder",
          source: "skill-invocation",
          content: invocation,
          timestamp: Date.now(),
        });
      const content: UserMessage["content"] = [
        { type: "text", text: prompt },
        ...images.map((image) => ({
          type: "image" as const,
          data: image.data,
          mimeType: image.mimeType,
        })),
      ];
      const submitted = await conversation.submit(
        { type: "input", content, requestId, whenBusy },
        context,
      );
      currentRequestId = requestId;
      await registerSubmission(requestId, submitted.id);
      const record = await submitted.status(context);
      if (record.entry && (images.length || invocation || !requestId.startsWith("human:")))
        await conversation.commit(
          (tx) =>
            tx.appendEntry(conversation.id, {
              kind: "rukie.message-facts",
              data: {
                entryId: Number(record.entry),
                ...(images.length ? { imageNames: images.map((image) => image.name ?? null) } : {}),
                ...(invocation ? { skillInvocation: invocation } : {}),
                ...(!requestId.startsWith("human:")
                  ? { source: requestId.startsWith("goal:") ? "goal" : "hook" }
                  : {}),
              },
            }),
          context,
        );
      return submitted;
    }
    async function startGoal() {
      const active = goal.view();
      if (!active?.armed || active.phase !== "active") return;
      goalRound = true;
      const requestId = `goal:${active.id}:${active.roundsStarted + 1}`;
      const prompt = renderGoalRoundPrompt(active);
      await goal.startRound();
      await submit(prompt, [], "followUp", requestId);
      return requestId;
    }
    function modelMessages(): readonly Message[] {
      return observation.view().entries.flatMap((entry) => entry.model ?? []);
    }
    function latestInputTokens() {
      const entries = observation.view().entries;
      const compacted = Math.max(
        0,
        ...entries
          .filter((entry) => entry.kind === "pi.compaction")
          .map((entry) => Number(entry.id)),
      );
      const last = entries
        .filter((entry) => Number(entry.id) > compacted)
        .flatMap((entry) => entry.model ?? [])
        .findLast(
          (message) =>
            message.role === "assistant" &&
            message.provider === model.provider &&
            message.model === model.id,
        );
      return last?.role === "assistant"
        ? last.usage.input + last.usage.cacheRead + last.usage.cacheWrite || undefined
        : undefined;
    }
    async function causalRequestForTask(
      task: import("@earendil-works/pi-durable").TaskRecord<JsonValue, JsonValue, JsonValue>,
      tasks: readonly import("@earendil-works/pi-durable").TaskRecord<
        JsonValue,
        JsonValue,
        JsonValue
      >[],
    ) {
      const requests = (await harness.snapshot(RequestDoc, context))?.requests ?? {};
      let current: typeof task | undefined = task;
      const visited = new Set<number>();
      while (current && !visited.has(Number(current.id))) {
        visited.add(Number(current.id));
        for (const [id, request] of Object.entries(requests))
          if (request.tasks.includes(Number(current.id))) return id;
        const input: JsonValue = current.input;
        const origin: number | undefined =
          input &&
          typeof input === "object" &&
          !Array.isArray(input) &&
          typeof input.originToolTaskId === "number"
            ? input.originToolTaskId
            : undefined;
        const parent: number | undefined = current.owner ?? origin;
        current =
          parent === undefined
            ? undefined
            : tasks.find((record) => Number(record.id) === Number(parent));
      }
      return undefined;
    }
    const session: Session = {
      get running() {
        return observation.running();
      },
      get currentRequestId() {
        return currentRequestId;
      },
      id: lease.id,
      get title() {
        return title.title;
      },
      get titleSource() {
        return title.source;
      },
      rename: (value) => title.rename(value),
      get model() {
        return `${model.provider}/${model.id}`;
      },
      async setModel(spec) {
        assertAvailable(true);
        const slash = spec.indexOf("/");
        const next = models.getModel(spec.slice(0, slash), spec.slice(slash + 1));
        if (!next) throw new Error(`Unknown model: ${spec}`);
        await conversation.configure(
          { model: { provider: next.provider, modelId: next.id } },
          context,
        );
        model = next;
        await state.set("model", spec, context);
        await writeMetadata();
      },
      get permissionMode() {
        return permissionMode;
      },
      setPermissionMode: (value) => {
        permissionMode = value;
      },
      get planMode() {
        return plan.getActive();
      },
      setPlanMode: (value) => plan.setMode(value),
      get goal() {
        return goal.view();
      },
      createGoal: async (objective, input) => {
        await goal.create(objective, input);
        const requestId = await startGoal();
        if (!requestId) throw new Error("Created Goal did not admit its initial request.");
        return { ...goal.view()!, requestId };
      },
      editGoal: (objective) => goal.edit(objective),
      pauseGoal: () => goal.pause(),
      resumeGoal: async () => {
        const value = await goal.resume();
        const requestId = await startGoal();
        return { ...value, ...(requestId ? { requestId } : {}) };
      },
      clearGoal: () => goal.clear(),
      subscribe(listener) {
        listeners.add(listener);
        listener(observation.snapshot());
        return () => listeners.delete(listener);
      },
      get messages() {
        return observation.messages();
      },
      toolState: (name) => state.get(name),
      runSummaries: () => runSummaries,
      contextUsage: () => contextUsage(modelMessages(), model.contextWindow, latestInputTokens()),
      contextReport: () =>
        contextReport({
          messages: modelMessages(),
          inputTokens: latestInputTokens(),
          entries: observation.view().entries,
          model: `${model.provider}/${model.id}`,
          window: model.contextWindow,
          mcpServers: mcp.toolServers,
        }),
      sideQuestion(question, input) {
        assertAvailable();
        if (!question.trim())
          throw createUserVisibleError("Side question cannot be empty.", {
            code: "side-question-empty",
            params: {},
          });
        const captured = conversation.context(context);
        const running = new Set(
          observation
            .snapshot()
            .tools?.filter((tool) => tool.status !== "done")
            .map((tool) => tool.callId) ?? [],
        );
        const selected = model;
        const signal = input?.signal
          ? AbortSignal.any([input.signal, auxiliaryLifetime.signal])
          : auxiliaryLifetime.signal;
        return (async function* () {
          const view = await captured;
          yield* sideQuestion({
            question,
            messages: view.messages,
            systemPrompt: SYSTEM_PROMPT,
            model: selected,
            models,
            running,
            signal,
          });
        })();
      },
      jobs: () => jobs.list(),
      readJob(id, offset) {
        const job = jobs.get(id);
        if (!job) throw new Error(`Unknown job: ${id}`);
        return { ...job.read(offset), job: job.view };
      },
      async killJob(id) {
        const job = jobs.get(id);
        if (!job) throw new Error(`Unknown job: ${id}`);
        job.kill("user");
        await job.completed;
      },
      async mcpServers(input) {
        if (input?.refresh) {
          assertAvailable(true);
          await mcp.connect({
            cwd,
            homeDir: options.homeDir,
            settings,
            trustProjectMcp: options.trustProjectMcp,
            onWarning: warn,
          });
          await rebuildTools();
        }
        return mcp.snapshot();
      },
      async authenticateMcp(name) {
        assertAvailable(true);
        const result = await mcp.authenticate(name);
        await rebuildTools();
        return result;
      },
      async clearMcpAuth(name) {
        assertAvailable(true);
        await mcp.clearAuth(name);
        await rebuildTools();
      },
      async reconnectMcp(name) {
        assertAvailable(true);
        await mcp.connect({
          cwd,
          homeDir: options.homeDir,
          settings,
          onlyServer: name,
          reconnect: true,
          trustProjectMcp: options.trustProjectMcp,
          onWarning: warn,
        });
        await rebuildTools();
      },
      async compact(input) {
        assertAvailable(true);
        const id = await conversation.compact(input?.instructions, context);
        await harness.waitForTask(id, context);
        contextMessages = (await conversation.context(context)).messages;
        await observation.flush();
      },
      checkpoints: () => checkpoints.list(),
      async rewind(id, input) {
        assertAvailable(true);
        const inspection = await harness.inspect(context);
        if (inspection.tasks.length)
          throw new Error("Rewind requires all related work to be settled.");
        const prompt = checkpoints.prompt(id);
        const code = input.code ? await checkpoints.restoreCode(id) : { restored: [], deleted: [] };
        if (input.conversation) {
          const entries = observation.view().entries;
          const index = entries.findIndex((entry) => String(entry.id) === id);
          const previous = entries[index - 1];
          if (!previous) throw new Error("Checkpoint has no prior entry anchor.");
          const fork = await conversation.fork(
            previous.id,
            { ownership: { kind: "ownerless" } },
            context,
          );
          await observation.close();
          conversation = fork;
          await writeMetadata();
          state = await createToolState(definitions, harness, conversation, context);
          plan.restore();
          tracking.restore(state.get("file-tracking"));
          goal.disarm();
          await rebuildTools();
          observation = await createConversationObservation({
            harness,
            conversation,
            sessionId: lease.id,
            tools: () => tools,
            adopt: (publication) => {
              state.adopt(publication);
              for (const change of publication.changes) {
                if (
                  change.type === "document" &&
                  change.conversationId === conversation.id &&
                  change.record.kind === "pi.agent" &&
                  change.value
                ) {
                  const stored = change.value.model;
                  if (
                    stored &&
                    typeof stored === "object" &&
                    !Array.isArray(stored) &&
                    typeof stored.provider === "string" &&
                    typeof stored.modelId === "string"
                  )
                    modelFact = `${stored.provider}/${stored.modelId}`;
                }
                if (
                  change.type === "document" &&
                  change.conversationId === conversation.id &&
                  change.record.kind === "pi.live" &&
                  change.value
                ) {
                  const value = change.value;
                  const run = value.run;
                  const generation = value.generation;
                  if (
                    run &&
                    typeof run === "object" &&
                    !Array.isArray(run) &&
                    typeof run.taskId === "number" &&
                    thinkingTask !== run.taskId
                  ) {
                    thinkingTask = run.taskId;
                    thinking.start();
                  }
                  if (generation && typeof generation === "object" && !Array.isArray(generation)) {
                    const message = generation.message;
                    if (
                      message &&
                      typeof message === "object" &&
                      !Array.isArray(message) &&
                      Array.isArray(message.content)
                    ) {
                      const blocks = message.content.flatMap((block) =>
                        block &&
                        typeof block === "object" &&
                        !Array.isArray(block) &&
                        typeof block.type === "string"
                          ? [
                              {
                                type: block.type,
                                ...(typeof block.text === "string" ? { text: block.text } : {}),
                                ...(typeof block.thinking === "string"
                                  ? { thinking: block.thinking }
                                  : {}),
                              },
                            ]
                          : [],
                      );
                      thinking.update({ content: blocks });
                    }
                  }
                }
                if (
                  change.type === "entry" &&
                  change.value.conversationId === conversation.id &&
                  change.value.kind === "rukie.run-summary"
                ) {
                  const value = change.value.data;
                  if (
                    value &&
                    typeof value === "object" &&
                    !Array.isArray(value) &&
                    typeof value.afterMessage === "number" &&
                    typeof value.durationMs === "number" &&
                    typeof value.endedAt === "number" &&
                    typeof value.success === "boolean"
                  )
                    runSummaries = [
                      ...runSummaries,
                      {
                        afterMessage: value.afterMessage,
                        durationMs: value.durationMs,
                        endedAt: value.endedAt,
                        success: value.success,
                      },
                    ];
                }
              }
            },
            facts: () => ({
              toolStates: state.snapshot(),
              runSummaries,
              model: modelFact,
              planMode: !!(state.get("plan") as { active?: boolean } | undefined)?.active,
              background: subagents.list().map((row) => ({
                id: row.id,
                description: row.description,
                subagentType: row.type,
                active: row.active ?? false,
              })),
            }),
            publish: (events) => {
              for (const event of events) {
                emit(event);
                if (
                  event.type === "message_end" &&
                  event.messages.some((message) => message.role === "assistant")
                )
                  custom(
                    contextUsage(
                      observation.view().entries.flatMap((entry) => entry.model ?? []),
                      model.contextWindow,
                    ),
                  );
              }
            },
          });
          contextMessages = (await conversation.context(context)).messages;
        }
        return { prompt, ...code };
      },
      async readSubagent(id) {
        const child = await subagents.readChild(id, context);
        if (!child) return undefined;
        const facts = await harness.snapshot(ChildFactsDoc, child.conversation.id, context);
        const resource = childResources.get(Number(child.conversation.id));
        return {
          messages: resource?.observation.messages() ?? child.messages,
          historyMessages: child.historyMessages,
          title: facts?.title ?? child.description,
          description: child.description,
          model: child.model,
          run: child.run,
        };
      },
      interruptSubagent(id) {
        void subagents.interrupt(id, context).catch(warn);
      },
      async abort() {
        assertAvailable();
        stopped = true;
        goal.disarm();
        await conversation.abort(context);
        await observation.flush();
      },
      async steer(prompt, input) {
        await submit(prompt, input?.images, "steer");
      },
      async run(prompt, input = {}) {
        input.signal?.throwIfAborted();
        assertAvailable(true);
        stopped = false;
        goalRound = false;
        const abort = () => {
          stopped = true;
          goal.disarm();
          void conversation.abort(context).catch(warn);
        };
        input.signal?.addEventListener("abort", abort, { once: true });
        const off = input.onEvent
          ? session.subscribe((event) => {
              void Promise.resolve(input.onEvent!(event)).catch(warn);
            })
          : () => {};
        try {
          await rebuildTools();
          await mcp.connect({
            cwd,
            homeDir: options.homeDir,
            settings,
            trustProjectMcp: options.trustProjectMcp,
            interactive: !!options.onMcpAuth,
            onMcpAuth: options.onMcpAuth,
            onInteractionStart: notifyInteraction,
            onWarning: warn,
          });
          for (const event of [...mcp.errors, ...mcp.authRequired]) custom(event);
          await rebuildTools(true);
          input.signal?.throwIfAborted();
          const requestId = `human:${randomUUID()}`;
          const submission = await submit(prompt, input.images, "reject", requestId, input.signal);
          const result = await resultFor(requestId, submission.id);
          await conversation.commit(
            (tx) =>
              tx.appendEntry(conversation.id, {
                kind: "rukie.run-summary",
                data: {
                  afterMessage: observation.messages().length,
                  durationMs: result.durationMs,
                  endedAt: Date.now(),
                  success: result.success,
                },
              }),
            context,
          );
          await writeMetadata();
          custom({ type: "result", ...result });
          if (input.signal?.aborted) throw input.signal.reason;
          if (!result.success) throw new Error(result.error ?? "Run failed.");
          return result;
        } catch (error) {
          await observation.flush();
          if (error instanceof PromptHookBlocked) {
            custom({ type: "result", ...error.result });
            custom({ type: "request_settled", ...error.result });
            return error.result;
          }
          throw error;
        } finally {
          off();
          input.signal?.removeEventListener("abort", abort);
        }
      },
      async waitForRequest(requestId) {
        assertAvailable();
        const restored = await readRequest(requestId);
        if (restored?.result) return storedRequestResult(restored.result)!;
        let result: RequestResult | undefined;
        const childReceipts = new Map<
          number,
          import("@earendil-works/pi-durable").TaskRecord<JsonValue, JsonValue, JsonValue>
        >();
        for (;;) {
          const request = await readRequest(requestId);
          if (!request) throw new Error(`Unknown request: ${requestId}`);
          const submissions = await lease.storage.scanSubmissions({}, 100000, undefined, context);
          const ids = submissions.items
            .filter((record) => request.submissions.includes(Number(record.id)))
            .map((record) => record.id);
          if (!ids.length) throw new Error("Request has no submitted inputs.");
          const results = await Promise.all(ids.map((id) => resultFor(requestId, id)));
          result = results.at(-1)!;
          const tasks = (await lease.storage.scanTasks({}, 100000, undefined, context)).items;
          const drivers = [];
          for (const task of tasks)
            if (
              task.kind === "rukie.subagent-driver" &&
              (await causalRequestForTask(task, tasks)) === requestId
            )
              drivers.push(task);
          for (const driver of drivers) {
            const receipt = await Promise.race([
              harness.waitForTask(driver.id, context),
              storageFault.promise,
            ]);
            childReceipts.set(Number(driver.id), receipt);
          }
          const fresh = await readRequest(requestId);
          if (
            fresh &&
            fresh.submissions.length === request.submissions.length &&
            fresh.tasks.length === request.tasks.length
          )
            break;
        }
        const usage = { ...result!.usage };
        let answerId: number | undefined;
        for (const receipt of childReceipts.values()) {
          const outcome = receipt.state.outcome;
          const value = outcome && "result" in outcome ? outcome.result : undefined;
          if (!value || typeof value !== "object" || Array.isArray(value)) continue;
          if (typeof value.parentAnswer === "number")
            answerId = Math.max(answerId ?? 0, value.parentAnswer);
          const spend = value.usage;
          if (spend && typeof spend === "object" && !Array.isArray(spend))
            for (const key of [
              "input",
              "output",
              "cacheRead",
              "cacheWrite",
              "totalTokens",
            ] as const)
              if (typeof spend[key] === "number") usage[key] += spend[key];
        }
        let text = result!.text;
        if (answerId !== undefined) {
          const view = await conversation.context(context);
          const entry = view.entries.find((entry) => Number(entry.id) === answerId);
          if (entry)
            text = (entry.model ?? [])
              .filter((message) => message.role === "assistant")
              .map(textOf)
              .join("");
        }
        const settled = { ...result!, text, usage };
        await harness.commit(async (tx) => {
          const doc = await tx.doc(RequestDoc);
          doc.requests[requestId]!.result = { ...settled, usage: { ...settled.usage } };
        }, context);
        await observation.flush();
        custom({ type: "request_settled", ...settled });
        return settled;
      },
      async waitForIdle() {
        await conversation.waitForIdle(context);
        await observation.flush();
      },
      close(reason = "other") {
        return (closing ??= (async () => {
          if (closed) return;
          closed = true;
          auxiliaryLifetime.abort(new Error("Session closed"));
          let failure: unknown;
          const release = async (work: () => Promise<void>) => {
            try {
              await work();
            } catch (error) {
              failure ??= error;
            }
          };
          await release(() => title.dispose());
          await release(async () => {
            const result = await hooks.run("SessionEnd", hookInput({ reason }));
            await applyHookResult(result, "hook:SessionEnd");
          });
          hooks.dispose();
          await release(() => harness.close(context));
          await release(() => observation.close());
          subagents.close();
          for (const resource of childResources.values()) {
            await release(() => resource.observation.close());
            await release(() => resource.jobs.dispose(true));
          }
          await release(() => jobs.dispose(true));
          await release(() => mcp.close());
          await release(() => env.cleanup(context));
          unregister();
          await release(lease.release);
          listeners.clear();
          if (failure) throw failure;
        })());
      },
    };
    await cleanupExpiredBackups({
      homeDir: options.homeDir,
      sessionId: lease.id,
      now: options.now?.() ?? new Date(),
      onWarning: warn,
    });
    const startup = await hooks.run(
      "SessionStart",
      hookInput({ source: options.resumeId ? "resume" : "startup" }),
    );
    await applyHookResult(startup, "hook:SessionStart");
    await subagents.prepareChildren(context);
    const recovering = await harness.inspect(context);
    const requestValues = (await harness.snapshot(RequestDoc, context))?.requests ?? {};
    const allTasks = (await lease.storage.scanTasks({}, 100000, undefined, context)).items;
    for (const record of recovering.submissions)
      if (record.requestId && requestValues[record.requestId]) currentRequestId = record.requestId;
    if (!currentRequestId)
      for (const task of recovering.tasks) {
        const id = await causalRequestForTask(task.record, allTasks);
        if (id) currentRequestId = id;
      }
    harness.resume();
    return session;
  } catch (error) {
    for (const cleanup of failedCleanup.reverse()) {
      try {
        await cleanup();
      } catch {}
    }
    throw error;
  }
}
