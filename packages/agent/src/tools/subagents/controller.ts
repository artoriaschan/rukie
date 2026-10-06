import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { RunResult } from "@neant/shared";
import type { Session, SessionEvent } from "../../session/index.ts";
import type { SubagentIdentity, SubagentRun } from "./state.ts";
import type { SubagentType } from "./types.ts";

export const SUBAGENT_PROMPT =
  "You are a subagent delegated by a parent session. Work on the assigned prompt; your final reply will be delivered to the parent. You cannot expand the parent session permissions or create other subagents.";

/** The pseudo-type of a fork delegation; `.neant/agents` cannot define `fork`. */
const FORK_TYPE: SubagentType = {
  name: "fork",
  description: "Fork of the parent session",
  prompt: "",
};

interface ChildHandle {
  session: Session;
  steer(message: AgentMessage): void;
}
interface SubagentControllerOptions {
  createChild(
    type: SubagentType,
    description: string,
    fork?: boolean,
    resumeId?: string,
    onRunStarted?: (run: SubagentRun) => Promise<void>,
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

/** Execution facts for one delegation; the tool adaptor renders the model-visible result. */
export type SubagentDelegationFact =
  | { kind: "started"; agentId: string; childSessionId: string; reused: boolean }
  | { kind: "completed"; agentId: string; childSessionId: string; result: RunResult };

/** Execution facts for one delivery: steered into an active Run or started in the background. */
export type SubagentSendFact =
  | { kind: "steered"; agentId: string }
  | Extract<SubagentDelegationFact, { kind: "started" }>;

/** Identity and current activity facts for the agent directory. */
export interface SubagentListing {
  id: string;
  description: string;
  active: boolean;
}

/** Owns only the current parent's child runs; storage and the agent loop remain Session's. */
export function createSubagentController(options: SubagentControllerOptions) {
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
  function persist() {
    const snapshot = [...children.values()].map(({ id, description, type, latestRun }) => ({
      id,
      description,
      type,
      ...(latestRun && { latestRun }),
    }));
    const write = saving.then(() => options.persist(snapshot));
    saving = write.catch(() => {});
    return write;
  }
  async function start(
    type: SubagentType,
    description: string,
    prompt: string,
    background: boolean,
    fork = false,
    existing?: SubagentIdentity & { handle?: ChildHandle },
  ): Promise<SubagentDelegationFact> {
    // ponytail: Fixed concurrency limit; make configurable only when needed.
    if (running.size >= 8) throw new Error("At most 8 subagents can run at once.");
    if (aborted) throw new Error("Parent Run was aborted.");
    const key = Symbol();
    const entry = {
      agentId: undefined as string | undefined,
      controller: new AbortController(),
      done: undefined as Promise<RunResult> | undefined,
    };
    // The slot and its AbortController are reserved before the child Session exists, so a
    // parent cancellation during creation aborts the late child Run instead of losing it.
    running.set(key, entry);
    let handle: ChildHandle;
    try {
      handle =
        existing?.handle ??
        (await options.createChild(type, description, fork, existing?.id, async (run) => {
          const child = children.get(run.sessionId);
          if (!child) throw new Error("Subagent identity is missing.");
          child.latestRun = run;
          await persist();
        }));
      entry.agentId = handle.session.id;
      if (existing) existing.handle = handle;
      else {
        children.set(handle.session.id, {
          id: handle.session.id,
          description,
          type: type.name,
          handle,
        });
        await persist();
      }
    } catch (error) {
      running.delete(key);
      wake();
      throw error;
    }
    const { session } = handle;
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
        try {
          const run = session.toolState("subagent-run") as SubagentRun | undefined;
          if (run?.sessionId === session.id && run.outcome) {
            children.get(session.id)!.latestRun = run;
            await persist();
          }
        } catch (error) {
          result.success = false;
          result.error = error instanceof Error ? error.message : String(error);
          options.warn(`Could not save subagent Run summary for ${session.id}: ${result.error}`);
        }
        options.addUsage(result.usage);
        if (background && !aborted) {
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
    if (background)
      return {
        kind: "started",
        agentId: session.id,
        childSessionId: session.id,
        reused: existing !== undefined,
      };
    return {
      kind: "completed",
      agentId: session.id,
      childSessionId: session.id,
      result: await entry.done,
    };
  }
  return {
    /** Delegates to a discovered type; an unknown name reports the current available types. */
    async delegate(request: {
      type: string;
      description: string;
      prompt: string;
      background: boolean;
    }): Promise<SubagentDelegationFact> {
      const type = types.get(request.type);
      if (!type)
        throw new Error(
          `Unknown subagent type "${request.type}". Available types: ${[...types.keys()].join(", ")}.`,
        );
      return start(type, request.description, request.prompt, request.background);
    },
    /** Delegates to a fork of this Session's last completed Turn. */
    fork(request: {
      description: string;
      prompt: string;
      background: boolean;
    }): Promise<SubagentDelegationFact> {
      return start(FORK_TYPE, request.description, request.prompt, request.background, true);
    },
    /** Steers an active child Run, or starts one background Run for an idle child. */
    async send(agentId: string, message: string): Promise<SubagentSendFact> {
      const child = children.get(agentId);
      if (!child) throw new Error(`Unknown subagent: ${agentId}`);
      // One queue per child: deliveries serialize even when the first one starts a Run.
      const previous = sending.get(agentId);
      const delivery = Promise.withResolvers<void>();
      sending.set(agentId, delivery.promise);
      await previous;
      try {
        if ([...running.values()].some((entry) => entry.agentId === agentId)) {
          child.handle!.steer({
            role: "user",
            content: [{ type: "text", text: message }],
            timestamp: Date.now(),
          });
          return { kind: "steered", agentId };
        }
        const fork = child.type === "fork";
        let type = fork ? FORK_TYPE : types.get(child.type);
        if (!type) {
          options.warn(
            `Subagent type "${child.type}" was removed; falling back to general-purpose for ${agentId}.`,
          );
          type = types.get("general-purpose")!;
        }
        const fact = await start(type, child.description, message, true, fork, child);
        if (fact.kind !== "started")
          throw new Error("An idle continuation cannot complete in the foreground.");
        return fact;
      } finally {
        delivery.resolve();
        if (sending.get(agentId) === delivery.promise) sending.delete(agentId);
      }
    },
    /** Current identity and activity facts for every known child. */
    list(): SubagentListing[] {
      const active = new Set([...running.values()].map((entry) => entry.agentId));
      return [...children.values()].map((child) => ({
        id: child.id,
        description: child.description,
        active: active.has(child.id),
      }));
    },
    /** Current discovered types in declaration order. */
    types(): SubagentType[] {
      return [...types.values()];
    },
    setTypes(available: Map<string, SubagentType>) {
      types = available;
    },
    /** Reproject idle child identities after the parent's Transcript branch changes. */
    restore(identities: readonly SubagentIdentity[] = []) {
      const retained = new Map(children);
      children.clear();
      for (const identity of identities)
        children.set(identity.id, { ...identity, handle: retained.get(identity.id)?.handle });
      notifications.clear();
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
