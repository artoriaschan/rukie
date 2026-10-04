import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentOptions,
  type AfterToolCallResult,
  type StreamFn,
  type Skill,
} from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import {
  branchTip,
  insertEntry,
  setValue,
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
} from "@neant/shared";
import {
  createSubagents,
  discoverSubagentTypes,
  SUBAGENT_PROMPT,
  subagentsState,
  type SubagentIdentity,
} from "../subagents/index.ts";
import { isTrustedProject, resolveModel } from "../config/index.ts";
import { createJsonlStore, type SessionStore } from "../store/index.ts";
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
import { contextUsage } from "../context-usage/index.ts";
import { createToolState, todoState, type TodoItem } from "../tool-state/index.ts";

import { planState, planModeReminder, PLAN_MODE_EXIT } from "../plan-mode/index.ts";
import { createHooks, mergeHooks, type CommonHookResult, type HookInput } from "../hooks/index.ts";

export type { PermissionAskRequest, SessionAllowRule } from "../permissions/index.ts";

export interface SessionOptions {
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
  /** Ask structured questions; the tool is absent when this callback is omitted. */
  onQuestion?: (request: QuestionRequest) => Promise<QuestionReply>;
  /** Review markdown plans; plan tools are absent when this callback is omitted. */
  onPlanReview?: OnPlanReview;
  /** Load this project's .mcp.json even when it is not in the user trust list. */
  trustProjectMcp?: boolean;
  /** Clock used for reminder dates; defaults to the local current date. */
  now?: () => Date;
  /** Additional content sources, compared with the latest persisted reminder per source. */
  reminderSources?: ReminderSource[];
  /** Discovery diagnostics; defaults to stderr via console.warn. */
  onWarning?: (warning: string) => void;
}

export type SessionEvent = SharedSessionEvent<AgentEvent>;

export interface Session {
  readonly id: string;
  readonly permissionMode: PermissionMode;
  readonly planMode: boolean;
  /** Changes guidance for the next model call and persists the state, also outside a Run. */
  setPlanMode(on: boolean): Promise<void>;
  /** Applies to the next tool call; never persisted. */
  setPermissionMode(mode: PermissionMode): void;
  /** Current restored context in memory, including reminders and any compaction. */
  readonly messages: readonly AgentMessage[];
  /** Current Tool State snapshot; undefined before the first write. */
  toolState(name: string): unknown;
  /** Interrupt a child Run; missing and idle children are a no-op. */
  interruptSubagent(id: string): void;
  /** Ends the Session once, cancelling its Run and releasing external resources. */
  dispose(reason?: "exit" | "other"): Promise<void>;
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
  return createSessionInternal(options);
}

interface InternalSessionOptions {
  sessionSource?: "fork";
  parentSessionId?: string;
  originDescription?: string;
  agentType?: string;
  permissions?: {
    rules: ReturnType<typeof parsePermissionRules>;
    sessionAllowRules: SessionAllowRule[];
    sessionGrantListeners: Set<() => void>;
    getMode(): PermissionMode;
  };
  plan?: { getActive(): boolean; hasEntered(): boolean; setMode(on: boolean): Promise<void> };
  toolNames?: readonly string[];
  typePrompt?: string;
  typeHooks?: HooksSettings;
  initialMessages?: AgentMessage[];
  systemPrompt?: string;
  control?: { steer?: (message: AgentMessage) => void };
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
    getMode: () => permissionMode,
  };
  if (options.model && !options.streamFn) throw new Error("`model` requires `streamFn`.");
  const { model, streamFn } = options.model
    ? { model: options.model, streamFn: options.streamFn! }
    : await resolveModel(settings, options.homeDir);
  const cwd = resolve(options.cwd);
  const store = options.store ?? createJsonlStore({ cwd, homeDir: options.homeDir });
  // Storage must finish even when the Run's signal is aborted.
  const context = BACKGROUND_CONTEXT;
  const metadata =
    options.resumeId !== undefined
      ? (await store.list({ cwd }, context)).find(
          (item) =>
            item.id === options.resumeId &&
            (!item.parentSessionId || internal.parentSessionId === item.parentSessionId),
        )
      : undefined;
  if (options.resumeId !== undefined && !metadata) {
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
  try {
    const branch =
      (await stored.branch("main", context)) ?? (await stored.createBranch("main", null, context));
    for (const message of internal.initialMessages ?? [])
      await branch.appendMessage(message, context);
    entries = await branch.findEntries({ order: "oldestFirst" }, context);
  } finally {
    await stored.close(context);
  }
  let emitRunEvent: ((event: CustomSessionEvent<AgentEvent>) => void | Promise<void>) | undefined;
  const toolState = createToolState(
    [todoState, subagentsState, planState],
    entries,
    options.onWarning ?? console.warn,
  );
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
        const ownStore = activeStore ? undefined : await store.open(stored.metadata, context);
        const target = activeStore ?? ownStore!;
        try {
          if (!baselinePersisted) {
            const branch = await target.branch("main", context);
            if (!branch) throw new Error("Session has no main branch.");
            await branch.appendMessage(agent.state.messages[0]!, context);
            baselinePersisted = true;
          }
          return await toolState.set("plan", { active: on }, target, context);
        } finally {
          await ownStore?.close(context);
        }
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
  const setTodo = async (todos: TodoItem[]) => {
    if (!activeStore) throw new Error("Tool State writes require an active Run.");
    const value = await toolState.set("todo", todos, activeStore, context);
    await emitRunEvent?.({ type: "tool_state_changed", name: "todo", value });
  };
  const transcriptMessages = entries.flatMap((entry) =>
    entry.type === "message" ? [entry.message] : [],
  );
  let reminderStart = entries
    .slice(0, entries.findLastIndex((entry) => entry.type === "compaction") + 1)
    .filter((entry) => entry.type === "message").length;
  // Older Sessions did not persist their implicit baseline. Do not append it
  // behind existing conversation messages; pi will seed it when restoring them.
  let baselinePersisted = transcriptMessages.length > 0;
  let skills = new Map<string, Skill>();
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
  let emitSessionEndEvent: typeof emitRunEvent;
  const hooks = createHooks({
    settings: hookSettings,
    cwd,
    projectDir: cwd,
    onWarning: options.onWarning ?? console.warn,
    onEvent: (event) => {
      if (event.type === "hook_warning" && event.event === "SessionEnd")
        return emitSessionEndEvent?.(event);
      if (emitRunEvent) return emitRunEvent(event);
      pendingHookEvents.push(event);
    },
  });
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
    cwd,
    homeDir: options.homeDir,
    rules,
    sessionAllowRules: permissionConfiguration.sessionAllowRules,
    sessionGrantListeners: permissionConfiguration.sessionGrantListeners,
    getMode: permissionConfiguration.getMode,
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
    stopRun(reason) {
      applyHookControl({
        continue: false,
        stopReason: reason,
        systemMessages: [],
        additionalContext: [],
      });
    },
  });
  let currentResult: RunResult | undefined;
  let completedMessages = restoreContext(entries);
  const subagents = createSubagents({
    restored: toolState.get("subagents") as SubagentIdentity[] | undefined,
    warn: options.onWarning ?? console.warn,
    async persist(identities) {
      if (!activeStore) throw new Error("Tool State writes require an active Run.");
      const value = await toolState.set("subagents", identities, activeStore, context);
      await emitRunEvent?.({ type: "tool_state_changed", name: "subagents", value });
    },
    async createChild(type, description, fork = false, resumeId) {
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
          originDescription: description,
          agentType: type.name,
          permissions: permissionConfiguration,
          plan,
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
      ? [createEnterPlanModeTool(plan), createExitPlanModeTool(plan, options.onPlanReview)]
      : [];
  const initialTools = [
    ...createBuiltinTools(cwd, (name) => skills.get(name), setTodo, onQuestion, options.homeDir),
    ...planTools,
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
    streamFn: options.streamFn ?? streamFn,
    convertToLlm,
    beforeToolCall: permissions.beforeToolCall,
    async afterToolCall({ toolCall, result }) {
      return consumeToolHookOutput(toolCall.id, result);
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
      messages: restoreContext(entries),
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
      ].filter((tool) => !internal.toolNames || internal.toolNames.includes(tool.name)),
      ...(settings.thinking && { thinkingLevel: settings.thinking }),
    },
  });
  if (internal.control) internal.control.steer = (message) => agent.steer(message);
  let running = false;
  let runController: AbortController | undefined;
  let runMcp: ReturnType<typeof createMcpConnections> | undefined;
  let disposePromise: Promise<void> | undefined;
  let inputTokens: number | undefined;
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
  return {
    id: stored.metadata.id,
    get permissionMode() {
      return permissionConfiguration.getMode();
    },
    setPermissionMode(mode) {
      permissionMode = mode;
    },
    get planMode() {
      return plan.getActive();
    },
    setPlanMode: plan.setMode,
    get messages() {
      return agent.state.messages;
    },
    toolState: (name) =>
      name === "plan" && (internal.plan || toolState.get("plan") !== undefined)
        ? { active: plan.getActive() }
        : toolState.get(name),
    interruptSubagent: subagents.interrupt,
    dispose(reason = "exit") {
      if (!disposePromise) {
        // Publish the promise before callbacks or hooks can re-enter dispose.
        disposePromise = Promise.resolve().then(async () => {
          const mcp = runMcp;
          hooks.dispose();
          runController?.abort();
          try {
            await hooks.run("SessionEnd", { ...hookInput(), reason }, { matchQuery: reason });
          } finally {
            await mcp?.close();
          }
        });
      }
      return disposePromise;
    },
    async run(prompt, { signal, onEvent } = {}) {
      if (disposePromise) throw new Error("Session has been disposed.");
      if (running) throw new Error("Session already has an active Run.");
      running = true;
      runController = new AbortController();
      signal = signal ? AbortSignal.any([signal, runController.signal]) : runController.signal;
      planTakenOver = false;
      hookStopped = false;
      hookStopReason = undefined;
      toolHookContexts.clear();
      hookDenials.clear();
      let stopHookContinuations = 0;
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
      const emit = (event: AgentEvent | CustomSessionEvent<AgentEvent>) =>
        onEvent?.({ ...event, sessionId: stored.metadata.id });
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
      let active: StoredSession | undefined;
      let unsubscribe;
      try {
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
            ),
            ...planTools,
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
          agent.state.tools = [
            ...generalTools,
            ...(internal.parentSessionId
              ? []
              : [subagents.tool, subagents.forkTool, subagents.sendTool, subagents.listTool]),
          ].filter((tool) => !internal.toolNames || internal.toolNames.includes(tool.name));
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
          if (!internal.parentSessionId) {
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
          } else {
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
          const runStore = await store.open(stored.metadata, context);
          active = runStore;
          activeStore = runStore;
          const branch = await runStore.branch("main", context);
          if (!branch) throw new Error("Session has no main branch.");
          if (!baselinePersisted) {
            await branch.appendMessage(agent.state.messages[0]!, context);
            baselinePersisted = true;
          }
          const planReminder: ReminderSource = {
            source: "plan-mode",
            currentContent: () => {
              if (plan.getActive())
                return planModeReminder(
                  agent.state.tools.some((tool) => tool.name === "exit_plan_mode"),
                );
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
            { source: "skills", currentContent: () => skillsReminder(skills) },
            {
              source: "mcp",
              currentContent: () =>
                mcp.hasServers ||
                transcriptMessages.some(
                  (message) => message.role === "system-reminder" && message.source === "mcp",
                )
                  ? mcp.reminder()
                  : undefined,
            },
            ...(options.reminderSources ?? []),
            ...toolState.reminderSources,
          ];
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
            const compacted = await compactTurn({
              messages: requestContext.messages,
              entries: () => branch.findEntries({ order: "oldestFirst" }, context),
              model,
              streamFn: options.streamFn ?? streamFn,
              thinkingLevel: agent.state.thinkingLevel,
              signal: turnSignal,
              beforeCompact: async () => {
                const result = await hooks.run(
                  "PreCompact",
                  { ...hookInput(), trigger: "auto", custom_instructions: null },
                  { signal: turnSignal, matchQuery: "auto" },
                );
                applyHookControl(result);
                turnSignal?.throwIfAborted();
                stopPreparedRequest();
                if (result.decision !== "block") return true;
                const reason = result.reason || "PreCompact hook blocked compaction.";
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
              onStart: (tokensBefore) => emit({ type: "compaction_start", tokensBefore }),
            });
            if (!compacted) {
              await planWrites;
              const changed = await collectSourceReminders(
                transcriptMessages.slice(reminderStart),
                [planReminder],
                (options.now ?? (() => new Date()))(),
              );
              if (!changed.length) return contextChanged ? { context: requestContext } : undefined;
              for (const reminder of changed) {
                await branch.appendMessage(reminder, context);
                transcriptMessages.push(reminder);
                await emit({
                  type: "reminder_injected",
                  source: reminder.source,
                  content: reminder.content,
                });
              }
              const messages = [...requestContext.messages, ...changed];
              agent.state.messages = messages;
              return { context: { ...requestContext, messages } };
            }

            await runStore.mutate(async (mutator) => {
              const tip = await mutator.getValue(branchTip("main"), context);
              if (!tip) throw new Error("Session has no main branch.");
              const id = runStore.idGenerator.next();
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
            const messages = restoreContext(
              await branch.findEntries({ order: "oldestFirst" }, context),
            );
            agent.state.messages = messages;
            inputTokens = undefined;
            await emit({
              type: "compaction_end",
              summary: compacted.summary,
              tokensBefore: compacted.tokensBefore,
              tokensAfter: estimateContextTokens(messages),
            });
            const postCompact = await hooks.run(
              "PostCompact",
              { ...hookInput(), trigger: "auto", compact_summary: compacted.summary },
              { signal: turnSignal, matchQuery: "auto" },
            );
            applyHookControl(postCompact);
            turnSignal?.throwIfAborted();
            stopPreparedRequest();
            const compactStart = await hooks.run(
              "SessionStart",
              { ...hookInput(), source: "compact", model: `${model.provider}/${model.id}` },
              { signal: turnSignal, matchQuery: "compact" },
            );
            applyHookControl(compactStart);
            pendingSessionContexts.push(...compactStart.additionalContext);
            sessionContextUserSequence = userMessageSequence;
            turnSignal?.throwIfAborted();
            stopPreparedRequest();
            await emitContextUsage();
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
              Object.assign(event.result, consumeToolHookOutput(event.toolCallId, event.result));
            }
            await emitMcpErrors();
            if (event.type === "turn_end")
              completedMessages = structuredClone(agent.state.messages);
            if (event.type === "message_end") {
              if (event.message.role === "user") userMessageSequence++;
              subagents.delivered(event.message);
              await branch.appendMessage(event.message, context);
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
                if (message.stopReason === "error" || message.stopReason === "aborted") {
                  result.error = message.errorMessage ?? `Model stopped: ${message.stopReason}`;
                }
              }
            }
            await emit(event);
            if (event.type === "message_end" && event.message.role === "assistant") {
              const { input, cacheRead, cacheWrite } = event.message.usage;
              inputTokens = input + cacheRead + cacheWrite || undefined;
              await emitContextUsage();
            }
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
            { role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() },
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
            if (subagents.hasNotifications) {
              await agent.continue();
              continue;
            }
            if (subagents.count) {
              const changed = subagents.wait();
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
            if (hookStopped || stopped.decision !== "block") break;
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
          await subagents.settle();
          signal?.removeEventListener("abort", abort);
          unsubscribe?.();
          agent.prepareRequest = undefined;
          try {
            await planWrites;
          } finally {
            try {
              await active?.close(context);
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
          await emit({ type: "result", ...result });
        } finally {
          currentResult = undefined;
          emitRunEvent = undefined;
          running = false;
          runController = undefined;
          runMcp = undefined;
        }
      }
      return result;
    },
  };
}
