import type { AgentMessage, AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { RunResult } from "@neant/shared";
import { Type } from "typebox";
import type { Session, SessionEvent } from "../session/index.ts";
import type { SubagentType } from "./types.ts";
export { discoverSubagentTypes, type SubagentType } from "./types.ts";

export const SUBAGENT_PROMPT =
  "You are a subagent delegated by a parent session. Work on the assigned prompt; your final reply will be delivered to the parent. You cannot expand the parent session permissions or create other subagents.";

interface SubagentOptions {
  createChild(type: SubagentType, description: string, fork?: boolean): Promise<Session>;
  steer(message: AgentMessage): void;
  emit(
    event: Omit<Extract<SessionEvent, { type: "subagent_event" }>, "sessionId">,
  ): void | Promise<void>;
  addUsage(usage: RunResult["usage"]): void;
}

/** Owns only the current parent's child runs; storage and the agent loop remain Session's. */
export function createSubagents(options: SubagentOptions) {
  let types = new Map<string, SubagentType>();
  const running = new Map<
    symbol,
    { controller: AbortController; agentId?: string; done?: Promise<RunResult> }
  >();
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
  ): Promise<AgentToolResult<{ agentId: string; childSessionId: string }>> {
    // ponytail: Fixed concurrency limit; make configurable only when needed.
    if (running.size >= 8) throw new Error("At most 8 subagents can run at once.");
    if (aborted) throw new Error("Parent Run was aborted.");
    const key = Symbol();
    const entry = {
      controller: new AbortController(),
      agentId: undefined as string | undefined,
      done: undefined as Promise<RunResult> | undefined,
    };
    running.set(key, entry);
    let session: Session;
    try {
      session = await options.createChild(type, description, fork);
    } catch (error) {
      running.delete(key);
      wake();
      throw error;
    }
    entry.agentId = session.id;
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
      return { content: [{ type: "text", text: `started subagent ${session.id}` }], details };
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
  return {
    tool,
    forkTool,
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
    interrupt(id: string) {
      for (const entry of running.values()) if (entry.agentId === id) entry.controller.abort();
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
