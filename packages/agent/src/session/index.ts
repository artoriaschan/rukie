import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";

export interface SessionOptions {
  /** Project directory the session works in. */
  cwd: string;
  /** User home; `~/.neant` lives under it. Injectable for tests. */
  homeDir: string;
  // ponytail: required until settings land (ticket 02), then defaults to pi-ai's catalog
  streamFn: StreamFn;
  model: Model<Api>;
}

export interface RunResult {
  /** Final assistant text of the run. */
  text: string;
}

export interface Session {
  run(prompt: string, options?: { signal?: AbortSignal }): Promise<RunResult>;
}

export async function createSession(options: SessionOptions): Promise<Session> {
  const agent = new Agent({ streamFn: options.streamFn, initialState: { model: options.model } });
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
