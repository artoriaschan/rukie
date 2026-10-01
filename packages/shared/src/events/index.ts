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

export type CustomSessionEvent =
  | { type: "session_start"; model: string; cwd: string; tools: string[] }
  | ({ type: "result" } & RunResult)
  | { type: "reminder_injected"; source: string; content: string }
  | { type: "permission_denied"; toolCallId: string; toolName: string }
  | { type: "mcp_server_error"; server: string; error: string }
  | { type: "compaction"; summary: string; tokensBefore: number };

/** The caller supplies pi's native AgentEvent without a runtime or type dependency here. */
export type SessionEvent<PiEvent extends { type: string }> = (PiEvent | CustomSessionEvent) & {
  sessionId: string;
};
