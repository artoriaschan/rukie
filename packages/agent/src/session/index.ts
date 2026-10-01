import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import type { Api, Model } from "@earendil-works/pi-ai";
import { resolve } from "node:path";
import type { Settings } from "@neant/shared";
import { resolveModel } from "../config/index.ts";
import { createJsonlStore, type SessionStore } from "../store/index.ts";

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
}

export interface RunResult {
  /** Final assistant text of the run. */
  text: string;
}

export interface Session {
  readonly id: string;
  run(prompt: string, options?: { signal?: AbortSignal }): Promise<RunResult>;
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
  const agent = new Agent({
    streamFn: options.streamFn ?? streamFn,
    initialState: {
      model,
      messages,
      ...(settings.thinking && { thinkingLevel: settings.thinking }),
    },
  });
  let running = false;
  return {
    id: stored.metadata.id,
    async run(prompt, { signal } = {}) {
      signal?.throwIfAborted();
      if (running) throw new Error("Session already has an active Run.");
      running = true;
      const abort = () => agent.abort();
      signal?.addEventListener("abort", abort);
      let active;
      let unsubscribe;
      try {
        active = await store.open(stored.metadata, context);
        const branch = await active.branch("main", context);
        if (!branch) throw new Error("Session has no main branch.");
        unsubscribe = agent.subscribe(async (event) => {
          if (event.type === "message_end") {
            await branch.appendMessage(event.message, context);
          }
        });
        signal?.throwIfAborted();
        await agent.prompt(prompt);
      } finally {
        signal?.removeEventListener("abort", abort);
        unsubscribe?.();
        try {
          await active?.close(context);
        } finally {
          running = false;
        }
      }
      signal?.throwIfAborted();
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      const last = agent.state.messages.findLast((m) => m.role === "assistant");
      const text =
        last?.role === "assistant"
          ? last.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("")
          : "";
      return { text };
    },
  };
}
