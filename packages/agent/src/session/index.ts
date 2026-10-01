import { Agent, type AgentEvent, type StreamFn, type Skill } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import type { Api, Model } from "@earendil-works/pi-ai";
import { resolve } from "node:path";
import type {
  CustomSessionEvent,
  RunResult,
  SessionEvent as SharedSessionEvent,
  Settings,
} from "@neant/shared";
import { resolveModel } from "../config/index.ts";
import { createJsonlStore, type SessionStore } from "../store/index.ts";
import { decidePermission } from "../permissions/index.ts";
import { createBuiltinTools } from "../tools/index.ts";
import { SYSTEM_PROMPT } from "../prompt/index.ts";
import { collectReminders, convertToLlm, type ReminderSource } from "../reminders/index.ts";
import { discoverSkills, skillInvocation, skillsReminder } from "../skills/index.ts";
import { createMcpConnections } from "../mcp/index.ts";

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
  /** Allow every tool. */
  yolo?: boolean;
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
    throw new Error(`Session not found: ${options.resumeId}`);
  }
  const stored = metadata
    ? await store.open(metadata, context)
    : await store.create({ cwd }, context);
  let messages;
  try {
    const branch =
      (await stored.branch("main", context)) ?? (await stored.createBranch("main", null, context));
    messages = (await branch.findEntries({ order: "oldestFirst" }, context)).flatMap((entry) =>
      entry.type === "message" ? [entry.message] : [],
    );
  } finally {
    await stored.close(context);
  }
  let emitRunEvent: ((event: CustomSessionEvent) => void | Promise<void>) | undefined;
  // Older Sessions did not persist their implicit baseline. Do not append it
  // behind existing conversation messages; pi will seed it when restoring them.
  let baselinePersisted = messages.length > 0;
  let skills = new Map<string, Skill>();
  const agent = new Agent({
    streamFn: options.streamFn ?? streamFn,
    convertToLlm,
    beforeToolCall: async ({ toolCall }) => {
      const decision = decidePermission(toolCall.name, {
        allowTools: [...(settings.allowTools ?? []), ...(options.allowTools ?? [])],
        yolo: options.yolo,
      });
      if (decision === "allow") return undefined;
      await emitRunEvent?.({
        type: "permission_denied",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      });
      return { block: true, reason: `该工具未获授权: ${toolCall.name}` };
    },
    initialState: {
      model,
      messages,
      systemPrompt: SYSTEM_PROMPT,
      tools: createBuiltinTools(cwd, (name) => skills.get(name)),
      ...(settings.thinking && { thinkingLevel: settings.thinking }),
    },
  });
  let running = false;
  return {
    id: stored.metadata.id,
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
      emitRunEvent = emit;
      const abort = () => agent.abort();
      const mcp = createMcpConnections();
      const emitMcpErrors = async () => {
        for (const event of mcp.errors.splice(0)) {
          (options.onWarning ?? console.warn)(`MCP server ${event.server}: ${event.error}`);
          await emit(event);
        }
      };
      let active;
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
            ...createBuiltinTools(cwd, (name) => skills.get(name)),
            ...mcp.tools,
          ];
          await emit({
            type: "session_start",
            model: `${model.provider}/${model.id}`,
            cwd,
            tools: agent.state.tools.map((tool) => tool.name),
          });
        }
        await emitMcpErrors();
        try {
          signal?.addEventListener("abort", abort);
          signal?.throwIfAborted();
          active = await store.open(stored.metadata, context);
          const branch = await active.branch("main", context);
          if (!branch) throw new Error("Session has no main branch.");
          if (!baselinePersisted) {
            await branch.appendMessage(agent.state.messages[0]!, context);
            baselinePersisted = true;
          }
          unsubscribe = agent.subscribe(async (event) => {
            await emitMcpErrors();
            if (event.type === "message_end") {
              await branch.appendMessage(event.message, context);
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
          });
          signal?.throwIfAborted();
          const discovered = await discoverSkills(cwd, options.homeDir);
          skills = discovered.skills;
          for (const warning of discovered.warnings) (options.onWarning ?? console.warn)(warning);
          const reminders = await collectReminders({
            messages: agent.state.messages,
            cwd,
            homeDir: options.homeDir,
            now: (options.now ?? (() => new Date()))(),
            sources: [
              { source: "skills", currentContent: () => skillsReminder(skills) },
              {
                source: "mcp",
                currentContent: () =>
                  mcp.hasServers ||
                  agent.state.messages.some(
                    (message) => message.role === "system-reminder" && message.source === "mcp",
                  )
                    ? mcp.reminder()
                    : undefined,
              },
              ...(options.reminderSources ?? []),
            ],
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
          await active?.close(context);
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
