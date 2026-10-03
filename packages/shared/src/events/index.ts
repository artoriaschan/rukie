/** Token counts for this Run only, summed across assistant messages. */
interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface RunResult {
  text: string;
  success: boolean;
  usage: TokenUsage;
  durationMs: number;
  error?: string;
}

/** Provider input usage, with estimates showing the composition of the current context. */
export interface ContextUsageEvent {
  type: "context_usage";
  used: number;
  window: number;
  segments: {
    system: number;
    prompt: number;
    assistant: number;
    thinking: number;
    tools: number;
  };
}

export type CustomSessionEvent =
  | { type: "session_start"; model: string; cwd: string; tools: string[] }
  | ContextUsageEvent
  | ({ type: "result" } & RunResult)
  | { type: "reminder_injected"; source: string; content: string }
  | { type: "permission_denied"; toolCallId: string; toolName: string }
  | { type: "permission_review"; phase: "start"; toolCallId: string; toolName: string }
  | {
      type: "permission_review";
      phase: "end";
      toolCallId: string;
      risk?: "low" | "medium" | "high";
      decision: "allow" | "ask" | "deny";
      reason?: string;
    }
  | { type: "mcp_server_error"; server: string; error: string }
  | { type: "compaction_start"; tokensBefore: number }
  | { type: "compaction_end"; summary: string; tokensBefore: number; tokensAfter: number };

/** The caller supplies pi's native AgentEvent without a runtime or type dependency here. */
export type SessionEvent<PiEvent extends { type: string }> = (PiEvent | CustomSessionEvent) & {
  sessionId: string;
};
