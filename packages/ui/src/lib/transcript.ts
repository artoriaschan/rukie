import type { TranscriptMessage, QueuedInput, BackgroundActivity } from "@rukie/agent";
import type { ToolCallView, ToolResultView } from "@rukie/shared";
export interface SubagentPresentation extends BackgroundActivity {
  outcome?: string;
}
export interface TranscriptTool {
  id: string;
  name: string;
  args: unknown;
  callView?: ToolCallView;
  resultView?: ToolResultView;
  status: "running" | "success" | "error" | "cancelled";
  output: string;
}
export interface PromptGroup {
  id: string;
  messages: readonly TranscriptMessage[];
  status: "running" | "complete" | "aborted" | "failed";
  error?: string;
  startedAt: number;
  durationMs?: number;
}
export interface TranscriptState {
  committed: readonly TranscriptMessage[];
  partial?: TranscriptMessage;
  groups: PromptGroup[];
  tools: Record<string, TranscriptTool>;
  activeTools: Record<string, string>;
  queued: readonly QueuedInput[];
  toolStates: Readonly<Record<string, unknown>>;
  background: readonly SubagentPresentation[];
  summaries: readonly {
    afterMessage: number;
    durationMs: number;
    success: boolean;
    endedAt: number;
  }[];
  active: boolean;
  error?: string;
}
export function messageText(message: { content?: unknown }) {
  if (typeof message.content === "string") return message.content;
  return Array.isArray(message.content)
    ? message.content
        .flatMap((block) =>
          typeof block === "object" &&
          block !== null &&
          block.type === "text" &&
          typeof block.text === "string"
            ? [block.text]
            : [],
        )
        .join("")
    : "";
}

export function presentationCallId(
  message: Pick<TranscriptMessage, "entryId" | "timestamp">,
  callId: string,
) {
  return `${message.entryId ?? `partial-${message.timestamp}`}:${callId}`;
}

export interface PermissionDecision {
  groupId: string;
  reply: "allow" | "deny" | "allow-session";
  title: string;
  origin?: string;
}
