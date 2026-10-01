import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { Settings } from "@neant/shared";
import { resolveModel } from "../config/index.ts";

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
}

export interface RunResult {
  /** Final assistant text of the run. */
  text: string;
}

export interface Session {
  run(prompt: string, options?: { signal?: AbortSignal }): Promise<RunResult>;
}

export async function createSession(options: SessionOptions): Promise<Session> {
  const settings = options.settings ?? {};
  if (options.model && !options.streamFn) throw new Error("`model` requires `streamFn`.");
  const { model, streamFn } = options.model
    ? { model: options.model, streamFn: options.streamFn! }
    : await resolveModel(settings);
  const agent = new Agent({
    streamFn: options.streamFn ?? streamFn,
    initialState: {
      model,
      ...(settings.thinking && { thinkingLevel: settings.thinking }),
    },
  });
  return {
    async run(prompt, { signal } = {}) {
      signal?.throwIfAborted();
      const abort = () => agent.abort();
      signal?.addEventListener("abort", abort);
      try {
        await agent.prompt(prompt);
      } finally {
        signal?.removeEventListener("abort", abort);
      }
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
