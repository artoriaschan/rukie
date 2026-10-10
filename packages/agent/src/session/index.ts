import { createConversationRuntime, createConversationRuntimePool } from "./conversation/index.ts";
import { readGoalReceipt } from "../tools/goal/index.ts";
import { readSubagentReceipt } from "../tools/subagents/index.ts";
import { createRequestLedger, parseRequestId, requestKind, requestIds } from "../requests/index.ts";
import { deferredToolsReminder } from "../tools/tool-search/index.ts";
import { stopHookContinuation } from "../hooks/index.ts";
import { validateSessionDocument, validateSessionDocuments } from "./documents.ts";
import { writeHookTranscript } from "../hooks/transcript.ts";
import { join, resolve } from "node:path";
import {
  BACKGROUND_CONTEXT,
  awaitWithContext,
  withAbortSignal,
} from "@earendil-works/chord/context";
import type { Context, JsonValue } from "@earendil-works/chord";
import {
  type Api,
  type Model,
  type Models,
  type Message,
  type UserMessage,
} from "@earendil-works/pi-ai";
import {
  Harness,
  configure,
  createRegistry,
  defineDoc,
  hook,
  GenerationTask,
  CompactionTask,
  ToolTask,
  LiveDoc,
  type TaskId,
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
  type ThinkingLevel,
  type RunResult,
  type Settings,
  type ContextReport,
  type ContextUsageEvent,
  type McpSnapshot,
  type JobView,
  type JobOutput,
} from "@rukie/shared";
import type { SessionEvent } from "./events.ts";
import {
  permissionDenialFacts,
  modelContextMessages,
  visibleReminderContents,
  transcriptMessages,
  type TranscriptMessage,
} from "./messages.ts";
const entryData = (entry: EntryRecord | undefined) => {
  const value = entry?.data;
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
};
import { isMcpAuthenticationInteraction } from "../mcp/index.ts";
import { hasPendingInteraction } from "../interaction/index.ts";
import {
  resolveModel,
  isTrustedProject,
  modelState,
  supportedThinkingLevel,
} from "../config/index.ts";
import {
  createJsonlStore,
  registerSessionReader,
  SessionMetadataDoc,
  parseSessionMetadata,
  type SessionStore,
} from "../store/index.ts";
import { createToolState } from "../tool-state/index.ts";
import {
  createPermissionBatch,
  parsePermissionRules,
  type PermissionAskRequest,
  type SessionAllowRule,
  type OnToolCallAllowed,
} from "../permissions/index.ts";
export type { PermissionAskRequest, SessionAllowRule } from "../permissions/index.ts";
import { fileTrackingState } from "../file-tracking/index.ts";
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
  createGoalRuntime,
  type GoalView,
} from "../tools/goal/index.ts";
import { subagentsState, subagentRunState, type SubagentRun } from "../tools/subagents/index.ts";
import type { QuestionReply, QuestionRequest } from "../tools/question.ts";
import { mergeHooks, type CommonHookResult, type HookInput } from "../hooks/index.ts";
import type { WebFetchOptions } from "../tools/web-fetch/index.ts";
import { validateImage, type PromptImage } from "../images/index.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { createThinkingTiming } from "./thinking.ts";
import { createSubagentController } from "../tools/subagents/index.ts";
import { createToolLoadout } from "./tools.ts";
import { createConversationObservation } from "./observation.ts";

type RequestResult = RunResult & { requestId: string };
interface RunSummaryFact {
  afterMessage: number;
  durationMs: number;
  endedAt: number;
  success: boolean;
}
export interface SessionOptions {
  /** Frontend product version for application requests; omitted hosts identify as Rukie without a version. */
  applicationVersion?: string;
  /** Bounds initialization resources only; after opening, the host owns Session.close(). */
  initializationSignal?: AbortSignal;
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
  /** Foreground admission, native parent Runs and manual Compaction; background children are independent. */
  readonly running: boolean;
  /** Cancels the current run, including one started without a frontend controller. */
  abort(): Promise<void>;
  /** Queue another user instruction for the current Run, including Skill Invocation. */
  steer(prompt: string, options?: { images?: PromptImage[] }): Promise<void>;
  /** Receive a committed snapshot followed by live updates, including active startup autoruns. */
  subscribe(onEvent: (event: SessionEvent) => void): () => void;
  /** Current Session's background jobs, including settled records; excludes foreground work. */
  jobs(): JobView[];
  /** Read from an absolute UTF-8 byte offset without moving the model's job_output cursor. */
  readJob(id: string, offset: number): JobOutput;
  /** Stop a job; inform the active Run or queue input for the next human prompt while idle. */
  killJob(id: string): Promise<void>;
  readonly currentRequestId: string | undefined;
  /** Settle this accepted request and its finite owned descendants; parent Run idle alone is insufficient. */
  waitForRequest(requestId: string): Promise<RequestResult>;
  readonly id: string;
  readonly title: string;
  readonly titleSource: TitleSource | undefined;
  rename(title: string): Promise<void>;
  /** Current model identity, including a restored session selection. */
  readonly model: string;
  readonly thinkingLevel: ThinkingLevel;
  /** Persist both selection fields atomically for subsequent requests; requires idle state. */
  setModelSelection(selection: {
    model?: string;
    thinkingLevel?: ThinkingLevel;
  }): Promise<{ model: string; thinkingLevel: ThinkingLevel; clampedFrom?: ThinkingLevel }>;
  readonly permissionMode: PermissionMode;
  readonly planMode: boolean;
  /** Persisted Goal facts and authorization from its accepted native continuation task. */
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
  /** Chronological committed Transcript for the active branch, including compacted history. */
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
        title: string;
        description: string;
        /** Committed context before the latest Run's native start entry; excludes its current Turns. */
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
  /** Cancel the selected active child ownership and await its native terminal settlement. */
  interruptSubagent(id: string): Promise<void>;
  /** Closes the owner once; pending native work remains resumable while host resources are released. */
  close(reason?: "exit" | "other"): Promise<void>;
  /** Wait for native foreground idle and host admission release; background children may remain active. */
  waitForIdle(): Promise<void>;
  /** Waits behind a startup Hook Run; other active foreground work rejects competing admission. */
  run(
    prompt: string,
    options?: {
      images?: PromptImage[];
      signal?: AbortSignal;
      /** Observes committed Session events until this parent Run settles; observer promises do not delay execution. */
      onEvent?: (event: SessionEvent) => void | Promise<void>;
    },
  ): Promise<RequestResult>;
}

const ChildFactsDoc = defineDoc<{ title: string; description: string }>({
  kind: "rukie.child-facts",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ title: "", description: "" }),
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

/** One native Harness owns every request, task, entry and conversation of this Session. */
export async function createSession(options: SessionOptions): Promise<Session> {
  options.initializationSignal?.throwIfAborted();
  const context = BACKGROUND_CONTEXT;
  const settings = options.settings ?? {};
  const cwd = resolve(options.cwd);
  const warn = (warning: unknown) => (options.onWarning ?? console.warn)(String(warning));
  if (options.allowRules) parsePermissionRules({ allow: options.allowRules }, "--allow-tools");
  const permissionRules = parsePermissionRules({
    ...settings.permissions,
    allow: [...(settings.permissions?.allow ?? []), ...(options.allowRules ?? [])],
  });
  const resolved =
    options.model && options.models
      ? { model: options.model, models: options.models }
      : await resolveModel(settings, options.homeDir, warn);
  let model = resolved.model;
  let thinkingLevel = supportedThinkingLevel(model, settings.thinking ?? "off");
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
    await validateSessionDocuments(lease.storage, context);
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
    let ledger: ReturnType<typeof createRequestLedger>;
    let contextMessages: readonly Message[] = [];
    let runSummaries: RunSummaryFact[] = [];
    const thinking = createThinkingTiming(() => performance.now());
    let thinkingTask: number | undefined;
    let modelFact = `${model.provider}/${model.id}`;
    const auxiliaryLifetime = new AbortController();
    let notificationLifetime = new AbortController();
    let startupStopReason: string | undefined;
    let selectingModel = false;
    let foregroundAdmission: Promise<void> | undefined;
    let manualCompaction = false;
    let manualCompactionTask: TaskId | undefined;
    let goalRound = false;
    const steeringAdmissions = new Set<Promise<void>>();
    let checkingStop: number | undefined;
    let permissionMode = options.permissionMode ?? settings.permissionMode ?? "ask";
    const sessionAllowRules = options.sessionAllowRules ?? [];
    const sessionGrantListeners = new Set<() => void>();
    let observation: Awaited<ReturnType<typeof createConversationObservation>>;
    let storageFailure: unknown;
    const storageFault = Promise.withResolvers<never>();
    void storageFault.promise.catch(() => {});
    const commitStorage = lease.storage.commit.bind(lease.storage);
    // A failed backend admission poisons native ownership and must wake local callers
    // even though no durable submission receipt can be fabricated for that failure.
    const observedStorage = new Proxy(lease.storage, {
      get(target, key) {
        if (key === "document")
          return async (...args: Parameters<Storage["document"]>) => {
            const document = await target.document(...args);
            validateSessionDocument(document);
            return document;
          };
        if (key === "commit")
          return async (...args: Parameters<Storage["commit"]>) => {
            try {
              // Native fork copies are definition-free; validate their exact historical source before admission.
              for (const write of args[0])
                if (write.type === "document.copy")
                  validateSessionDocument(
                    await target.document(write.source.id, write.source.at, args[1]),
                  );
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
    const permissionBatch = createPermissionBatch(harness);
    const runtime = createConversationRuntime({
      lifetime: auxiliaryLifetime.signal,
      isClosed: () => closed,
    });
    failedCleanup.push(async () => {
      try {
        await harness.close(context);
      } finally {
        permissionBatch.close();
      }
    });
    let conversation = await harness.root(context, {
      agent: {
        model: { provider: model.provider, modelId: model.id },
        cwd,
        instructions: SYSTEM_PROMPT,
        thinkingLevel,
      },
      init: async (tx, id) => {
        await tx.appendEntry(id, { kind: "rukie.initial" });
      },
    });
    let metadata = await harness.snapshot(SessionMetadataDoc, context);
    if (metadata) metadata = parseSessionMetadata(metadata);
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
    const savedAgent = await conversation.agent(context);
    const savedModel = savedAgent.model;
    if (savedModel) {
      const restored = models.getModel(savedModel.provider, savedModel.modelId);
      if (!restored)
        throw new Error(`Unknown restored model: ${savedModel.provider}/${savedModel.modelId}`);
      model = restored;
    }
    thinkingLevel = supportedThinkingLevel(model, savedAgent.thinkingLevel);
    if (thinkingLevel !== savedAgent.thinkingLevel)
      await conversation.configure({ thinkingLevel }, context);
    modelFact = `${model.provider}/${model.id}`;
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
    // AgentDoc owns selection; legacy product mirrors have no saved Thinking Level.
    const synchronizeModelState = async () => {
      const saved = state.get("model");
      if (
        saved !== undefined &&
        JSON.stringify(saved) !==
          JSON.stringify({ model: `${model.provider}/${model.id}`, thinkingLevel })
      )
        await state.set(
          "model",
          { model: `${model.provider}/${model.id}`, thinkingLevel },
          context,
        );
    };
    await synchronizeModelState();
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
    runtime.createHooks({
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
            const parentRequestId = live?.run ? ledger.currentRequestId : undefined;
            const requestId = requestIds.hook();
            const submitted = await conversation.submit(
              {
                type: "input",
                content: reason,
                requestId,
                whenBusy: "steer",
              },
              context,
            );
            if (!parentRequestId) ledger.setForeground(requestId);
            await ledger.registerSubmission(parentRequestId ?? requestId, submitted.id);
            if (!parentRequestId)
              void ledger
                .resultFor(requestId, submitted.id)
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
    const hooks = runtime.hookTranscript({
      path: () => hookTranscriptPath(lease.id),
      history: async () => fullHistory(),
      enabled:
        !!settings.hooks && Object.values(settings.hooks).some((groups) => groups.length > 0),
    });
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
        runtime.stopped = true;
        runtime.stopReason = result.stopReason ?? "Stopped by hook.";
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
    const tracking = runtime.createFileTracking(cwd, {
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
    const goalRuntime = createGoalRuntime({
      harness,
      storage: lease.storage,
      conversation: () => conversation,
      context,
      ledger: () => ledger,
      submit: async (prompt, requestId, ctx) =>
        (await awaitWithContext(submit(prompt, [], "followUp", requestId, ctx.abortSignal), ctx))
          .id,
      settle: async (requestId, ctx) => awaitWithContext(session.waitForRequest(requestId), ctx),
      settleCancelled: async (requestId, submissionId, ctx) =>
        awaitWithContext(ledger.resultFor(requestId, submissionId), ctx),
    });
    await goalRuntime.restore(state.get("goal"));
    const goal = createGoalController({
      isArmed: goalRuntime.isArmed,
      getSnapshot: () => state.get("goal"),
      persist: goalRuntime.persist,
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
    const mcp = createMcpConnections(mcpAuthState, options.applicationVersion);
    const reconnectMcpServers = new Set<string>();
    const mcpManager = createMcpManager({
      createConnections: () => createMcpConnections(mcpAuthState, options.applicationVersion),
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
      getBusy: () => selectingModel || foregroundAdmission !== undefined || manualCompaction,
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
    const jobs = runtime.createJobs({
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
              runtime.stopped = false;
              const requestId = requestIds.job(job.id, job.startedAt);
              const submitted = await submit(content, [], "followUp", requestId);
              void ledger
                .resultFor(requestId, submitted.id)
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
      await runtime.disposeJobs(true);
      await mcpManager.close();
      await mcp.close();
      runtime.disposeHooks();
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
    let toolLoadout: ReturnType<typeof createToolLoadout>;
    async function persistDenial(
      owner: typeof conversation,
      event: Parameters<typeof permissionDenialFacts>[1],
    ) {
      const live = await harness.snapshot(LiveDoc, owner.id, context);
      const slot = live?.tools?.find((tool) => tool.callId === event.toolCallId);
      if (slot?.taskId === undefined)
        throw new Error("Permission denial has no committed native tool task.");
      await owner.commit(
        (tx) =>
          tx.appendEntry(owner.id, {
            kind: "rukie.message-facts",
            data: permissionDenialFacts(slot.taskId!, event),
          }),
        context,
      );
    }
    runtime.configurePolicy({
      hooks: hooks,
      input: hookInput,
      apply: applyHookResult,
      batch: permissionBatch,
      permission: {
        cwd,
        homeDir: options.homeDir,
        rules: permissionRules,
        sessionAllowRules,
        sessionGrantListeners,
        getMode: () => permissionMode,
        getTools: () => toolLoadout?.registrations ?? [],
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
              record.type === "input" && requestKind(record.requestId) === "human" && record.entry
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
        onEvent: async (event) => {
          if (event.type === "permission_denied") await persistDenial(conversation, event);
          custom(event);
        },
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

        isMcpAuthTool: (name) => mcp.authTools.has(name),
      },
    });
    const childRuntimes = createConversationRuntimePool({
      lifetime: auxiliaryLifetime.signal,
      isClosed: () => closed,
    });
    const childRuntimeFor = childRuntimes.forConversation;
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
      childRuntimeFor(Number(child.id), { agentId: childId, description }).createHooks({
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
                const requestId = requestIds.hook(childId);
                const submitted = await submit(reason, [], "followUp", requestId);
                void ledger
                  .resultFor(requestId, submitted.id)
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

      return childRuntimeFor(Number(child.id), { agentId: childId, description }).hookTranscript({
        path: () => hookTranscriptPath(childId),
        history: async () => fullHistory(child.id),
        enabled: Object.values(mergeHooks(settings.hooks, type.hooks)).some(
          (groups) => groups.length > 0,
        ),
      });
    };
    const childResources = new Map<
      number,
      {
        observation: Awaited<ReturnType<typeof createConversationObservation>>;
      }
    >();
    const subagents = createSubagentController({
      onWarning: warn,
      harness,
      parent: conversation,
      parentSessionId: lease.id,
      state: subagentsDefinition,
      restored: state.get("subagents") as
        | import("../tools/subagents/index.ts").SubagentIdentity[]
        | undefined,
      models,
      parentModel: () => model,
      subagentModel: settings.subagentModel,
      async beforeStart(request, child, ctx, selection) {
        const { type, model: selected } = selection;
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
        await childRuntimes.get(Number(child.id))?.clearJobs();
      },
      async childAgent(type, child, selection) {
        const selected = selection.model;
        const directory = subagents.list().find((row) => row.conversationId === Number(child.id));
        const description = directory?.description ?? type.description;
        const childId = directory?.id ?? String(child.id);
        const childRuntime = childRuntimeFor(Number(child.id), { agentId: childId, description });
        childRuntime.reset();
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
            childRuntime.stopped = true;
            childRuntime.stopReason = result.stopReason;
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
        const childJobs = childRuntime.createJobs({
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
        const childTracking = childRuntime.createFileTracking(cwd, {
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
        let childLoadout: ReturnType<typeof createToolLoadout>;
        childRuntime.configurePolicy({
          hooks: childHooks,
          input: childInput,
          apply: applyChildHook,
          batch: permissionBatch,
          permission: {
            cwd,
            homeDir: options.homeDir,
            rules: parsePermissionRules({
              ...settings.permissions,
              allow: [...(settings.permissions?.allow ?? []), ...(options.allowRules ?? [])],
            }),
            sessionAllowRules,
            sessionGrantListeners,
            getMode: () => permissionMode,
            getTools: () => childLoadout.registrations,
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
                  requestKind(record.requestId) === "human" && record.entry ? [record.entry] : [],
                ),
              );
              return view.entries.flatMap((entry) =>
                (entry.model ?? []).filter(
                  (message) =>
                    message.role === "assistant" ||
                    (message.role === "user" && human.has(entry.id)),
                ),
              );
            },
            getProjectInstructions: () => [],
            getReviewModel: () => async () =>
              settings.reviewModel ? selectedModel(settings.reviewModel) : selected,
            models,
            onPermissionAsk: options.onPermissionAsk,
            onInteractionStart: childNotify,
            onToolCallAllowed: async (call) => {
              await checkpoints.record(call, cwd, options.homeDir);
              await options.onToolCallAllowed?.(call);
            },
            onEvent: async (event) => {
              if (event.type === "permission_denied") await persistDenial(child, event);
              custom({
                type: "subagent_event",
                agentId: childId,
                description,
                subagentType: type.name,
                event: { ...event, sessionId: childId },
              });
            },
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

            isMcpAuthTool: (name) => mcp.authTools.has(name),
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
        childLoadout = createToolLoadout({
          kind: "child",
          builtin: () => ({
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
            applicationVersion: options.applicationVersion,
            fileTracking: childTracking,
          }),
          allowed: type.tools,
          conversation: () => child,
          history: () => fullHistory(child.id),
          context,
          model: () => selected,
          mode: settings.toolSearch,
          mcp: () => mcp.tools,
          wrap: (tools) => childRuntime.wrapTools(tools),
        });
        await childLoadout.refresh();
        const childDeferredSource: ReminderSource = {
          source: "deferred-tools",
          compareContent: false,
          currentContent: async (history) =>
            deferredToolsReminder(
              (await childLoadout.plan()).deferred.map((tool) => tool.name),
              history ?? [],
            ),
        };
        const extension = {
          name: `rukie.child.${child.id}`,
          tools: childLoadout.registrations,
          hooks: [
            hook(ToolTask, {
              beforeTool: childRuntime.beforeTool,
              afterTool: childRuntime.afterTool,
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
                  messages: transcriptMessages(
                    view.entries.filter(
                      (entry) =>
                        entry.kind !== "rukie.reminder" ||
                        entryData(entry)?.source !== "deferred-tools" ||
                        Number(entry.conversationId) === Number(child.id),
                    ),
                  ),
                  cwd,
                  homeDir: options.homeDir,
                  now: options.now?.() ?? new Date(),
                  sources: [
                    ...childState.reminderSources,
                    childDeferredSource,
                    {
                      source: "skills",
                      compareContent: false,
                      currentContent: () =>
                        skillsReminder(
                          skills,
                          visibleReminderContents(view, "skills"),
                          childLoadout.registrations.some((tool) => tool.name === "skill"),
                        ),
                    },
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
                return { messages: modelContextMessages(await child.context(ctx)) };
              },
              afterResponse: async () => {
                childTracking.finishRequest();
              },
              onYield: async (answer, api, ctx) => {
                if (answer.stopReason !== "stop") return undefined;
                const live = await harness.snapshot(LiveDoc, child.id, ctx);
                const anchor = Number(live?.run?.inputs[0]);
                const continuationPolicy = await stopHookContinuation(
                  harness,
                  child.id,
                  anchor,
                  "SubagentStop",
                  ctx,
                );
                const result = await childHooks.run(
                  "SubagentStop",
                  childInput({
                    stop_hook_active: continuationPolicy.active,
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
                if (continuationPolicy.warning) {
                  warn(continuationPolicy.warning.message);
                  await child.commit(
                    (tx) =>
                      tx.appendEntry(child.id, {
                        kind: "rukie.notice",
                        data: {
                          role: "session-notice",
                          notice: {
                            kind: "hook_warning",
                            ...continuationPolicy.warning,
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
                      ...continuationPolicy.warning,
                      sessionId: childId,
                    },
                  });
                  return undefined;
                }
                const reason = result.reason;
                await child.commit(async (tx) => {
                  await continuationPolicy.advance(tx);
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
                if (childRuntime.stopped) {
                  await child.commit(
                    (tx) =>
                      tx.appendEntry(child.id, {
                        kind: "rukie.notice",
                        data: {
                          role: "session-notice",
                          notice: {
                            kind: "hook_stopped",
                            reason: childRuntime.stopReason ?? "Stopped by hook.",
                          },
                          timestamp: Date.now(),
                        },
                      }),
                    ctx,
                  );
                  await child.abort(ctx);
                  return;
                }
                await childLoadout.refresh();
                const updated = { ...extension, tools: childLoadout.registrations };
                registry.install(updated);
                await child.configure(
                  { extensions: [updated], tools: (await childLoadout.plan(false, ctx)).tools },
                  ctx,
                );
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
            history: () => fullHistory(child.id),
            tools: () => childLoadout.registrations,
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
          childResources.set(Number(child.id), { observation: childObservation });
        }
        return {
          model: { provider: selected.provider, modelId: selected.id },
          ...(type.name === "fork"
            ? settings.thinking
              ? { thinkingLevel: settings.thinking }
              : {}
            : { thinkingLevel: supportedThinkingLevel(selected, settings.thinking ?? "off") }),
          cwd,
          instructions: SYSTEM_PROMPT,
          extensions: [extension],
          tools: (await childLoadout.plan(!selection.retained)).tools,
        };
      },
    });
    failedCleanup.push(async () => {
      subagents.close();
      for (const owner of childRuntimes.values()) owner.disposeHooks();
      for (const resource of childResources.values()) {
        await resource.observation.close();
      }
      for (const owner of childRuntimes.values()) await owner.disposeJobs(true);
    });
    const pendingCompactions = new Map<number, EntryRecord>();
    const compactFocus = new Map<number, string>();
    let compactionHooks = Promise.resolve();
    const stopCompactionByHook = async (reason: string, caller = context) => {
      await conversation.commit(async (tx) => {
        await ledger.recordOutcome(tx, conversation.id, { kind: "hook-stop", reason });
        await tx.appendEntry(conversation.id, {
          kind: "rukie.notice",
          data: {
            role: "session-notice",
            notice: { kind: "hook_stopped", reason },
            timestamp: Date.now(),
          },
        });
      }, context);
      runtime.stopped = true;
      runtime.stopReason = reason;
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
      const visibleContext = await conversation.context(ctx);
      const deferred = (await toolLoadout.plan(false, ctx)).deferred;
      const sources: ReminderSource[] = [
        {
          source: "deferred-tools",
          compareContent: false,
          currentContent: (history) =>
            deferredToolsReminder(
              deferred.map((tool) => tool.name),
              history ?? [],
            ),
        },
        {
          source: "skills",
          compareContent: false,
          currentContent: () =>
            skillsReminder(
              skills,
              visibleReminderContents(visibleContext, "skills"),
              toolLoadout.registrations.some((tool) => tool.name === "skill"),
            ),
        },
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
    let preparedMcpRequestId: string | undefined;
    let preparedMcpRun: number | undefined;
    const refreshMcp = async (signal?: AbortSignal) => {
      const connectionOptions: Parameters<typeof mcp.connect>[0] = {
        cwd,
        homeDir: options.homeDir,
        settings,
        trustProjectMcp: options.trustProjectMcp,
        interactive: !!options.onMcpAuth,
        onMcpAuth: options.onMcpAuth,
        onInteractionStart: notifyInteraction,
        signal,
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
    };
    toolLoadout = createToolLoadout({
      kind: "root",
      conversation: () => conversation,
      history: () => fullHistory(),
      context,
      model: () => model,
      mode: settings.toolSearch,
      mcp: () => mcp.tools,
      wrap: (tools) => runtime.wrapTools(tools),
      refreshSkills: async () => {
        skills = await loadSkills();
      },
      base: () => ({
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
          applicationVersion: options.applicationVersion,
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
              goalRuntime.queueWrapup(text);
            },
          },
        },
      }),
      controller: subagents,
      discovery: {
        cwd,
        homeDir: options.homeDir,
        trusted: isTrustedProject(cwd, settings),
        report: async (discovery) => {
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
        },
      },
      install: async (_registrations, offered, ctx) => {
        const extension = {
          name: "rukie.session",
          tools: toolLoadout.registrations,
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
            hook(ToolTask, { beforeTool: runtime.beforeTool, afterTool: runtime.afterTool }),
            hook(GenerationTask, {
              beforeRequest: async (_request, api, ctx) => {
                const live = await harness.snapshot(LiveDoc, conversation.id, ctx);
                if (live?.run && preparedMcpRun !== Number(live.run.taskId)) {
                  const inputs = await Promise.all(
                    live.run.inputs.map((id) => lease.storage.submission(id, ctx)),
                  );
                  // Human Runs already discover MCP before admission, including cancellation.
                  // Goal rounds and reporters refresh once at their native Run boundary.
                  if (
                    preparedMcpRequestId === undefined ||
                    !inputs.some((input) => input?.requestId === preparedMcpRequestId)
                  )
                    await refreshMcp(ctx.abortSignal);
                  preparedMcpRun = Number(live.run.taskId);
                }
                await processCompactionHooks(ctx);
                if (live?.run) {
                  const placed = await Promise.all(
                    live.run.inputs.map((id) => lease.storage.submission(id, ctx)),
                  );
                  if (await goalRuntime.beforeRequest(placed, ctx)) goalRound = true;
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
                        record &&
                        requestKind(record.requestId) === "human" &&
                        record.entry === latestInput?.id,
                    )
                  )
                    goalRound = false;
                  const humanInput = placed.findLast(
                    (record) =>
                      record &&
                      requestKind(record.requestId) === "human" &&
                      record.entry === latestInput?.id,
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
                      let requestIds = [record.requestId];
                      const identity = parseRequestId(record.requestId);
                      const report = identity.kind === "subagent-report" ? identity : undefined;
                      if (report) {
                        const all = await lease.storage.scanTasks({}, 100000, undefined, ctx);
                        const driver = all.items.find((task) => Number(task.id) === report.taskId);
                        const originals =
                          driver && (await ledger.requestCausesForTasks(all.items))(driver);
                        if (originals?.size) requestIds = [...originals];
                      }
                      await harness.commit(async (tx) => {
                        for (const requestId of requestIds)
                          await ledger.bind(tx, requestId, {
                            submissionId: Number(record.id),
                            taskId: Number(live.run!.taskId),
                          });
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
                    record &&
                    requestKind(record.requestId) === "human" &&
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
                await goalRuntime.prepareWrapup(ctx);
                await prepareReminders(ctx);
                await toolLoadout.publish(ctx);
                contextMessages = modelContextMessages(await conversation.context(ctx));
                await observation.flush();
                custom(contextUsage(contextMessages, model.contextWindow, latestInputTokens()));
                return { messages: contextMessages };
              },
              afterResponse: async (message, api, ctx) => {
                tracking.finishRequest();
                const inputTokens =
                  message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
                // Stop hooks can remain pending before the native assistant entry is appended.
                // Persist provider measurements first so observers never see uncommitted usage.
                if (Number.isFinite(inputTokens) && inputTokens >= 0) {
                  await conversation.commit(
                    (tx) =>
                      tx.appendEntry(conversation.id, {
                        kind: "rukie.message-facts",
                        data: {
                          taskId: Number(api.taskId),
                          provider: message.provider,
                          model: message.model,
                          inputTokens,
                        },
                      }),
                    ctx,
                  );
                  await observation.flush();
                  custom(
                    contextUsage(contextMessages, model.contextWindow, inputTokens || undefined),
                  );
                }
                if (message.stopReason === "error" || message.stopReason === "aborted") {
                  await goalRuntime.clearActivation(ctx);
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
                  await conversation.commit(async (tx) => {
                    await ledger.recordOutcome(tx, conversation.id, { kind: "plan-takeover" }, ctx);
                  }, ctx);
                  await conversation.abort(ctx);
                  return;
                }
                if (runtime.stopped && runtime.stopReason) {
                  const reason = runtime.stopReason;
                  await conversation.commit(async (tx) => {
                    await ledger.recordOutcome(tx, conversation.id, { kind: "hook-stop", reason });
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
                if (toolLoadout.hasMcpDrift()) await rebuildTools();
              },
              onYield: async (_answer, api, ctx) => {
                // A caller may start steering before releasing an in-flight model.
                // Complete host admission before the native final boundary selects its inbox.
                await Promise.allSettled(steeringAdmissions);
                if (_answer.stopReason !== "stop") {
                  await goalRuntime.clearActivation(ctx);
                  return undefined;
                }
                const yielding = await harness.snapshot(LiveDoc, conversation.id, ctx);
                const inputs = await Promise.all(
                  (yielding?.run?.inputs ?? []).map((id) => lease.storage.submission(id, ctx)),
                );
                const requestIds = new Set(
                  inputs.flatMap((input) => (input?.requestId ? [input.requestId] : [])),
                );
                const tasks = (await lease.storage.scanTasks({}, 100000, undefined, ctx)).items;
                const causes = await ledger.requestCausesForTasks(tasks);
                if (
                  tasks.some(
                    (task) =>
                      task.kind === "rukie.subagent-driver" &&
                      task.state.status !== "terminal" &&
                      [...causes(task)].some((id) => requestIds.has(id)),
                  )
                )
                  return undefined;
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
                const goalWrapup = await goalRuntime.yieldWrapup(Number(api.taskId), ctx);
                if (goalWrapup) return goalWrapup;
                const live = await harness.snapshot(LiveDoc, conversation.id, ctx);
                const runAnchor = Number(live?.run?.inputs[0]);
                const continuationPolicy = await stopHookContinuation(
                  harness,
                  conversation.id,
                  runAnchor,
                  "Stop",
                  ctx,
                );
                checkingStop = runAnchor;
                const result = await hooks
                  .run(
                    "Stop",
                    hookInput({
                      stop_hook_active: continuationPolicy.active,
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
                  const reason = result.stopReason ?? "Stopped by hook.";
                  await conversation.commit(async (tx) => {
                    await ledger.recordOutcome(tx, conversation.id, { kind: "hook-stop", reason });
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
                  if (continuationPolicy.warning) {
                    warn(continuationPolicy.warning.message);
                    await appendNotice(
                      {
                        kind: "hook_warning",
                        ...continuationPolicy.warning,
                      },
                      ctx,
                    );
                    custom({
                      type: "hook_warning",
                      ...continuationPolicy.warning,
                    });
                    return undefined;
                  }
                  await conversation.commit(async (tx) => {
                    await continuationPolicy.advance(tx);
                  }, ctx);
                  custom({ type: "hook_continued", event: "Stop", reason: result.reason });
                  return continuation(result.reason, "stop_hook");
                }
                return undefined;
              },
            }),
          ],
        };
        registry.install(goalRuntime.extension);
        registry.install(subagents.extension);
        registry.install(extension);
        await conversation.configure(
          {
            extensions: [extension, subagents.extension, goalRuntime.extension],
            tools: [...offered],
          },
          ctx,
        );
      },
    });
    const rebuildTools = toolLoadout.rebuild;
    await rebuildTools();
    contextMessages = (await conversation.context(context)).messages;
    observation = await createConversationObservation({
      harness,
      conversation,
      sessionId: lease.id,
      history: () => fullHistory(),
      tools: () => toolLoadout.registrations,
      liveAssistantFacts: () =>
        thinking.duration() !== undefined ? { rukieThinkingDurationMs: thinking.duration() } : {},
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
          goalRuntime.observe(change);
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
        toolStates: {
          ...state.snapshot(),
          goal: state.get("goal")
            ? {
                ...(state.get("goal") as Omit<GoalView, "armed">),
                armed: goalRuntime.isArmed(),
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
    failedCleanup.push(async () => {
      unregister();
      await observation.close();
    });
    ledger = createRequestLedger({
      harness,
      storage: lease.storage,
      context,
      conversation: () => conversation,
      history: fullHistory,
      flush: () => observation.flush(),
      updateContext: (messages) => {
        contextMessages = messages;
      },
      fault: storageFault.promise,
      assertAvailable,
      goalReceipt: readGoalReceipt,
      subagentReceipt: readSubagentReceipt,
      publish: (result) => custom({ type: "request_settled", ...result }),
    });
    async function submit(
      prompt: string,
      images: PromptImage[] = [],
      whenBusy: "reject" | "steer" | "followUp" = "reject",
      requestId = requestIds.human(),
      signal?: AbortSignal,
    ) {
      assertAvailable();
      images.forEach(validateImage);
      const hookResult =
        requestKind(requestId) === "human"
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
          await ledger.recordResult(tx, result);
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
      const admissionContext = signal ? withAbortSignal(signal, context) : context;
      await prepareReminders(admissionContext, true, undefined, requestId);
      signal?.throwIfAborted();
      if (requestKind(requestId) === "human") await title.firstPrompt(prompt);
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
        admissionContext,
      );
      if (requestKind(requestId) !== "goal-round") ledger.setForeground(requestId);
      await ledger.registerSubmission(requestId, submitted.id);
      const record = await submitted.status(context);
      if (images.length || invocation || !(requestKind(requestId) === "human")) {
        const facts: Record<string, JsonValue> = {
          ...(images.length ? { imageNames: images.map((image) => image.name ?? null) } : {}),
          ...(invocation ? { skillInvocation: invocation } : {}),
          ...(!(requestKind(requestId) === "human")
            ? {
                source:
                  requestKind(requestId) === "goal-round" ||
                  requestKind(requestId) === "goal-activation"
                    ? "goal"
                    : requestKind(requestId) === "job"
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
      const measurement = entries.findLast((entry) => {
        const data = entry.data;
        return (
          Number(entry.id) > compacted &&
          entry.kind === "rukie.message-facts" &&
          data !== null &&
          typeof data === "object" &&
          !Array.isArray(data) &&
          data.provider === model.provider &&
          data.model === model.id &&
          typeof data.inputTokens === "number" &&
          Number.isFinite(data.inputTokens) &&
          data.inputTokens >= 0
        );
      });
      const last = entries
        .filter((entry) => Number(entry.id) > compacted)
        .flatMap((entry) => entry.model ?? [])
        .findLast(
          (message) =>
            message.role === "assistant" &&
            message.provider === model.provider &&
            message.model === model.id,
        );
      const measuredData = measurement?.data;
      return measuredData !== null &&
        typeof measuredData === "object" &&
        !Array.isArray(measuredData) &&
        typeof measuredData.inputTokens === "number"
        ? measuredData.inputTokens || undefined
        : last?.role === "assistant"
          ? last.usage.input + last.usage.cacheRead + last.usage.cacheWrite || undefined
          : undefined;
    }
    const session: Session = {
      get running() {
        return (
          !closed &&
          storageFailure === undefined &&
          (foregroundAdmission !== undefined || manualCompaction || observation.running())
        );
      },
      get currentRequestId() {
        return ledger.currentRequestId;
      },
      id: lease.id,
      get title() {
        return title.title;
      },
      get titleSource() {
        return title.source;
      },
      rename: async (value) => title.rename(value),
      get model() {
        return `${model.provider}/${model.id}`;
      },
      get thinkingLevel() {
        return thinkingLevel;
      },
      async setModelSelection(selection) {
        assertAvailable(true);
        const next = selection.model === undefined ? model : selectedModel(selection.model);
        const requested = selection.thinkingLevel ?? thinkingLevel;
        const nextThinkingLevel = supportedThinkingLevel(next, requested);
        const spec = `${next.provider}/${next.id}`;
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
          await conversation.commit(async (tx) => {
            await configure(tx, conversation.id, {
              model: { provider: next.provider, modelId: next.id },
              thinkingLevel: nextThinkingLevel,
            });
            (await tx.doc(modelState.document, conversation.id)).value = {
              model: spec,
              thinkingLevel: nextThinkingLevel,
            };
          }, context);
          model = next;
          thinkingLevel = nextThinkingLevel;
          await state.refresh();
          await writeMetadata();
          return {
            model: spec,
            thinkingLevel,
            ...(thinkingLevel !== requested ? { clampedFrom: requested } : {}),
          };
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
        const requestId = goalRuntime.activation.requestId;
        if (!requestId) throw new Error("Created Goal has no accepted driver.");
        return { ...goal.view()!, requestId };
      },
      editGoal: async (objective) => {
        const prior = goal.view();
        const value = await goal.edit(objective);
        const requestId =
          prior?.phase === "complete" ? goalRuntime.activation.requestId : undefined;
        return { ...value, ...(requestId ? { requestId } : {}) };
      },
      pauseGoal: () => goal.pause(),
      resumeGoal: async () => {
        const value = await goal.resume();
        const requestId = goalRuntime.activation.requestId;
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
      contextUsage: () =>
        contextUsage(modelMessages(), model.contextWindow, latestInputTokens(), {
          instructions: SYSTEM_PROMPT,
          tools: toolLoadout.registrations,
        }),
      contextReport: () =>
        contextReport({
          messages: modelMessages(),
          inputTokens: latestInputTokens(),
          entries: observation.view().entries,
          model: `${model.provider}/${model.id}`,
          window: model.contextWindow,
          mcpServers: mcp.toolServers,
          configured: { instructions: SYSTEM_PROMPT, tools: toolLoadout.registrations },
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
          const parent = ledger.currentRequestId;
          const requestId = requestIds.jobStopped(id, job.view.startedAt);
          await conversation.commit(async (tx) => {
            const pending = await tx.doc(JobStopsDoc, conversation.id);
            pending.pending[requestId] = content;
          }, context);
          const submitted = await submit(content, [], "steer", requestId);
          if (parent) await ledger.registerSubmission(parent, submitted.id);
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
          const history = await conversation.context(context);
          if (
            !history.entries.some(
              (entry) => entry.kind !== "rukie.reminder" && (entry.model?.length ?? 0) > 0,
            )
          )
            throw createUserVisibleError("No conversation history to compact.", {
              code: "compaction-no-history",
              params: {},
            });
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
          const directory = await subagents.snapshotForRewind(previous.id, context);
          const forkRecord = await conversation.commit(async (tx) => {
            const active = await tx.doc(SessionMetadataDoc);
            const fork = await tx.forkConversation(conversation.id, previous.id, {
              ownership: { kind: "ownerless" },
            });
            await subagents.restoreFork(tx, fork.id, directory);
            active.activeConversationId = Number(fork.id);
            active.updatedAt = Date.now();
            return fork;
          }, context);
          const fork = await harness.conversation(forkRecord.id, context);
          if (!fork) throw new Error("Committed rewind conversation is missing.");
          await observation.close();
          conversation = fork;
          const restoredAgent = await conversation.agent(context);
          if (restoredAgent.model)
            model = selectedModel(`${restoredAgent.model.provider}/${restoredAgent.model.modelId}`);
          thinkingLevel = restoredAgent.thinkingLevel;
          modelFact = `${model.provider}/${model.id}`;
          runSummaries = readRunSummaries(await fullHistory());
          await writeMetadata();
          state = await createToolState(definitions, harness, conversation, context);
          await synchronizeModelState();
          await subagents.rebindParent(conversation, context);
          plan.restore();
          tracking.restore(state.get("file-tracking"));
          await tracking.restoreCommitted(await fullHistory());
          await rebuildTools();
          const rewindEvents: SessionEvent[] = [];
          let rewindInstalled = false;
          observation = await createConversationObservation({
            harness,
            conversation,
            sessionId: lease.id,
            history: () => fullHistory(),
            tools: () => toolLoadout.registrations,
            liveAssistantFacts: () =>
              thinking.duration() !== undefined
                ? { rukieThinkingDurationMs: thinking.duration() }
                : {},
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
        return subagents.interrupt(id, context);
      },
      async abort() {
        assertAvailable();
        notificationLifetime.abort();
        notificationLifetime = new AbortController();
        runtime.stopped = true;
        const goalAbort = goalRuntime.abort(context);
        if (manualCompactionTask) await harness.abortTask(manualCompactionTask, context);
        await conversation.abort(context);
        await goalAbort;
        await observation.flush();
      },
      async steer(prompt, input) {
        const parentRequestId = ledger.currentRequestId;
        const admission = (async () => {
          const submitted = await submit(prompt, input?.images, "steer");
          if (parentRequestId) await ledger.registerSubmission(parentRequestId, submitted.id);
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
        if (observation.running() && requestKind(ledger.currentRequestId) === "hook") {
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
        const admissionFinished = Promise.withResolvers<void>();
        foregroundAdmission = admissionFinished.promise;
        runtime.stopped = false;
        runtime.stopReason = undefined;
        goalRound = false;
        const abort = () => {
          notificationLifetime.abort();
          notificationLifetime = new AbortController();
          runtime.stopped = true;
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
          await refreshMcp(input.signal);
          input.signal?.throwIfAborted();
          const requestId = requestIds.human();
          preparedMcpRequestId = requestId;
          const submission = await submit(prompt, input.images, "reject", requestId, input.signal);
          const result = await ledger.resultFor(requestId, submission.id);
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
            ledger.publishSettled(error.result);
            return error.result;
          }
          throw error;
        } finally {
          foregroundAdmission = undefined;
          admissionFinished.resolve();
          off();
          input.signal?.removeEventListener("abort", abort);
        }
      },
      waitForRequest: (requestId) => ledger.waitForRequest(requestId),
      async waitForIdle() {
        // A native Run can settle before its host receipt/metadata commit releases
        // foreground admission. Readiness includes that owned completion boundary.
        await foregroundAdmission;
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
          runtime.disposeHooks();
          await release(async () => {
            await Promise.all(shutdownPublications);
          });
          await release(() => plan.settleWrites());
          await release(() => harness.close(context));
          permissionBatch.close();
          await release(() => observation.close());
          subagents.close();
          for (const owner of childRuntimes.values()) owner.disposeHooks();
          for (const resource of childResources.values()) {
            await release(() => resource.observation.close());
          }
          for (const owner of childRuntimes.values()) await release(() => owner.disposeJobs());
          await release(() => runtime.disposeJobs());
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
      { signal: options.initializationSignal, matchQuery: options.resumeId ? "resume" : "startup" },
    );
    options.initializationSignal?.throwIfAborted();
    await applyHookResult(startup, "hook:SessionStart");
    if (startup.continue === false) startupStopReason = startup.stopReason ?? "Stopped by hook.";
    await asyncAdmissions;
    const pendingRecovery = await harness.inspect(context);
    if (
      pendingRecovery.tasks.some((task) =>
        hasPendingInteraction(task.record, isMcpAuthenticationInteraction),
      )
    )
      await refreshMcp(context.abortSignal);
    await subagents.prepareChildren(context);
    const recovering = await harness.inspect(context);
    await ledger.recover(
      recovering,
      goalRuntime.activation.taskId,
      goalRuntime.activation.requestId,
    );
    options.initializationSignal?.throwIfAborted();
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
