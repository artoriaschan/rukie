import type { AgentMessage, AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { RunResult } from "@neant/shared";
import { Type } from "typebox";
import type { Session, SessionEvent } from "../session/index.ts";
import type { ToolStateDefinition } from "../tool-state/index.ts";
import type { SubagentType } from "./types.ts";
export { discoverSubagentTypes, type SubagentType } from "./types.ts";

export const subagentsState: ToolStateDefinition = {
  name: "subagents",
  version: 1,
  parse(version, value) {
    if (
      version !== 1 ||
      !Array.isArray(value) ||
      !value.every(
        (row) =>
          row &&
          typeof row.id === "string" &&
          typeof row.description === "string" &&
          typeof row.type === "string",
      )
    )
      throw new Error("Invalid subagents snapshot.");
    return value.map(({ id, description, type }) => ({ id, description, type }));
  },
};

export const SUBAGENT_PROMPT =
  "You are a subagent delegated by a parent session. Work on the assigned prompt; your final reply will be delivered to the parent. You cannot expand the parent session permissions or create other subagents.";

export type SubagentIdentity = { id: string; description: string; type: string };
interface ChildHandle {
  session: Session;
  steer(message: AgentMessage): void;
}
interface SubagentOptions {
  createChild(
    type: SubagentType,
    description: string,
    fork?: boolean,
    resumeId?: string,
  ): Promise<ChildHandle>;
  restored?: readonly SubagentIdentity[];
  persist(identities: SubagentIdentity[]): Promise<void>;
  warn(warning: string): void;
  steer(message: AgentMessage): void;
  emit(
    event: Omit<Extract<SessionEvent, { type: "subagent_event" }>, "sessionId">,
  ): void | Promise<void>;
  addUsage(usage: RunResult["usage"]): void;
}

/** Owns only the current parent's child runs; storage and the agent loop remain Session's. */
export function createSubagents(options: SubagentOptions) {
  let types = new Map<string, SubagentType>();
  const children = new Map<string, SubagentIdentity & { handle?: ChildHandle }>(
    (options.restored ?? []).map((row) => [row.id, { ...row }]),
  );
  const running = new Map<
    symbol,
    { agentId?: string; controller: AbortController; done?: Promise<RunResult> }
  >();
  let saving = Promise.resolve();
  const sending = new Map<string, Promise<void>>();
  const notifications = new Set<AgentMessage>();
  let changed = Promise.withResolvers<void>();
  let aborted = false;
  const wake = () => {
    changed.resolve();
    changed = Promise.withResolvers<void>();
  };
  async function start(
    type: SubagentType,
    description: string,
    prompt: string,
    run_in_background: boolean,
    fork = false,
    existing?: SubagentIdentity & { handle?: ChildHandle },
  ): Promise<AgentToolResult<{ agentId: string; childSessionId: string }>> {
    // ponytail: Fixed concurrency limit; make configurable only when needed.
    if (running.size >= 8) throw new Error("At most 8 subagents can run at once.");
    if (aborted) throw new Error("Parent Run was aborted.");
    const key = Symbol();
    const entry = {
      agentId: undefined as string | undefined,
      controller: new AbortController(),
      done: undefined as Promise<RunResult> | undefined,
    };
    running.set(key, entry);
    let handle: ChildHandle;
    try {
      handle =
        existing?.handle ?? (await options.createChild(type, description, fork, existing?.id));
      entry.agentId = handle.session.id;
      if (existing) existing.handle = handle;
      else {
        children.set(handle.session.id, {
          id: handle.session.id,
          description,
          type: type.name,
          handle,
        });
        const snapshot = [...children.values()].map(({ id, description, type }) => ({
          id,
          description,
          type,
        }));
        saving = saving.then(() => options.persist(snapshot));
        await saving;
      }
    } catch (error) {
      running.delete(key);
      wake();
      throw error;
    }
    const { session } = handle;
    const details = { agentId: session.id, childSessionId: session.id };
    entry.done = (async () => {
      let result: RunResult = {
        text: "",
        success: false,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        durationMs: 0,
      };
      try {
        await session.run(prompt, {
          signal: entry.controller.signal,
          async onEvent(event) {
            if (event.type === "result") result = event;
            await options.emit({
              type: "subagent_event",
              agentId: session.id,
              description,
              subagentType: type.name,
              event,
            });
          },
        });
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
      } finally {
        options.addUsage(result.usage);
        if (run_in_background && !aborted) {
          const status = entry.controller.signal.aborted
            ? "aborted"
            : result.success
              ? "finished"
              : `failed: ${result.error}`;
          const message: AgentMessage = {
            role: "user",
            content: [
              {
                type: "text",
                text: `Subagent ${session.id} (${description}) ${status}.${result.text.trim() ? ` Its closing message:\n${result.text}` : ""}`,
              },
            ],
            timestamp: Date.now(),
          };
          notifications.add(message);
          options.steer(message);
        }
        running.delete(key);
        wake();
      }
      return result;
    })();
    if (run_in_background)
      return {
        content: [
          {
            type: "text",
            text: existing ? `delivered to ${session.id}` : `started subagent ${session.id}`,
          },
        ],
        details,
      };
    const result = await entry.done;
    return {
      content: [{ type: "text", text: result.text || result.error || "" }],
      details,
      isError: !result.success,
    };
  }
  const parameters = Type.Object({
    description: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    subagent_type: Type.Optional(Type.String()),
    run_in_background: Type.Optional(Type.Boolean()),
  });
  const tool: AgentTool<typeof parameters> = {
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate a prompt to a general-purpose subagent. Runs in the background by default; its closing message is delivered when it finishes.",
    parameters,
    async execute(
      _id,
      { description, prompt, subagent_type = "general-purpose", run_in_background = true },
    ) {
      const type = types.get(subagent_type);
      if (!type)
        throw new Error(
          `Unknown subagent type "${subagent_type}". Available types: ${[...types.keys()].join(", ")}.`,
        );
      return start(type, description, prompt, run_in_background);
    },
  };
  const forkParameters = Type.Object({
    description: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    run_in_background: Type.Optional(Type.Boolean()),
  });
  const forkTool: AgentTool<typeof forkParameters> = {
    name: "subagent_fork",
    label: "Fork Subagent",
    description:
      "Delegate a prompt to a fork of this session through its last completed Turn, excluding the current Turn. Inherits the parent model and tools; runs in the background by default.",
    parameters: forkParameters,
    execute(_id, { description, prompt, run_in_background = true }) {
      return start(
        { name: "fork", description: "Fork of the parent session", prompt: "" },
        description,
        prompt,
        run_in_background,
        true,
      );
    },
  };
  const sendParameters = Type.Object({ agent_id: Type.String(), message: Type.String() });
  const sendTool: AgentTool<typeof sendParameters> = {
    name: "send_message",
    label: "Send Message",
    description:
      "Send instructions to one of this session's subagents. Steers an active Run or starts a new background Run for an idle child.",
    parameters: sendParameters,
    async execute(_id, { agent_id, message }) {
      const child = children.get(agent_id);
      if (!child) throw new Error(`Unknown subagent: ${agent_id}`);
      const previous = sending.get(agent_id);
      const delivery = Promise.withResolvers<void>();
      sending.set(agent_id, delivery.promise);
      await previous;
      try {
        if ([...running.values()].some((entry) => entry.agentId === agent_id)) {
          child.handle!.steer({
            role: "user",
            content: [{ type: "text", text: message }],
            timestamp: Date.now(),
          });
          return { content: [{ type: "text", text: `delivered to ${agent_id}` }], details: {} };
        }
        const fork = child.type === "fork";
        let type = fork
          ? { name: "fork", description: "Fork of the parent session", prompt: "" }
          : types.get(child.type);
        if (!type) {
          options.warn(
            `Subagent type "${child.type}" was removed; falling back to general-purpose for ${agent_id}.`,
          );
          type = types.get("general-purpose")!;
        }
        return await start(type, child.description, message, true, fork, child);
      } finally {
        delivery.resolve();
        if (sending.get(agent_id) === delivery.promise) sending.delete(agent_id);
      }
    },
  };
  const listTool: AgentTool = {
    name: "list_agents",
    label: "List Agents",
    description: "List this session's subagents, their Run status and descriptions.",
    parameters: Type.Object({}),
    async execute() {
      const active = new Set([...running.values()].map((entry) => entry.agentId));
      return {
        content: [
          {
            type: "text",
            text:
              [...children.values()]
                .map(
                  (child) =>
                    `${child.id} [${active.has(child.id) ? "running" : "idle"}] — ${child.description}`,
                )
                .join("\n") || "(no subagents)",
          },
        ],
        details: {},
      };
    },
  };
  return {
    tool,
    forkTool,
    sendTool,
    listTool,
    setTypes(available: Map<string, SubagentType>) {
      types = available;
      tool.description =
        "Delegate a prompt to a subagent. Runs in the background by default; its closing message is delivered when it finishes. Available types:\n" +
        [...types.values()].map((type) => `${type.name}: ${type.description}`).join("\n");
    },
    get count() {
      return running.size;
    },
    get hasNotifications() {
      return notifications.size > 0;
    },
    begin() {
      aborted = false;
    },
    delivered(message: AgentMessage) {
      notifications.delete(message);
    },
    wait() {
      return changed.promise;
    },
    abort() {
      aborted = true;
      notifications.clear();
      for (const entry of running.values()) entry.controller.abort();
      wake();
    },
    async settle() {
      // Creating sessions have a reserved entry before their Run promise exists.
      while (running.size) {
        const done = [...running.values()].flatMap((entry) => (entry.done ? [entry.done] : []));
        if (done.length) await Promise.allSettled(done);
        else await changed.promise;
      }
    },
  };
}
