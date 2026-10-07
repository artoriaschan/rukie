import { withHookTranscript, writeHookTranscript } from "../hooks/transcript.ts";
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
  CompactionTask,
  ToolTask,
  LiveDoc,
  InboxDoc,
  type SubmissionId,
  type TaskId,
  type ToolRegistration,
  type EntryDraft,
  type Storage,
  type EntryRecord,
  type Cursor,
  ROOT_CONVERSATION_ID,
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
import { modelContextMessages, transcriptMessages, type TranscriptMessage } from "./messages.ts";
const entryData = (entry: EntryRecord | undefined) => {
  const value = entry?.data;
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
};
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
  createMcpManager,
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
import { mergeHooks, createHooks, type CommonHookResult, type HookInput } from "../hooks/index.ts";
import type { WebFetchOptions } from "../tools/web-fetch/index.ts";
import { validateImage, type PromptImage } from "../images/index.ts";
import { SYSTEM_PROMPT } from "../prompt/index.ts";
import { createThinkingTiming } from "./thinking.ts";
import { createBuiltinTools } from "../tools/builtin.ts";
import { createSubagentController } from "../tools/subagents/index.ts";
import { createBaseTools, createSubagentTools, refreshSubagentTypes } from "./tools.ts";
import { createConversationObservation } from "./observation.ts";

type RequestResult = RunResult & { requestId: string };
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
        generation?: {
          attempt: number;
          message?: import("./messages.ts").TranscriptAssistantMessage;
        };
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
const HookContinuationDoc = defineDoc<{ taskId: number | null; count: number }>({
  kind: "rukie.hook-continuation",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ taskId: null, count: 0 }),
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
const CompactHookContextDoc = defineDoc<{ pending: string[]; afterEntry: number | null }>({
  kind: "rukie.compact-hook-context",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ pending: [], afterEntry: null }),
});
const HookYieldDoc = defineDoc<{ runAnchor: number | null; pending: string[] }>({
  kind: "rukie.hook-yield",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "initial",
  initial: () => ({ runAnchor: null, pending: [] }),
});
const JobStopsDoc = defineDoc<{ pending: Record<string, string> }>({
  kind: "rukie.job-stops",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "initial",
  initial: () => ({ pending: {} }),
});
const PlanTakeoverDoc = defineDoc<{ requests: Record<string, true> }>({
  kind: "rukie.plan-takeovers",
  version: 1,
  scope: "session",
  initial: () => ({ requests: {} }),
});
const HookStopsDoc = defineDoc<{ requests: Record<string, string> }>({
  kind: "rukie.hook-stops",
  version: 1,
  scope: "session",
  initial: () => ({ requests: {} }),
});
const PendingInputFactsDoc = defineDoc<{ inputs: Record<string, Record<string, JsonValue>> }>({
  kind: "rukie.pending-input-facts",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ inputs: {} }),
});
const ChildHookContextDoc = defineDoc<{ pending: { source: string; content: string }[] }>({
  kind: "rukie.child-hook-context",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "initial",
  initial: () => ({ pending: [] }),
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
    ...(value.stopReason === "hook_blocked" || value.stopReason === "hook_stopped"
      ? { stopReason: value.stopReason }
      : {}),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
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
  if (options.allowRules) parsePermissionRules({ allow: options.allowRules }, "--allow-tools");
  const permissionRules = parsePermissionRules({
    ...settings.permissions,
    allow: [...(settings.permissions?.allow ?? []), ...(options.allowRules ?? [])],
  });
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
          listener(structuredClone(event));
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
    const requestWaiters = new Map<string, Promise<RequestResult>>();
    let contextMessages: readonly Message[] = [];
    let runSummaries: RunSummaryFact[] = [];
    const thinking = createThinkingTiming(() => performance.now());
    let thinkingTask: number | undefined;
    let modelFact = `${model.provider}/${model.id}`;
    const auxiliaryLifetime = new AbortController();
    let notificationLifetime = new AbortController();
    let stopped = false;
    let hookStopReason: string | undefined;
    const toolDurations = new Map<string, number>();
    const executedInputs = new Map<string, Record<string, unknown>>();
    let startupStopReason: string | undefined;
    let selectingModel = false;
    let foregroundAdmission = false;
    let manualCompaction = false;
    let manualCompactionTask: TaskId | undefined;
    let goalRound = false;
    const steeringAdmissions = new Set<Promise<void>>();
    let checkingStop: number | undefined;
    let wrapup: string | undefined;
    let permissionMode = options.permissionMode ?? settings.permissionMode ?? "ask";
    const sessionAllowRules = options.sessionAllowRules ?? [];
    const sessionGrantListeners = new Set<() => void>();
    const permissionChecks = new Map<number, Promise<void>>();
    const serializePermissionChecks =
      (
        check: ReturnType<typeof createPermissionGate>["beforeTool"],
        conversationId: number,
      ): typeof check =>
      (...args) => {
        const checked = (permissionChecks.get(conversationId) ?? Promise.resolve()).then(() =>
          check(...args),
        );
        permissionChecks.set(
          conversationId,
          checked.then(
            () => {},
            () => {},
          ),
        );
        return checked;
      };
    let observation: Awaited<ReturnType<typeof createConversationObservation>>;
    let storageFailure: unknown;
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
              storageFailure = error;
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
          get compaction() {
            return {
              enabled: true,
              keepRecentTokens: Math.min(16000, Math.floor(model.contextWindow * 0.4)),
              reserveTokens: Math.min(16384, Math.floor(model.contextWindow * 0.2)),
              backgroundTokens: Math.min(32768, Math.floor(model.contextWindow * 0.25)),
            };
          },
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
        ...(settings.thinking ? { thinkingLevel: settings.thinking } : {}),
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
    const writeMetadata = async (title?: string, source?: TitleSource) => {
      await harness.commit(async (tx) => {
        const doc = await tx.doc(SessionMetadataDoc);
        Object.assign(doc, {
          id: lease.id,
          cwd,
          title: title ?? doc.title ?? "",
          titleSource: source ?? doc.titleSource ?? "prompt",
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
      if (storageFailure !== undefined) throw storageFailure;
      if (idle && mcpManager.busy)
        throw createUserVisibleError("Session is managing MCP servers.", {
          code: "session-mcp-busy",
          params: {},
        });
      if (idle && selectingModel) throw new Error("Session is switching models.");
      if (idle && (foregroundAdmission || manualCompaction || observation?.running()))
        throw new Error("Session is busy; it must be idle.");
    };
    let asyncAdmissions = Promise.resolve();
    const shutdownPublications = new Set<Promise<void>>();
    const rootHookRuntime = createHooks({
      callMcpTool: (...args) => mcp.callHookTool(...args),
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
      onEvent: (event) => {
        const publication = (async () => {
          if (event.type === "hook_warning")
            await appendNotice({
              kind: "hook_warning",
              event: event.event,
              hook: event.hook,
              message: event.message,
              ...(event.error ? { error: event.error } : {}),
            });
          custom(structuredClone(event));
        })();
        if ("event" in event && event.event === "SessionEnd") {
          shutdownPublications.add(publication);
          void publication.finally(() => shutdownPublications.delete(publication)).catch(warn);
        }
        return publication;
      },
      onAsyncResult: (result, reason) => {
        asyncAdmissions = asyncAdmissions
          .then(async () => {
            if (closed) return;
            await applyHookResult(result, "async-hook");
            for (const content of result.systemMessages)
              await appendReminder({
                role: "system-reminder",
                source: "async-hook",
                content,
                timestamp: Date.now(),
              });
            if (!reason) return;
            const live = await harness.snapshot(LiveDoc, conversation.id, context);
            if (live?.run && checkingStop === Number(live.run.inputs[0])) {
              await conversation.commit(async (tx) => {
                const pending = await tx.doc(HookYieldDoc, conversation.id);
                pending.runAnchor = checkingStop!;
                pending.pending.push(reason);
              }, context);
              return;
            }
            const parentRequestId = live?.run ? currentRequestId : undefined;
            const requestId = `hook:${randomUUID()}`;
            const submitted = await conversation.submit(
              {
                type: "input",
                content: reason,
                requestId,
                whenBusy: "steer",
              },
              context,
            );
            if (!parentRequestId) currentRequestId = requestId;
            await registerSubmission(parentRequestId ?? requestId, submitted.id);
            if (!parentRequestId)
              void resultFor(requestId, submitted.id)
                .then(async (result) => {
                  custom({ type: "result", ...result });
                  await session.waitForRequest(requestId);
                })
                .catch(warn);
            const record = await submitted.status(context);
            if (record.entry)
              await conversation.commit(
                (tx) =>
                  tx.appendEntry(conversation.id, {
                    kind: "rukie.message-facts",
                    data: { entryId: Number(record.entry), source: "hook" },
                  }),
                context,
              );
          })
          .catch(warn);
      },
    });
    const hookTranscriptPath = (id: string) =>
      join(store.key(lease.id), "hook-transcripts", `${encodeURIComponent(id)}.jsonl`);
    const hooks = withHookTranscript(
      rootHookRuntime,
      () => hookTranscriptPath(lease.id),
      async () => fullHistory(),
      !!settings.hooks && Object.values(settings.hooks).some((groups) => groups.length > 0),
      () => !closed,
    );
    const hookInput = (extra: Record<string, unknown> = {}): HookInput => ({
      session_id: lease.id,
      transcript_path: hookTranscriptPath(lease.id),
      cwd,
      permission_mode: permissionMode,
      model: `${model.provider}/${model.id}`,
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
      if (settings.hooks && Object.values(settings.hooks).some((groups) => groups.length > 0))
        await writeHookTranscript(hookTranscriptPath(lease.id), await fullHistory());
    }
    async function applyHookResult(result: CommonHookResult, source: string, ctx = context) {
      for (const text of result.systemMessages)
        await appendNotice({ kind: "hook_message", message: text }, ctx);
      for (const text of result.additionalContext)
        await appendReminder(
          { role: "system-reminder", source, content: text, timestamp: Date.now() },
          ctx,
        );
      if (result.continue === false) {
        stopped = true;
        hookStopReason = result.stopReason ?? "Stopped by hook.";
      }
    }
    const notifyInteraction: import("../interaction/index.ts").OnInteractionStart = async (
      notification,
      _signal,
    ) => {
      const result = await hooks.run("Notification", hookInput({ ...notification }), {
        // A completed tool invocation closes its native scope. Notification side
        // effects belong to the Run/Session, so only explicit cancellation ends them.
        signal: AbortSignal.any([auxiliaryLifetime.signal, notificationLifetime.signal]),
        matchQuery: notification.notification_type,
      });
      await applyHookResult(
        { systemMessages: result.systemMessages, additionalContext: result.additionalContext },
        "hook:Notification",
      );
    };
    const fullHistory = async (id = conversation.id) => {
      const entries: EntryRecord[] = [];
      let cursor: Cursor | undefined;
      do {
        const page = await lease.storage.scanEntries({ conversationId: id }, 256, cursor, context);
        entries.push(...page.items);
        cursor = page.next;
      } while (cursor);
      return entries.reverse();
    };
    const promptFacts = new Map<string, string>();
    const rememberPrompts = (entries: readonly EntryRecord[]) => {
      for (const entry of entries) {
        const users = entry.model?.filter((message) => message.role === "user");
        if (users?.length) promptFacts.set(String(entry.id), users.map(textOf).join(""));
      }
    };
    const initialHistory = await fullHistory();
    rememberPrompts(initialHistory);
    const readRunSummaries = (entries: readonly EntryRecord[]): RunSummaryFact[] =>
      entries.flatMap((entry) => {
        const value = entry.data;
        return entry.kind === "rukie.run-summary" &&
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          typeof value.afterMessage === "number" &&
          typeof value.durationMs === "number" &&
          typeof value.endedAt === "number" &&
          typeof value.success === "boolean"
          ? [
              {
                afterMessage: value.afterMessage,
                durationMs: value.durationMs,
                endedAt: value.endedAt,
                success: value.success,
              },
            ]
          : [];
      });
    runSummaries = readRunSummaries(initialHistory);
    const checkpoints = createCheckpoints({
      homeDir: options.homeDir,
      sessionId: lease.id,
      getState: () => state.get("checkpoint"),
      persist: async (value) => {
        await state.set("checkpoint", value, context);
      },
      getPrompt: (id) => promptFacts.get(id),
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
    await tracking.restoreCommitted(initialHistory);
    const plan = createPlanModeController({
      getSnapshot: () => state.get("plan"),
      persist: async (active) => {
        await state.set("plan", { active }, context);
      },
      changed: () => {},
    });
    const activation = await harness.snapshot(GoalActivationDoc, conversation.id, context);
    const nativeLive = await harness.snapshot(LiveDoc, conversation.id, context);
    let activationTaskFact = activation?.taskId ?? null;
    let liveTaskFact = nativeLive?.run ? Number(nativeLive.run.taskId) : null;
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
      warn: () => {
        if (permissionMode === "ask")
          warn(
            "Goal continuation may wait for permissions in ask mode. Consider switching to auto-review.",
          );
      },
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
    const mcpAuthState = createMcpAuthState();
    const mcp = createMcpConnections(mcpAuthState);
    const reconnectMcpServers = new Set<string>();
    const mcpManager = createMcpManager({
      createConnections: () => createMcpConnections(mcpAuthState),
      connectOptions: () => ({
        cwd,
        homeDir: options.homeDir,
        settings,
        trustProjectMcp: options.trustProjectMcp,
        interactive: !!options.onMcpAuth,
        onMcpAuth: options.onMcpAuth,
        onInteractionStart: notifyInteraction,
        onWarning: warn,
      }),
      getRunning: () => !!observation?.running(),
      getBusy: () => selectingModel || foregroundAdmission || manualCompaction,
      onChange: () => custom({ type: "mcp_servers_changed" }),
    });
    const jobHistory = await fullHistory(ROOT_CONVERSATION_ID);
    const historicalCalls: string[] = [];
    let lastKnownCall = -1;
    let initialJobSequence = 0;
    {
      for (const entry of jobHistory)
        for (const message of entry.model ?? []) {
          if (message.role === "assistant")
            for (const block of message.content)
              if (block.type === "toolCall" && block.name === "bash")
                historicalCalls.push(block.id);
          if (message.role !== "toolResult" || message.toolName !== "bash") continue;
          const details = message.details;
          if (!details || typeof details !== "object" || Array.isArray(details)) continue;
          const id = "jobId" in details ? details.jobId : undefined;
          if (typeof id !== "string") continue;
          const match = /^bash-(\d+)$/.exec(id);
          if (!match) continue;
          const sequence = Number(match[1]);
          if (sequence >= initialJobSequence) {
            initialJobSequence = sequence;
            lastKnownCall = historicalCalls.indexOf(message.toolCallId);
          }
        }
      // Calls after the latest receipt may have allocated a process ID before
      // their receipt was lost. Retire those IDs rather than reuse uncertainty.
      initialJobSequence += historicalCalls.length - lastKnownCall - 1;
    }
    const userStoppedJobs = new Set<string>();
    let jobAdmissions = Promise.resolve();
    const jobs = createJobs({
      initialSequence: initialJobSequence,
      onEvent: (event) => custom(event),
      onNotify: (job) => {
        if (closed) return;
        jobAdmissions = jobAdmissions
          .then(async () => {
            const content = `background job ${job.id} (${job.kind}: ${job.label}) finished [status: ${job.status}, exit code: ${job.exitCode ?? "unknown"}]. Read its output with job_output.`;
            const live = await harness.snapshot(LiveDoc, conversation.id, context);
            if (live?.run) {
              await conversation.commit(async (tx) => {
                const entry = await tx.appendEntry(conversation.id, {
                  kind: "rukie.job-notification",
                  model: [
                    {
                      role: "user",
                      content: [{ type: "text", text: content }],
                      timestamp: Date.now(),
                    },
                  ],
                });
                await tx.appendEntry(conversation.id, {
                  kind: "rukie.message-facts",
                  data: { entryId: Number(entry.id), source: "job" },
                });
              }, context);
            } else {
              stopped = false;
              const requestId = `job:${job.id}:${job.startedAt}`;
              const submitted = await submit(content, [], "followUp", requestId);
              void resultFor(requestId, submitted.id)
                .then(async (result) => {
                  custom({ type: "result", ...result });
                  await session.waitForRequest(requestId);
                })
                .catch(warn);
            }
          })
          .catch(warn);
      },
    });
    failedCleanup.push(async () => {
      await jobs.dispose(true);
      await mcpManager.close();
      await mcp.close();
      hooks.dispose();
    });
    const reportedSkillWarnings = new Set<string>();
    const loadSkills = async () => {
      const discovered = await discoverSkills(cwd, options.homeDir);
      for (const warning of discovered.warnings) {
        if (reportedSkillWarnings.has(warning)) continue;
        reportedSkillWarnings.add(warning);
        warn(warning);
      }
      return discovered.skills;
    };
    let skills = await loadSkills();
    let tools: ToolRegistration[] = [];
    const gate = createPermissionGate({
      cwd,
      homeDir: options.homeDir,
      rules: permissionRules,
      sessionAllowRules,
      sessionGrantListeners,
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
      onHookWarning: async (field, hook = "permission") => {
        const warning = {
          kind: "hook_warning" as const,
          event: "PermissionRequest" as const,
          hook,
          message: `Ignoring invalid or unsupported hook output field: ${field}`,
          error: { code: "hook-output-ignored" as const, params: { field } },
        };
        warn(warning.message);
        await appendNotice(warning);
        custom({ ...warning, type: "hook_warning" });
      },
      isRunStopped: () => stopped,
      stopRun: (reason) => {
        stopped = true;
        hookStopReason = reason ?? "Stopped by hook.";
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
      permissionDenied: async (call, denial, signal) => {
        const result = await hooks.run(
          "PermissionDenied",
          hookInput({
            tool_name: call.toolCall.name,
            tool_input: call.args,
            tool_use_id: call.toolCall.id,
            by: denial.by,
            reason: denial.reason,
            ...(denial.rule ? { rule: denial.rule } : {}),
          }),
          { signal, matchQuery: call.toolCall.name },
        );
        await applyHookResult(result, "hook:PermissionDenied");
        return result;
      },
    });
    const childHookOwners = new Map<number, ReturnType<typeof createHooks>>();
    const childHookStarted = new Set<number>();
    const persistChildHook = async (
      child: Parameters<Parameters<typeof createSubagentController>[0]["childAgent"]>[1],
      result: CommonHookResult,
      source: string,
      ctx = context,
    ) => {
      const live = await harness.snapshot(LiveDoc, child.id, ctx);
      await child.commit(async (tx) => {
        const pending = !live?.run ? await tx.doc(ChildHookContextDoc, child.id) : undefined;
        for (const message of result.systemMessages)
          await tx.appendEntry(child.id, {
            kind: "rukie.notice",
            data: {
              role: "session-notice",
              notice: { kind: "hook_message", message },
              timestamp: Date.now(),
            },
          });
        if (pending) {
          pending.pending.push(...result.additionalContext.map((content) => ({ source, content })));
        } else
          for (const content of result.additionalContext)
            await tx.appendEntry(
              child.id,
              reminderEntry({ role: "system-reminder", source, content, timestamp: Date.now() }),
            );
      }, ctx);
    };
    const ownedChildHooks = (
      type: Parameters<Parameters<typeof createSubagentController>[0]["childAgent"]>[0],
      child: Parameters<Parameters<typeof createSubagentController>[0]["childAgent"]>[1],
      selected: Model<Api>,
      childId: string,
      description: string,
    ) => {
      const previous = childHookOwners.get(Number(child.id));
      if (previous) return previous;
      let owner = createHooks({
        settings: mergeHooks(settings.hooks, type.hooks),
        cwd,
        homeDir: options.homeDir,
        projectDir: cwd,
        model: {
          models,
          getModel: async (requested) =>
            requested || settings.reviewModel
              ? selectedModel(requested ?? settings.reviewModel!)
              : selected,
        },
        callMcpTool: (...args) => mcp.callHookTool(...args),
        onWarning: warn,
        onEvent: (event) =>
          custom({
            type: "subagent_event",
            agentId: childId,
            description,
            subagentType: type.name,
            event: { ...event, sessionId: childId },
          }),
        onAsyncResult: (result, reason) => {
          asyncAdmissions = asyncAdmissions
            .then(async () => {
              if (closed) return;
              await persistChildHook(child, result, "async-hook");
              for (const content of result.systemMessages)
                await child.commit(
                  (tx) =>
                    tx.appendEntry(
                      child.id,
                      reminderEntry({
                        role: "system-reminder",
                        source: "async-hook",
                        content,
                        timestamp: Date.now(),
                      }),
                    ),
                  context,
                );
              if (reason) {
                const requestId = `hook:${childId}:${randomUUID()}`;
                const submitted = await submit(reason, [], "followUp", requestId);
                void resultFor(requestId, submitted.id)
                  .then(async (result) => {
                    custom({ type: "result", ...result });
                    await session.waitForRequest(requestId);
                  })
                  .catch(warn);
              }
            })
            .catch(warn);
        },
      });

      owner = withHookTranscript(
        owner,
        () => hookTranscriptPath(childId),
        async () => fullHistory(child.id),
        Object.values(mergeHooks(settings.hooks, type.hooks)).some((groups) => groups.length > 0),
        () => !closed,
      );
      childHookOwners.set(Number(child.id), owner);
      return owner;
    };
    const childJobRegistries = new Map<string, ReturnType<typeof createJobs>>();
    const childResources = new Map<
      number,
      {
        observation: Awaited<ReturnType<typeof createConversationObservation>>;
        jobs: ReturnType<typeof createJobs>;
      }
    >();
    const subagents = createSubagentController({
      onWarning: warn,
      harness,
      parent: conversation,
      parentSessionId: lease.id,
      state: subagentsDefinition,
      restored: state.get("subagents") as
        | import("../tools/subagents/state.ts").SubagentIdentity[]
        | undefined,
      forkAt: () => {
        const entries = observation?.view().entries ?? [];
        const current = entries.findLast((entry) =>
          entry.model?.some((message) => message.role === "assistant"),
        );
        return entries.findLast((entry) =>
          entry.model?.some(
            (message) =>
              (message.role === "assistant" && message.stopReason === "stop") ||
              (message.role === "toolResult" && (!current || entry.id < current.id)),
          ),
        )?.id;
      },
      async beforeStart(request, child, ctx) {
        const type =
          subagents.types().find((type) => type.name === request.type) ??
          subagents.types().find((type) => type.name === "general-purpose");
        if (!type) throw new Error("Subagent type is unavailable.");
        const saved = (await child.agent(ctx)).model;
        const selected = saved
          ? selectedModel(`${saved.provider}/${saved.modelId}`)
          : type.name === "fork"
            ? model
            : type.model
              ? selectedModel(type.model)
              : settings.subagentModel
                ? selectedModel(settings.subagentModel)
                : model;
        const owner = ownedChildHooks(type, child, selected, request.agentId, request.description);
        const result = await owner.run(
          "SubagentStart",
          hookInput({
            session_id: request.agentId,
            transcript_path: hookTranscriptPath(request.agentId),
            agent_transcript_path: hookTranscriptPath(request.agentId),
            model: `${selected.provider}/${selected.id}`,
            agent_id: request.agentId,
            agent_type: request.type,
            prompt: request.prompt,
          }),
          { signal: ctx.abortSignal, matchQuery: request.type },
        );
        await persistChildHook(child, result, "hook:SubagentStart", ctx);
        return result.continue === false
          ? { stop: result.stopReason ?? "Stopped by SubagentStart hook." }
          : undefined;
      },
      async afterRun(_request, child) {
        await childResources.get(Number(child.id))?.jobs.clear(true);
      },
      async childAgent(type, child, selection) {
        const inherited = selection.retained ? (await child.agent(context)).model : undefined;
        const retainedModel = inherited
          ? models.getModel(inherited.provider, inherited.modelId)
          : undefined;
        if (inherited && !retainedModel)
          throw new Error(
            `Unknown retained child model: ${inherited.provider}/${inherited.modelId}`,
          );
        const selected =
          retainedModel ??
          (type.name === "fork"
            ? model
            : type.model
              ? selectedModel(type.model)
              : settings.subagentModel
                ? selectedModel(settings.subagentModel)
                : model);
        const directory = subagents.list().find((row) => row.conversationId === Number(child.id));
        const description = directory?.description ?? type.description;
        const childId = directory?.id ?? String(child.id);
        const childInput = (extra: Record<string, unknown> = {}): HookInput =>
          hookInput({
            session_id: childId,
            agent_id: childId,
            agent_type: type.name,
            transcript_path: hookTranscriptPath(childId),
            agent_transcript_path: hookTranscriptPath(childId),
            model: `${selected.provider}/${selected.id}`,
            ...extra,
          });
        const applyChildHook = async (result: CommonHookResult, source: string, ctx = context) => {
          await persistChildHook(child, result, source, ctx);
          if (result.continue === false) {
            childStopped = true;
            childStopReason = result.stopReason;
          }
        };
        const firstAttachment = !childHookStarted.has(Number(child.id));
        const childHooks = ownedChildHooks(type, child, selected, childId, description);
        const childNotify: import("../interaction/index.ts").OnInteractionStart = async (
          notification,
        ) => {
          const result = await childHooks.run("Notification", childInput({ ...notification }), {
            signal: AbortSignal.any([auxiliaryLifetime.signal, notificationLifetime.signal]),
            matchQuery: notification.notification_type,
          });
          await applyChildHook(result, "hook:Notification");
        };
        const childState = await createToolState(definitions, harness, child, context);
        await child.commit(async (tx) => {
          const facts = await tx.doc(ChildFactsDoc, child.id);
          facts.title ||= description;
          facts.description = description;
        }, context);
        const childJobs =
          childJobRegistries.get(childId) ??
          createJobs({
            onEvent: (event) =>
              custom({
                type: "subagent_event",
                agentId: childId,
                description,
                subagentType: type.name,
                event: { ...event, sessionId: childId },
              }),
            onNotify: (job) => {
              if (!closed)
                void child
                  .commit(
                    (tx) =>
                      tx.appendEntry(
                        child.id,
                        reminderEntry({
                          role: "system-reminder",
                          source: `job:${job.id}`,
                          content: `background job ${job.id} (${job.kind}: ${job.label}) finished [status: ${job.status}, exit code: ${job.exitCode ?? "unknown"}]. Read its output with job_output.`,
                          timestamp: Date.now(),
                        }),
                      ),
                    context,
                  )
                  .catch(warn);
            },
          });
        childJobRegistries.set(childId, childJobs);
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
        await childTracking.restoreCommitted(await fullHistory(child.id));
        let childTools: ToolRegistration[] = [];
        let childStopped = false;
        let childStopReason: string | undefined;
        const childGate = createPermissionGate({
          cwd,
          homeDir: options.homeDir,
          rules: parsePermissionRules({
            ...settings.permissions,
            allow: [...(settings.permissions?.allow ?? []), ...(options.allowRules ?? [])],
          }),
          sessionAllowRules,
          sessionGrantListeners,
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
          onPermissionAsk: options.onPermissionAsk
            ? (request) =>
                options.onPermissionAsk!({ ...request, origin: { agentId: childId, description } })
            : undefined,
          onInteractionStart: childNotify,
          onToolCallAllowed: async (call) => {
            await checkpoints.record(call, cwd, options.homeDir);
            await options.onToolCallAllowed?.(call);
          },
          onEvent: (event) => custom(event),
          setMode: (value) => {
            permissionMode = value;
          },
          onHookWarning: async (field, hook = "permission") => {
            const warning = {
              kind: "hook_warning" as const,
              event: "PermissionRequest" as const,
              hook,
              message: `Ignoring invalid or unsupported hook output field: ${field}`,
              error: { code: "hook-output-ignored" as const, params: { field } },
            };
            warn(warning.message);
            await child.commit(
              (tx) =>
                tx.appendEntry(child.id, {
                  kind: "rukie.notice",
                  data: { role: "session-notice", notice: warning, timestamp: Date.now() },
                }),
              context,
            );
            custom({
              type: "subagent_event",
              agentId: childId,
              description,
              subagentType: type.name,
              event: { ...warning, type: "hook_warning", sessionId: childId },
            });
          },
          isRunStopped: () => childStopped,
          stopRun: (reason) => {
            childStopped = true;
            childStopReason = reason;
          },
          isMcpAuthTool: (name) => mcp.authTools.has(name),
          preToolUse: async (call, signal) => {
            const result = await childHooks.run(
              "PreToolUse",
              childInput({
                agent_id: childId,
                agent_type: type.name,
                tool_name: call.toolCall.name,
                tool_input: call.args,
                tool_use_id: call.toolCall.id,
              }),
              { signal, matchQuery: call.toolCall.name },
            );
            for (const content of result.additionalContext)
              await child.commit(
                (tx) =>
                  tx.appendEntry(
                    child.id,
                    reminderEntry({
                      role: "system-reminder",
                      source: "hook:PreToolUse",
                      content,
                      timestamp: Date.now(),
                    }),
                  ),
                context,
              );
            return result;
          },
          permissionRequest: (call, suggestions, signal) =>
            childHooks.run(
              "PermissionRequest",
              childInput({
                agent_id: childId,
                agent_type: type.name,
                tool_name: call.toolCall.name,
                tool_input: call.args,
                permission_suggestions: suggestions,
              }),
              { signal, matchQuery: call.toolCall.name },
            ),
          permissionDenied: async (call, denial, signal) => {
            const result = await childHooks.run(
              "PermissionDenied",
              childInput({
                agent_id: childId,
                agent_type: type.name,
                tool_name: call.toolCall.name,
                tool_input: call.args,
                tool_use_id: call.toolCall.id,
                by: denial.by,
                reason: denial.reason,
                ...(denial.rule ? { rule: denial.rule } : {}),
              }),
              { signal, matchQuery: call.toolCall.name },
            );
            await applyChildHook(result, "hook:PermissionDenied");
            return result;
          },
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
        const builtinTools = createBuiltinTools({
          cwd,
          homeDir: options.homeDir,
          jobs: childJobs,
          getSkill: (name) => skills.get(name),
          setTodo: async (todos) => {
            await childState.set("todo", todos, context);
          },
          onQuestion: options.onQuestion
            ? (request) =>
                options.onQuestion!({ ...request, origin: { agentId: childId, description } })
            : undefined,
          onInteractionStart: childNotify,
          webFetch: options.webFetch,
          fileTracking: childTracking,
        });
        const refreshChildTools = () => {
          childTools = [...builtinTools, ...mcp.tools]
            .filter((tool) => !type.tools || type.tools.includes(tool.name))
            .map((tool) => ({
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
                executedInputs.set(api.callId, args as Record<string, unknown>);
                const started = performance.now();
                try {
                  return await tool.execute(args, api, ctx);
                } finally {
                  toolDurations.set(api.callId, performance.now() - started);
                  if (ctx.abortSignal?.aborted && !closed) {
                    const result = await childHooks.run(
                      "PostToolUseFailure",
                      childInput({
                        tool_name: tool.name,
                        tool_input: args,
                        tool_use_id: api.callId,
                        error: String(ctx.abortSignal.reason ?? "Tool interrupted"),
                        is_interrupt: true,
                        duration_ms: toolDurations.get(api.callId),
                      }),
                      { signal: auxiliaryLifetime.signal, matchQuery: tool.name },
                    );
                    if (!closed) await applyChildHook(result, "hook:PostToolUseFailure");
                  }
                }
              },
            }));
        };
        refreshChildTools();
        const extension = {
          name: `rukie.child.${child.id}`,
          tools: childTools,
          hooks: [
            hook(ToolTask, {
              beforeTool: serializePermissionChecks(childGate.beforeTool, Number(child.id)),
              afterTool: async (call, result, _api, ctx) => {
                const changed = await childHooks.run(
                  result.isError ? "PostToolUseFailure" : "PostToolUse",
                  childInput({
                    tool_name: call.name,
                    tool_input: executedInputs.get(call.id) ?? call.arguments,
                    tool_response: { content: result.content, details: result.details },
                    ...(result.isError
                      ? {
                          error: (result.content ?? [])
                            .flatMap((part) => (part.type === "text" ? [part.text] : []))
                            .join(""),
                          is_interrupt: ctx.abortSignal?.aborted ?? false,
                        }
                      : {}),
                    tool_use_id: call.id,
                    duration_ms: toolDurations.get(call.id) ?? 0,
                  }),
                  { signal: ctx.abortSignal, matchQuery: call.name },
                );
                await applyChildHook(changed, "hook:PostToolUse", ctx);
                if ("decision" in changed && changed.decision === "block" && changed.reason)
                  return {
                    ...result,
                    content: [
                      ...(result.content ?? []),
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
              beforeRequest: async (_request, _api, ctx) => {
                await child.commit(async (tx) => {
                  const pending = await tx.doc(ChildHookContextDoc, child.id);
                  for (const { source, content } of pending.pending)
                    await tx.appendEntry(
                      child.id,
                      reminderEntry({
                        role: "system-reminder",
                        source,
                        content,
                        timestamp: Date.now(),
                      }),
                    );
                  pending.pending = [];
                }, ctx);
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
                return { messages: (await child.context(ctx)).messages };
              },
              afterResponse: async () => {
                childTracking.finishRequest();
              },
              onYield: async (answer, api, ctx) => {
                if (answer.stopReason !== "stop") return undefined;
                const live = await harness.snapshot(LiveDoc, child.id, ctx);
                const anchor = Number(live?.run?.inputs[0]);
                const previous = await harness.snapshot(HookContinuationDoc, child.id, ctx);
                const count = previous?.taskId === anchor ? previous.count : 0;
                const result = await childHooks.run(
                  "SubagentStop",
                  childInput({
                    stop_hook_active: count > 0,
                    last_assistant_message: textOf(answer),
                  }),
                  { signal: ctx.abortSignal, matchQuery: type.name },
                );
                await applyChildHook(result, "hook:SubagentStop", ctx);
                if (result.continue === false) {
                  await child.commit(
                    (tx) =>
                      tx.appendEntry(child.id, {
                        kind: "rukie.notice",
                        data: {
                          role: "session-notice",
                          notice: {
                            kind: "hook_stopped",
                            reason: result.stopReason ?? "Stopped by hook.",
                          },
                          timestamp: Date.now(),
                        },
                      }),
                    ctx,
                  );
                  return undefined;
                }
                if (result.decision !== "block" || !result.reason) return undefined;
                if (count >= 8) {
                  warn("SubagentStop hook reached the 8 continuation limit");
                  await child.commit(
                    (tx) =>
                      tx.appendEntry(child.id, {
                        kind: "rukie.notice",
                        data: {
                          role: "session-notice",
                          notice: {
                            kind: "hook_warning",
                            event: "SubagentStop",
                            hook: "continuation",
                            message: "SubagentStop hook reached the 8 continuation limit",
                            error: {
                              code: "hook-continuation-limit",
                              params: { event: "SubagentStop", limit: "8" },
                            },
                          },
                          timestamp: Date.now(),
                        },
                      }),
                    ctx,
                  );
                  custom({
                    type: "subagent_event",
                    agentId: childId,
                    description,
                    subagentType: type.name,
                    event: {
                      type: "hook_warning",
                      event: "SubagentStop",
                      hook: "continuation",
                      message: "SubagentStop hook reached the 8 continuation limit",
                      error: {
                        code: "hook-continuation-limit",
                        params: { event: "SubagentStop", limit: "8" },
                      },
                      sessionId: childId,
                    },
                  });
                  return undefined;
                }
                const reason = result.reason;
                await child.commit(async (tx) => {
                  const state = await tx.doc(HookContinuationDoc, child.id);
                  state.taskId = anchor;
                  state.count = count + 1;
                  await tx.appendEntry(child.id, {
                    kind: "rukie.message-facts",
                    data: {
                      taskId: Number(api.taskId),
                      content: reason,
                      source: "stop_hook",
                    },
                  });
                }, ctx);
                custom({
                  type: "subagent_event",
                  agentId: childId,
                  description,
                  subagentType: type.name,
                  event: {
                    type: "hook_continued",
                    event: "SubagentStop",
                    reason: result.reason,
                    sessionId: childId,
                  },
                });
                return { continue: result.reason };
              },
              afterTools: async (_assistant, results, _api, ctx) => {
                const committed = await Promise.all(
                  results.map((id) => lease.storage.entry(id, ctx)),
                );
                await childTracking.commitResults(
                  committed.flatMap((value) => (value ? [value.entry] : [])),
                );
                if (childStopped) {
                  await child.commit(
                    (tx) =>
                      tx.appendEntry(child.id, {
                        kind: "rukie.notice",
                        data: {
                          role: "session-notice",
                          notice: {
                            kind: "hook_stopped",
                            reason: childStopReason ?? "Stopped by hook.",
                          },
                          timestamp: Date.now(),
                        },
                      }),
                    ctx,
                  );
                  await child.abort(ctx);
                  return;
                }
                const previousNames = childTools.map((tool) => tool.name).join("\n");
                refreshChildTools();
                if (previousNames !== childTools.map((tool) => tool.name).join("\n")) {
                  const updated = { ...extension, tools: childTools };
                  registry.install(updated);
                  await child.configure({ extensions: [updated], tools: childTools }, ctx);
                }
              },
            }),
          ],
        };
        registry.install(extension);
        if (firstAttachment) {
          childHookStarted.add(Number(child.id));
          const source = type.name === "fork" ? "fork" : selection.retained ? "resume" : "startup";
          await applyChildHook(
            await childHooks.run("SessionStart", childInput({ source }), { matchQuery: source }),
            "hook:SessionStart",
          );
        }
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
          ...(settings.thinking ? { thinkingLevel: settings.thinking } : {}),
          cwd,
          instructions: SYSTEM_PROMPT,
          extensions: [extension],
          tools: childTools,
        };
      },
    });
    failedCleanup.push(async () => {
      subagents.close();
      for (const owner of childHookOwners.values()) owner.dispose();
      for (const resource of childResources.values()) {
        await resource.observation.close();
        await resource.jobs.dispose(true);
      }
    });
    const pendingCompactions = new Map<number, EntryRecord>();
    const compactFocus = new Map<number, string>();
    let compactionHooks = Promise.resolve();
    const stopCompactionByHook = async (reason: string, caller = context) => {
      const live = await harness.snapshot(LiveDoc, conversation.id, context);
      const first = live?.run?.inputs[0];
      const input =
        first === undefined ? undefined : await lease.storage.submission(first, context);
      await conversation.commit(async (tx) => {
        const stops = await tx.doc(HookStopsDoc);
        if (input?.requestId) stops.requests[input.requestId] = reason;
        await tx.appendEntry(conversation.id, {
          kind: "rukie.notice",
          data: {
            role: "session-notice",
            notice: { kind: "hook_stopped", reason },
            timestamp: Date.now(),
          },
        });
      }, context);
      stopped = true;
      hookStopReason = reason;
      try {
        await conversation.abort(caller);
      } catch (error) {
        if (!caller.abortSignal?.aborted) throw error;
      }
    };
    const processCompactionHooks = (caller = context) => {
      compactionHooks = compactionHooks.then(async () => {
        for (const [id, entry] of pendingCompactions) {
          pendingCompactions.delete(id);
          const data = entry.data;
          if (
            !data ||
            typeof data !== "object" ||
            Array.isArray(data) ||
            typeof data.reason !== "string"
          )
            continue;
          const text = entry.model?.map(textOf).join("") ?? "";
          const start = text.indexOf("<summary>\n");
          const end = text.lastIndexOf("\n</summary>");
          const summary = start >= 0 && end > start ? text.slice(start + 10, end) : text;
          const inputs = hookInput({
            trigger: data.reason === "manual" ? "manual" : "auto",
            custom_instructions: compactFocus.get(Number(entry.byTaskId)) ?? "",
            compact_summary: summary,
          });
          const post = await hooks.run("PostCompact", inputs, {
            matchQuery: inputs.trigger as string,
          });
          const startup = await hooks.run("SessionStart", hookInput({ source: "compact" }), {
            matchQuery: "compact",
          });
          for (const result of [post, startup]) {
            if (result.continue === false) {
              await stopCompactionByHook(result.stopReason ?? "Stopped by hook.", caller);
              break;
            }
            for (const message of result.systemMessages)
              await appendNotice({ kind: "hook_message", message });
            const before = await conversation.context(context);
            const latest = before.entries.findLast(
              (entry) =>
                entry.kind !== "rukie.reminder" &&
                entry.model?.some((message) => message.role === "user"),
            );
            await conversation.commit(async (tx) => {
              const context = await tx.doc(CompactHookContextDoc, conversation.id);
              context.pending.push(...result.additionalContext);
              if (result.additionalContext.length)
                context.afterEntry = latest ? Number(latest.id) : null;
            }, context);
          }
          tracking.finishRequest();
          await prepareReminders(context, false, Number(entry.id));
        }
      });
      return compactionHooks;
    };
    async function prepareReminders(
      ctx = context,
      includeHookContext = true,
      afterCompactionId?: number,
      admittingRequestId?: string,
    ) {
      const lastPlanReminder =
        !plan.getActive() && plan.hasEntered()
          ? (await fullHistory()).findLast(
              (entry) =>
                entry.kind === "rukie.reminder" && entryData(entry)?.source === "plan-mode",
            )
          : undefined;
      if (includeHookContext) {
        const before = await conversation.context(ctx);
        const latest = before.entries.findLast(
          (entry) =>
            entry.kind !== "rukie.reminder" &&
            entry.model?.some((message) => message.role === "user"),
        );
        await conversation.commit(async (tx) => {
          const owned = await tx.doc(CompactHookContextDoc, conversation.id);
          if (owned.afterEntry !== null && owned.afterEntry === Number(latest?.id)) return;
          for (const content of owned.pending)
            await tx.appendEntry(
              conversation.id,
              reminderEntry({
                role: "system-reminder",
                source: "hook:SessionStart",
                content,
                timestamp: Date.now(),
              }),
            );
          owned.pending = [];
          owned.afterEntry = null;
        }, ctx);
      }
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
                ? entryData(lastPlanReminder)?.content === "You have exited Plan Mode."
                  ? undefined
                  : "You have exited Plan Mode."
                : undefined,
        },
        ...state.reminderSources,
        tracking.reminderSource,
        ...(options.reminderSources ?? []),
      ];
      const reminders = await collectReminders({
        messages:
          afterCompactionId === undefined
            ? observation
              ? [...observation.messages()]
              : transcriptMessages((await conversation.context(ctx)).entries)
            : [],
        includeEnvironment: afterCompactionId === undefined,
        cwd,
        homeDir: options.homeDir,
        now: options.now?.() ?? new Date(),
        sources,
      });
      for (const reminder of reminders)
        if (reminder.source === "file-changes") await tracking.persistReminder(reminder);
        else if (afterCompactionId === undefined) await appendReminder(reminder, ctx);
        else
          await conversation.commit((tx) => {
            const draft = reminderEntry(reminder);
            return tx.appendEntry(conversation.id, {
              ...draft,
              data: {
                source: reminder.source,
                content: reminder.content,
                timestamp: reminder.timestamp,
                afterCompactionId,
              },
            });
          }, ctx);
      const jobStops = await harness.snapshot(JobStopsDoc, conversation.id, ctx);
      if (jobStops && Object.keys(jobStops.pending).length) {
        const submissions = await lease.storage.scanSubmissions(
          { conversationId: conversation.id },
          100000,
          undefined,
          ctx,
        );
        const records = new Map(submissions.items.map((record) => [record.requestId, record]));
        await conversation.commit(async (tx) => {
          const pending = await tx.doc(JobStopsDoc, conversation.id);
          for (const [requestId, content] of Object.entries(pending.pending)) {
            if (requestId === admittingRequestId) continue;
            const record = records.get(requestId);
            if (record?.status === "queued") continue;
            if (!record?.entry)
              await tx.appendEntry(
                conversation.id,
                reminderEntry({
                  role: "system-reminder",
                  source: requestId,
                  content,
                  timestamp: Date.now(),
                }),
              );
            delete pending.pending[requestId];
          }
        }, ctx);
      }
    }
    const rebuildTools = async (reportDiscovery = false) => {
      skills = await loadSkills();
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
          executedInputs.set(api.callId, args as Record<string, unknown>);
          const started = performance.now();
          try {
            return await tool.execute(args, api, ctx);
          } finally {
            toolDurations.set(api.callId, performance.now() - started);
            if (ctx.abortSignal?.aborted && !closed) {
              const result = await hooks.run(
                "PostToolUseFailure",
                hookInput({
                  tool_name: tool.name,
                  tool_input: args,
                  tool_use_id: api.callId,
                  error: String(ctx.abortSignal.reason ?? "Tool interrupted"),
                  is_interrupt: true,
                  duration_ms: toolDurations.get(api.callId),
                }),
                { signal: auxiliaryLifetime.signal, matchQuery: tool.name },
              );
              if (!closed) await applyHookResult(result, "hook:PostToolUseFailure");
            }
          }
        },
      }));
      const extension = {
        name: "rukie.session",
        tools,
        hooks: [
          hook(CompactionTask, {
            beforeCompact: async (compaction, api, ctx) => {
              compactFocus.set(Number(api.taskId), compaction.instructions ?? "");
              if (compaction.reason === "manual") return undefined;
              const result = await hooks.run(
                "PreCompact",
                hookInput({
                  trigger: "auto",
                  custom_instructions: compaction.instructions ?? null,
                }),
                { signal: ctx.abortSignal, matchQuery: "auto" },
              );
              if (result.continue === false) {
                await stopCompactionByHook(result.stopReason ?? "Stopped by hook.", ctx);
                return { decline: true };
              }
              if (result.decision === "block") {
                const reason = result.reason ?? "Compaction declined by hook.";
                const warning = {
                  event: "PreCompact" as const,
                  hook: "compaction",
                  message: reason,
                  error: { code: "hook-compaction-blocked" as const, params: { reason } },
                };
                await appendNotice({ kind: "hook_warning", ...warning });
                custom({ type: "hook_warning", ...warning });
                warn(reason);
                return { decline: true };
              }
              return undefined;
            },
          }),
          hook(ToolTask, {
            beforeTool: serializePermissionChecks(gate.beforeTool, Number(conversation.id)),
            afterTool: async (call, result, api, ctx) => {
              const changed = await hooks.run(
                result.isError ? "PostToolUseFailure" : "PostToolUse",
                hookInput({
                  tool_name: call.name,
                  tool_input: executedInputs.get(call.id) ?? call.arguments,
                  tool_response: { content: result.content, details: result.details },
                  ...(result.isError
                    ? {
                        error: (result.content ?? [])
                          .flatMap((part) => (part.type === "text" ? [part.text] : []))
                          .join(""),
                        is_interrupt: ctx.abortSignal?.aborted ?? false,
                      }
                    : {}),
                  tool_use_id: call.id,
                  duration_ms: toolDurations.get(call.id) ?? 0,
                }),
                { signal: ctx.abortSignal, matchQuery: call.name },
              );
              await applyHookResult(changed, "hook:PostToolUse", ctx);
              if ("decision" in changed && changed.decision === "block" && changed.reason)
                return {
                  ...result,
                  content: [
                    ...(result.content ?? []),
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
              await processCompactionHooks(ctx);
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
                const current = await conversation.context(ctx);
                const latestInput = current.entries.findLast(
                  (entry) =>
                    entry.kind !== "rukie.reminder" &&
                    (entry.model ?? []).some((message) => message.role === "user"),
                );
                const repairs = await harness.snapshot(HookYieldDoc, conversation.id, ctx);
                if (
                  repairs?.pending.length &&
                  latestInput?.model?.some(
                    (message) =>
                      message.role === "user" && textOf(message) === repairs.pending.join("\n\n"),
                  )
                )
                  await conversation.commit(async (tx) => {
                    const pending = await tx.doc(HookYieldDoc, conversation.id);
                    pending.pending = [];
                    pending.runAnchor = null;
                  }, ctx);
                if (
                  placed.some(
                    (record) =>
                      record?.requestId?.startsWith("human:") && record.entry === latestInput?.id,
                  )
                )
                  goalRound = false;
                const humanInput = placed.findLast(
                  (record) =>
                    record?.requestId?.startsWith("human:") && record.entry === latestInput?.id,
                );
                if (
                  humanInput &&
                  latestInput?.model?.some(
                    (message) => message.role === "user" && textOf(message).startsWith("/"),
                  )
                ) {
                  const facts = (await fullHistory()).findLast(
                    (entry) =>
                      entry.kind === "rukie.message-facts" &&
                      entryData(entry)?.entryId === Number(humanInput.entry),
                  );
                  const invocation = entryData(facts)?.skillInvocation;
                  if (
                    typeof invocation === "string" &&
                    !current.messages.some((message) => textOf(message).includes(invocation))
                  )
                    await appendReminder(
                      {
                        role: "system-reminder",
                        source: "skill-invocation",
                        content: invocation,
                        timestamp: Date.now(),
                      },
                      ctx,
                    );
                }
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
                if (record?.entry)
                  await conversation.commit(async (tx) => {
                    const pending = await tx.doc(PendingInputFactsDoc, conversation.id);
                    const facts = pending.inputs[String(id)];
                    if (!facts) return;
                    await tx.appendEntry(conversation.id, {
                      kind: "rukie.message-facts",
                      data: { ...facts, entryId: Number(record.entry) },
                    });
                    delete pending.inputs[String(id)];
                  }, ctx);
                if (
                  record?.requestId?.startsWith("human:") &&
                  record.status !== "queued" &&
                  record.entry &&
                  !checkpoints
                    .list()
                    .some((checkpoint) => checkpoint.promptEntryId === String(record.entry))
                ) {
                  const persisted = await lease.storage.entry(record.entry, ctx);
                  if (persisted) rememberPrompts([persisted.entry]);
                  await checkpoints.start(String(record.entry));
                }
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
              contextMessages = modelContextMessages(await conversation.context(ctx));
              await observation.flush();
              custom(contextUsage(contextMessages, model.contextWindow, latestInputTokens()));
              return { messages: contextMessages };
            },
            afterResponse: async (message, api, ctx) => {
              tracking.finishRequest();
              if (message.stopReason === "error" || message.stopReason === "aborted") {
                goal.disarm();
                await conversation.commit(async (tx) => {
                  const activation = await tx.doc(GoalActivationDoc, conversation.id);
                  activation.taskId = null;
                  activation.requestId = null;
                }, ctx);
              }
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
                committed.flatMap((value) => (value ? [value.entry] : [])),
              );
              mcpManager.adopt(mcp.snapshot());
              const takeover = committed.some((value) =>
                value?.entry.model?.some((message) => {
                  if (message.role !== "toolResult" || message.toolName !== "exit_plan_mode")
                    return false;
                  const details = message.details;
                  return (
                    details &&
                    typeof details === "object" &&
                    !Array.isArray(details) &&
                    "kind" in details &&
                    details.kind === "takeover"
                  );
                }),
              );
              if (takeover) {
                const live = await harness.snapshot(LiveDoc, conversation.id, ctx);
                const first = live?.run?.inputs[0];
                const input =
                  first === undefined ? undefined : await lease.storage.submission(first, ctx);
                await conversation.commit(async (tx) => {
                  const taken = await tx.doc(PlanTakeoverDoc);
                  if (input?.requestId) taken.requests[input.requestId] = true;
                }, ctx);
                await conversation.abort(ctx);
                return;
              }
              if (stopped && hookStopReason) {
                const live = await harness.snapshot(LiveDoc, conversation.id, ctx);
                const first = live?.run?.inputs[0];
                const input =
                  first === undefined ? undefined : await lease.storage.submission(first, ctx);
                const reason = hookStopReason;
                await conversation.commit(async (tx) => {
                  const stopped = await tx.doc(HookStopsDoc);
                  if (input?.requestId) stopped.requests[input.requestId] = reason;
                  await tx.appendEntry(conversation.id, {
                    kind: "rukie.notice",
                    data: {
                      role: "session-notice",
                      notice: { kind: "hook_stopped", reason },
                      timestamp: Date.now(),
                    },
                  });
                }, ctx);
                await conversation.abort(ctx);
                return;
              }
              const availableMcp = new Set(mcp.tools.map((tool) => tool.name));
              const publishedMcp = tools
                .filter((tool) => tool.name.startsWith("mcp__"))
                .map((tool) => tool.name);
              if (
                publishedMcp.length !== availableMcp.size ||
                publishedMcp.some((name) => !availableMcp.has(name))
              )
                await rebuildTools();
            },
            onYield: async (_answer, api, ctx) => {
              // A caller may start steering before releasing an in-flight model.
              // Complete host admission before the native final boundary selects its inbox.
              await Promise.allSettled(steeringAdmissions);
              if (_answer.stopReason !== "stop") {
                goal.disarm();
                await conversation.commit(async (tx) => {
                  const activation = await tx.doc(GoalActivationDoc, conversation.id);
                  activation.taskId = null;
                  activation.requestId = null;
                }, ctx);
                return undefined;
              }
              if (subagents.list().some((child) => child.active)) return undefined;
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
              const hookState = await harness.snapshot(HookContinuationDoc, conversation.id, ctx);
              const live = await harness.snapshot(LiveDoc, conversation.id, ctx);
              const runAnchor = Number(live?.run?.inputs[0]);
              const count = hookState?.taskId === runAnchor ? hookState.count : 0;
              checkingStop = runAnchor;
              const result = await hooks
                .run(
                  "Stop",
                  hookInput({
                    stop_hook_active: count > 0,
                    last_assistant_message: textOf(_answer),
                  }),
                  {
                    signal: ctx.abortSignal,
                  },
                )
                .finally(async () => {
                  await asyncAdmissions;
                  checkingStop = undefined;
                });
              await applyHookResult(result, "hook:Stop", ctx);
              if (result.continue === false) {
                const input =
                  live?.run?.inputs[0] === undefined
                    ? undefined
                    : await lease.storage.submission(live.run.inputs[0], ctx);
                const reason = result.stopReason ?? "Stopped by hook.";
                await conversation.commit(async (tx) => {
                  const stops = await tx.doc(HookStopsDoc);
                  if (input?.requestId) stops.requests[input.requestId] = reason;
                  await tx.appendEntry(conversation.id, {
                    kind: "rukie.notice",
                    data: {
                      role: "session-notice",
                      notice: { kind: "hook_stopped", reason },
                      timestamp: Date.now(),
                    },
                  });
                }, ctx);
                return undefined;
              }
              const repairs = await harness.snapshot(HookYieldDoc, conversation.id, ctx);
              if (repairs?.runAnchor === runAnchor && repairs.pending.length)
                return continuation(repairs.pending.join("\n\n"), "async-hook");
              if (result.decision === "block" && result.reason) {
                if (count >= 8) {
                  warn("Stop hook reached the 8 continuation limit");
                  await appendNotice(
                    {
                      kind: "hook_warning",
                      event: "Stop",
                      hook: "continuation",
                      message: "Stop hook reached the 8 continuation limit",
                      error: {
                        code: "hook-continuation-limit",
                        params: { event: "Stop", limit: "8" },
                      },
                    },
                    ctx,
                  );
                  custom({
                    type: "hook_warning",
                    event: "Stop",
                    hook: "continuation",
                    message: "Stop hook reached the 8 continuation limit",
                    error: {
                      code: "hook-continuation-limit",
                      params: { event: "Stop", limit: "8" },
                    },
                  });
                  return undefined;
                }
                await conversation.commit(async (tx) => {
                  const state = await tx.doc(HookContinuationDoc, conversation.id);
                  state.taskId = runAnchor;
                  state.count = count + 1;
                }, ctx);
                custom({ type: "hook_continued", event: "Stop", reason: result.reason });
                return continuation(result.reason, "stop_hook");
              }
              const active = goal.view();
              if (active?.armed && active.phase === "active" && !stopped) {
                // Native final-boundary placement takes precedence over onYield continuations.
                // Do not consume a Goal round that the queued human input will replace.
                const inbox = await harness.snapshot(InboxDoc, conversation.id, ctx);
                if (inbox?.items.some((item) => item.mode !== "write")) return undefined;
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
          ? async (discovery) => {
              for (const warning of discovery.warnings) warn(warning);
              for (const warning of discovery.hookWarnings) {
                await appendNotice({
                  kind: "hook_warning",
                  event: "SubagentStart",
                  hook: warning.source,
                  message: warning.message,
                  error: warning.error,
                });
                custom({
                  type: "hook_warning",
                  event: "SubagentStart",
                  hook: warning.source,
                  message: warning.message,
                  error: warning.error,
                });
              }
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
            change.type === "entry" &&
            change.value.conversationId === conversation.id &&
            change.value.kind === "pi.compaction"
          )
            pendingCompactions.set(Number(change.value.id), change.value);
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
            change.record.kind === "rukie.goal-activation"
          ) {
            const task = change.value?.taskId;
            activationTaskFact = typeof task === "number" ? task : null;
          }
          if (
            change.type === "document" &&
            change.conversationId === conversation.id &&
            change.record.kind === "pi.live" &&
            change.value
          ) {
            const value = change.value;
            const run = value.run;
            liveTaskFact =
              run &&
              typeof run === "object" &&
              !Array.isArray(run) &&
              typeof run.taskId === "number"
                ? run.taskId
                : null;
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
        toolStates: {
          ...state.snapshot(),
          goal: state.get("goal")
            ? {
                ...(state.get("goal") as Omit<GoalView, "armed">),
                armed: activationTaskFact !== null && liveTaskFact !== null,
              }
            : null,
        },
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
      if (receipt.status === "unanswered" && goal.view()?.armed) {
        goal.disarm();
        await conversation.commit(async (tx) => {
          const activation = await tx.doc(GoalActivationDoc, conversation.id);
          activation.taskId = null;
          activation.requestId = null;
        }, context);
      }
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
      const terminal =
        (answer?.entry.model ?? []).findLast((message) => message.role === "assistant") ??
        view.entries
          .flatMap((entry) =>
            receipt.entry && entry.id >= receipt.entry ? (entry.model ?? []) : [],
          )
          .findLast((message) => message.role === "assistant");
      const text =
        (answer?.entry.model ?? (terminal ? [terminal] : undefined))
          ?.filter((message) => message.role === "assistant")
          .map(textOf)
          .join("") ?? "";
      const request = await readRequest(requestId);
      await observation.flush();
      if ((await harness.snapshot(PlanTakeoverDoc, context))?.requests[requestId])
        return {
          requestId,
          text: "",
          success: true,
          usage,
          durationMs: Date.now() - (request?.startedAt ?? Date.now()),
        };
      const persistedStop = (await harness.snapshot(HookStopsDoc, context))?.requests[requestId];
      if (persistedStop)
        return {
          requestId,
          text,
          success: true,
          stopReason: "hook_stopped",
          reason: persistedStop,
          usage,
          durationMs: Date.now() - (request?.startedAt ?? Date.now()),
        };
      return {
        requestId,
        text,
        success:
          receipt.status === "done" &&
          (terminal?.role !== "assistant" || terminal.stopReason === "stop"),
        usage,
        durationMs: Date.now() - (request?.startedAt ?? Date.now()),
        ...(receipt.status === "unanswered"
          ? { error: typeof receipt.detail === "string" ? receipt.detail : receipt.reason }
          : terminal?.role === "assistant" && terminal.stopReason !== "stop"
            ? {
                error:
                  terminal.errorMessage ??
                  `Model response ended with stop reason ${terminal.stopReason}`,
              }
            : {}),
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
      const hookResult = requestId.startsWith("human:")
        ? await hooks.run("UserPromptSubmit", hookInput({ prompt }), { signal })
        : { systemMessages: [], additionalContext: [] };
      signal?.throwIfAborted();
      await applyHookResult(hookResult, "hook:UserPromptSubmit");
      if (hookResult.decision === "block" || hookResult.continue === false || startupStopReason) {
        const stopReason =
          hookResult.continue === false || startupStopReason ? "hook_stopped" : "hook_blocked";
        const reason =
          startupStopReason ??
          hookResult.stopReason ??
          hookResult.reason ??
          "Prompt blocked by hook.";
        startupStopReason = undefined;
        const result: RequestResult = {
          requestId,
          text: "",
          success: true,
          stopReason,
          reason,
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
              notice: { kind: stopReason, reason },
              timestamp: Date.now(),
            },
          });
        }, context);
        await writeHookTranscript(hookTranscriptPath(lease.id), await fullHistory());
        throw new PromptHookBlocked(result);
      }
      await prepareReminders(context, true, undefined, requestId);
      if (requestId.startsWith("human:")) await title.firstPrompt(prompt);
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
      if (images.length || invocation || !requestId.startsWith("human:")) {
        const facts: Record<string, JsonValue> = {
          ...(images.length ? { imageNames: images.map((image) => image.name ?? null) } : {}),
          ...(invocation ? { skillInvocation: invocation } : {}),
          ...(!requestId.startsWith("human:")
            ? {
                source: requestId.startsWith("goal:")
                  ? "goal"
                  : requestId.startsWith("job:")
                    ? "job"
                    : "hook",
              }
            : {}),
        };
        await conversation.commit(async (tx) => {
          const pending = await tx.doc(PendingInputFactsDoc, conversation.id);
          if (record.entry)
            await tx.appendEntry(conversation.id, {
              kind: "rukie.message-facts",
              data: { ...facts, entryId: Number(record.entry) },
            });
          else pending.inputs[String(submitted.id)] = facts;
        }, context);
      }
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
        return (
          !closed && storageFailure === undefined && (manualCompaction || observation.running())
        );
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
        selectingModel = true;
        try {
          if (!(await models.checkAuth(next.provider, { signal: auxiliaryLifetime.signal }))) {
            const env = settings.providers?.find(
              (provider) => provider.id === next.provider,
            )?.apiKeyEnv;
            throw createUserVisibleError(
              `No API key for provider "${next.provider}"${env ? `: set ${env}` : ""}.`,
              {
                code: "no-api-key",
                params: { provider: next.provider, env: env ?? "" },
              },
            );
          }
          assertAvailable();
          await conversation.configure(
            { model: { provider: next.provider, modelId: next.id } },
            context,
          );
          model = next;
          await state.set("model", spec, context);
          await writeMetadata();
        } finally {
          selectingModel = false;
        }
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
      editGoal: async (objective) => {
        const prior = goal.view();
        const value = await goal.edit(objective);
        const requestId = prior?.phase === "complete" ? await startGoal() : undefined;
        return { ...value, ...(requestId ? { requestId } : {}) };
      },
      pauseGoal: () => goal.pause(),
      resumeGoal: async () => {
        const value = await goal.resume();
        const requestId = await startGoal();
        return { ...value, ...(requestId ? { requestId } : {}) };
      },
      clearGoal: () => goal.clear(),
      subscribe(listener) {
        listeners.add(listener);
        listener(structuredClone(observation.snapshot()));
        return () => listeners.delete(listener);
      },
      get messages() {
        return structuredClone(observation.messages());
      },
      toolState: (name) => state.get(name),
      runSummaries: () => structuredClone(runSummaries),
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
        if (userStoppedJobs.has(id)) return;
        userStoppedJobs.add(id);
        job.kill("user");
        await job.completed;
        const content = `User stopped background job ${id} (${job.view.label}).`;
        if (observation.running()) {
          const parent = currentRequestId;
          const requestId = `job:stopped:${id}:${job.view.startedAt}`;
          await conversation.commit(async (tx) => {
            const pending = await tx.doc(JobStopsDoc, conversation.id);
            pending.pending[requestId] = content;
          }, context);
          const submitted = await submit(content, [], "steer", requestId);
          if (parent) await registerSubmission(parent, submitted.id);
        } else
          await appendReminder({
            role: "system-reminder",
            source: `job:stopped:${id}`,
            content,
            timestamp: Date.now(),
          });
      },
      async mcpServers(input) {
        if (closed) throw new Error("Session has been closed.");
        return mcpManager.snapshot(input);
      },
      async authenticateMcp(name) {
        return mcpManager.authenticate(name);
      },
      async clearMcpAuth(name) {
        await mcpManager.clearAuth(name);
      },
      async reconnectMcp(name) {
        await mcpManager.reconnect(name);
        reconnectMcpServers.add(name);
      },
      async compact(input) {
        assertAvailable(true);
        manualCompaction = true;
        try {
          const pre = await hooks.run(
            "PreCompact",
            hookInput({ trigger: "manual", custom_instructions: input?.instructions ?? "" }),
            { matchQuery: "manual" },
          );
          if (pre.continue === false)
            throw pre.stopReason
              ? createUserVisibleError(pre.stopReason, {
                  code: "compaction-hook-stopped-reason",
                  params: { reason: pre.stopReason },
                })
              : createUserVisibleError("Compaction stopped by hook.", {
                  code: "compaction-hook-stopped",
                  params: {},
                });
          if (pre.decision === "block")
            throw createUserVisibleError(pre.reason ?? "Compaction blocked by hook.", {
              code: "hook-compaction-blocked",
              params: { reason: pre.reason ?? "" },
            });
          const id = await conversation.compact(input?.instructions, context);
          manualCompactionTask = id;
          compactFocus.set(Number(id), input?.instructions ?? "");
          const settled = await Promise.race([
            harness.waitForTask(id, context),
            storageFault.promise,
          ]);
          if (settled.state.status !== "terminal") throw new Error("Compaction did not settle.");
          const outcome = settled.state.outcome;
          if (outcome.status !== "completed")
            throw new Error(
              outcome.status === "failed" || outcome.status === "faulted"
                ? outcome.error.message
                : (outcome.reason ?? "Compaction aborted."),
            );
          await processCompactionHooks();
          contextMessages = (await conversation.context(context)).messages;
          await observation.flush();
        } finally {
          manualCompactionTask = undefined;
          manualCompaction = false;
        }
      },
      checkpoints: () => checkpoints.list(),
      async rewind(id, input) {
        assertAvailable(true);
        if (!input.code && !input.conversation)
          throw new Error("Choose code or conversation rewind.");
        const inspection = await harness.inspect(context);
        if (inspection.tasks.length)
          throw new Error("Rewind requires all related work to be settled.");
        const prompt = checkpoints.prompt(id);
        const code = input.code ? await checkpoints.restoreCode(id) : { restored: [], deleted: [] };
        if (input.conversation) {
          const entries = await fullHistory();
          const index = entries.findIndex((entry) => String(entry.id) === id);
          const previous = entries[index - 1];
          if (!previous) throw new Error("Checkpoint has no prior entry anchor.");
          const forkRecord = await conversation.commit(async (tx) => {
            const active = await tx.doc(SessionMetadataDoc);
            const fork = await tx.forkConversation(conversation.id, previous.id, {
              ownership: { kind: "ownerless" },
            });
            active.activeConversationId = Number(fork.id);
            active.updatedAt = Date.now();
            return fork;
          }, context);
          const fork = await harness.conversation(forkRecord.id, context);
          if (!fork) throw new Error("Committed rewind conversation is missing.");
          await observation.close();
          conversation = fork;
          runSummaries = readRunSummaries(await fullHistory());
          await writeMetadata();
          state = await createToolState(definitions, harness, conversation, context);
          await subagents.rebindParent(conversation, context);
          plan.restore();
          tracking.restore(state.get("file-tracking"));
          await tracking.restoreCommitted(await fullHistory());
          goal.disarm();
          await rebuildTools();
          const rewindEvents: SessionEvent[] = [];
          let rewindInstalled = false;
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
              if (!rewindInstalled) {
                rewindEvents.push(...events);
                return;
              }
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
          rewindInstalled = true;
          for (const event of rewindEvents) emit(event);
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
          messages: resource?.observation.present(child.messages) ?? child.messages,
          historyMessages: child.historyMessages,
          title: facts?.title ?? child.description,
          description: child.description,
          model: child.model,
          ...(child.generation?.message
            ? { generation: { ...child.generation, message: child.generation.message } }
            : {}),
          run: child.run,
        };
      },
      interruptSubagent(id) {
        void subagents.interrupt(id, context).catch(warn);
      },
      async abort() {
        assertAvailable();
        notificationLifetime.abort();
        notificationLifetime = new AbortController();
        stopped = true;
        goal.disarm();
        if (manualCompactionTask) await harness.abortTask(manualCompactionTask, context);
        await conversation.abort(context);
        await observation.flush();
      },
      async steer(prompt, input) {
        const parentRequestId = currentRequestId;
        const admission = (async () => {
          const submitted = await submit(prompt, input?.images, "steer");
          if (parentRequestId) await registerSubmission(parentRequestId, submitted.id);
        })();
        steeringAdmissions.add(admission);
        try {
          await admission;
        } finally {
          steeringAdmissions.delete(admission);
        }
      },
      async run(prompt, input = {}) {
        input.signal?.throwIfAborted();
        if (observation.running() && currentRequestId?.startsWith("hook:")) {
          const cancelled = Promise.withResolvers<never>();
          const cancelWaiting = () => cancelled.reject(input.signal?.reason);
          input.signal?.addEventListener("abort", cancelWaiting, { once: true });
          try {
            await Promise.race([conversation.waitForIdle(context), cancelled.promise]);
          } finally {
            input.signal?.removeEventListener("abort", cancelWaiting);
          }
        }
        assertAvailable(true);
        foregroundAdmission = true;
        stopped = false;
        hookStopReason = undefined;
        goalRound = false;
        const abort = () => {
          notificationLifetime.abort();
          notificationLifetime = new AbortController();
          stopped = true;
          goal.disarm();
          void conversation.abort(context).catch((error) => {
            if (!closed) warn(error);
          });
        };
        input.signal?.addEventListener("abort", abort, { once: true });
        const off = input.onEvent
          ? session.subscribe((event) => {
              void Promise.resolve(input.onEvent!(event)).catch(warn);
            })
          : () => {};
        try {
          await rebuildTools();
          const connectionOptions: Parameters<typeof mcp.connect>[0] = {
            cwd,
            homeDir: options.homeDir,
            settings,
            trustProjectMcp: options.trustProjectMcp,
            interactive: !!options.onMcpAuth,
            onMcpAuth: options.onMcpAuth,
            onInteractionStart: notifyInteraction,
            signal: input.signal,
            getOrigin: (conversationId) => {
              const row = subagents.list().find((row) => row.conversationId === conversationId);
              return row ? { agentId: row.id, description: row.description } : undefined;
            },
            onWarning: warn,
            onEvent: (event) => {
              custom(event);
              mcpManager.adopt(mcp.snapshot());
            },
          };
          for (const name of reconnectMcpServers) {
            await mcp.connect({ ...connectionOptions, onlyServer: name, reconnect: true });
            reconnectMcpServers.delete(name);
          }
          await mcp.connect(connectionOptions);
          mcpManager.adopt(mcp.snapshot());
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
          if (input.signal?.aborted) throw input.signal.reason;
          if (error instanceof PromptHookBlocked) {
            custom({ type: "result", ...error.result });
            custom({ type: "request_settled", ...error.result });
            return error.result;
          }
          throw error;
        } finally {
          foregroundAdmission = false;
          off();
          input.signal?.removeEventListener("abort", abort);
        }
      },
      waitForRequest(requestId) {
        const existing = requestWaiters.get(requestId);
        if (existing) return existing;
        const waiting = (async () => {
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
        })();
        requestWaiters.set(requestId, waiting);
        return waiting;
      },
      async waitForIdle() {
        await mcpManager.waitForIdle();
        await jobAdmissions;
        await conversation.waitForIdle(context);
        await observation.flush();
      },
      close(reason = "exit") {
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
          await release(() => mcpManager.close());
          await release(() => title.dispose());
          await release(async () => {
            const result = await hooks.run("SessionEnd", hookInput({ reason }), {
              matchQuery: reason,
            });
            await applyHookResult(result, "hook:SessionEnd");
          });
          hooks.dispose();
          await release(async () => {
            await Promise.all(shutdownPublications);
          });
          await release(() => plan.settleWrites());
          await release(() => harness.close(context));
          await release(() => observation.close());
          subagents.close();
          for (const owner of childHookOwners.values()) owner.dispose();
          for (const resource of childResources.values()) {
            await release(() => resource.observation.close());
            await release(() => resource.jobs.dispose());
          }
          await release(() => jobs.dispose());
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
      { matchQuery: options.resumeId ? "resume" : "startup" },
    );
    await applyHookResult(startup, "hook:SessionStart");
    if (startup.continue === false) startupStopReason = startup.stopReason ?? "Stopped by hook.";
    await asyncAdmissions;
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
