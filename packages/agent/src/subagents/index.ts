import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { RunResult } from "@neant/shared";
import { Type } from "typebox";
import type { Session, SessionEvent } from "../session/index.ts";

export const SUBAGENT_PROMPT =
  "You are a subagent delegated by a parent session. Work on the assigned prompt; your final reply will be delivered to the parent. You cannot expand the parent session permissions or create other subagents.";

interface SubagentOptions {
  createChild(description: string): Promise<Session>;
  steer(message: AgentMessage): void;
  emit(
    event: Omit<Extract<SessionEvent, { type: "subagent_event" }>, "sessionId">,
  ): void | Promise<void>;
  addUsage(usage: RunResult["usage"]): void;
}

/** Owns only the current parent's child runs; storage and the agent loop remain Session's. */
export function createSubagents(options: SubagentOptions) {
  const running = new Map<symbol, { controller: AbortController; done?: Promise<RunResult> }>();
  const notifications = new Set<AgentMessage>();
  let changed = Promise.withResolvers<void>();
  let aborted = false;
  const wake = () => {
    changed.resolve();
    changed = Promise.withResolvers<void>();
  };
  const parameters = Type.Object({
    description: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    run_in_background: Type.Optional(Type.Boolean()),
  });
  const tool: AgentTool<typeof parameters> = {
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate a prompt to a general-purpose subagent. Runs in the background by default; its closing message is delivered when it finishes.",
    parameters,
    async execute(_id, { description, prompt, run_in_background = true }) {
      // ponytail: Fixed concurrency limit; make configurable only when needed.
      if (running.size >= 8) throw new Error("At most 8 subagents can run at once.");
      if (aborted) throw new Error("Parent Run was aborted.");
      const key = Symbol();
      const entry = {
        controller: new AbortController(),
        done: undefined as Promise<RunResult> | undefined,
      };
      running.set(key, entry);
      let session: Session;
      try {
        session = await options.createChild(description);
      } catch (error) {
        running.delete(key);
        wake();
        throw error;
      }
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
                subagentType: "general-purpose",
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
    },
  };
  return {
    tool,
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
