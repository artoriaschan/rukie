import {
  Agent,
  type AgentEvent,
  type AgentMessage,
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
} from "@neant/shared";
import { resolveModel } from "../config/index.ts";
import { createJsonlStore, type SessionStore } from "../store/index.ts";
import { createPermissionGate, type PermissionAskRequest } from "../permissions/index.ts";
import { createBuiltinTools, type QuestionRequest, type QuestionReply } from "../tools/index.ts";
import { SYSTEM_PROMPT } from "../prompt/index.ts";
import { collectReminders, convertToLlm, type ReminderSource } from "../reminders/index.ts";
import { discoverSkills, skillInvocation, skillsReminder } from "../skills/index.ts";
import { createMcpConnections } from "../mcp/index.ts";
import { compactTurn, estimateContextTokens, restoreContext } from "../compaction/index.ts";
import { contextUsage } from "../context-usage/index.ts";
import { createToolState, todoState, type TodoItem } from "../tool-state/index.ts";

export type { PermissionAskRequest } from "../permissions/index.ts";

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
  /** Additional tool-name glob patterns, combined with settings.allowTools. */
  allowTools?: string[];
  /** Session permission policy; defaults to ask. */
  permissionMode?: PermissionMode;
  /** Decide tool calls requiring permission; defaults to deny. */
  onPermissionAsk?: (request: PermissionAskRequest) => Promise<"allow" | "deny">;
  /** Ask structured questions; the tool is absent when this callback is omitted. */
  onQuestion?: (request: QuestionRequest) => Promise<QuestionReply>;
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
  /** Applies to the next tool call; never persisted. */
  setPermissionMode(mode: PermissionMode): void;
  /** Current restored context in memory, including reminders and any compaction. */
  readonly messages: readonly AgentMessage[];
  /** Current Tool State snapshot; undefined before the first write. */
  toolState(name: string): unknown;
  run(
    prompt: string,
    options?: {
      signal?: AbortSignal;
      /** Ordered events; result is emitted after storage closes, including on failure. */
      onEvent?: (event: SessionEvent) => void | Promise<void>;
    },
  ): Promise<RunResult>;
}

export async function createSession(options: SessionOptions): Promise<Session> {
  const settings = options.settings ?? {};
  let permissionMode = options.permissionMode ?? settings.permissionMode ?? "ask";
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
      ? (await store.list({ cwd }, context)).find((item) => item.id === options.resumeId)
      : undefined;
  if (options.resumeId !== undefined && !metadata) {
    throw createUserVisibleError(`Session not found: ${options.resumeId}`, {
      code: "session-not-found",
      params: { id: options.resumeId },
    });
  }
  const stored = metadata
    ? await store.open(metadata, context)
    : await store.create({ cwd }, context);
  let entries;
  try {
    const branch =
      (await stored.branch("main", context)) ?? (await stored.createBranch("main", null, context));
    entries = await branch.findEntries({ order: "oldestFirst" }, context);
  } finally {
    await stored.close(context);
  }
  let emitRunEvent: ((event: CustomSessionEvent) => void | Promise<void>) | undefined;
  const toolState = createToolState([todoState], entries, options.onWarning ?? console.warn);
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
  const permissions = createPermissionGate({
    cwd,
    getMode: () => permissionMode,
    getAllowTools: () => [...(settings.allowTools ?? []), ...(options.allowTools ?? [])],
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
    onPermissionAsk: options.onPermissionAsk,
    onEvent: (event) => emitRunEvent?.(event),
  });
  const agent = new Agent({
    streamFn: options.streamFn ?? streamFn,
    convertToLlm,
    beforeToolCall: permissions.beforeToolCall,
    initialState: {
      model,
      messages: restoreContext(entries),
      systemPrompt: SYSTEM_PROMPT,
      tools: createBuiltinTools(cwd, (name) => skills.get(name), setTodo, options.onQuestion),
      ...(settings.thinking && { thinkingLevel: settings.thinking }),
    },
  });
  let running = false;
  let inputTokens: number | undefined;
  return {
    id: stored.metadata.id,
    get permissionMode() {
      return permissionMode;
    },
    setPermissionMode(mode) {
      permissionMode = mode;
    },
    get messages() {
      return agent.state.messages;
    },
    toolState: toolState.get,
    async run(prompt, { signal, onEvent } = {}) {
      if (running) throw new Error("Session already has an active Run.");
      running = true;
      const started = performance.now();
      const result: RunResult = {
        text: "",
        success: false,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        durationMs: 0,
      };
      const emit = (event: AgentEvent | CustomSessionEvent) =>
        onEvent?.({ ...event, sessionId: stored.metadata.id });
      const emitContextUsage = () =>
        emit(contextUsage(agent.state.messages, model.contextWindow, inputTokens));
      emitRunEvent = emit;
      const abort = () => agent.abort();
      const mcp = createMcpConnections();
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
          agent.state.tools = [
            ...createBuiltinTools(cwd, (name) => skills.get(name), setTodo, options.onQuestion),
            ...mcp.tools,
          ];
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
          const runStore = await store.open(stored.metadata, context);
          active = runStore;
          activeStore = runStore;
          const branch = await runStore.branch("main", context);
          if (!branch) throw new Error("Session has no main branch.");
          if (!baselinePersisted) {
            await branch.appendMessage(agent.state.messages[0]!, context);
            baselinePersisted = true;
          }
          const reminderSources: ReminderSource[] = [
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
            const compacted = await compactTurn({
              messages: requestContext.messages,
              entries: () => branch.findEntries({ order: "oldestFirst" }, context),
              model,
              streamFn: options.streamFn ?? streamFn,
              thinkingLevel: agent.state.thinkingLevel,
              signal: turnSignal,
              onStart: (tokensBefore) => emit({ type: "compaction_start", tokensBefore }),
            });
            if (!compacted) return;
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
            await emitContextUsage();
            return { context: { ...requestContext, messages } };
          };
          unsubscribe = agent.subscribe(async (event) => {
            await emitMcpErrors();
            if (event.type === "message_end") {
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
                result.text = message.content
                  .flatMap((c) => (c.type === "text" ? [c.text] : []))
                  .join("");
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
        } finally {
          signal?.removeEventListener("abort", abort);
          unsubscribe?.();
          agent.prepareRequest = undefined;
          await active?.close(context);
          activeStore = undefined;
        }
        signal?.throwIfAborted();
        if (result.error) throw new Error(result.error);
        if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
        result.success = true;
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
          emitRunEvent = undefined;
          running = false;
        }
      }
      return result;
    },
  };
}
