import type { AgentEvent } from "@earendil-works/pi-durable";
import type { RunResult, SessionEvent as SharedSessionEvent } from "@rukie/shared";
import type {
  TranscriptMessage,
  TranscriptAssistantMessage,
  TranscriptToolResult,
} from "./messages.ts";

export interface BackgroundActivity {
  id: string;
  description: string;
  subagentType: string;
  active: boolean;
}

type CommittedEvent<E extends AgentEvent = AgentEvent> = E extends { type: "snapshot" }
  ? E & { messages: readonly TranscriptMessage[]; background: readonly BackgroundActivity[] }
  : E extends { type: "message_end" }
    ? E & { entryId: string; messages: readonly TranscriptMessage[] }
    : E extends { type: "message_update" }
      ? E & { message: TranscriptAssistantMessage }
      : E extends { type: "tool_execution_end" }
        ? E & { result?: TranscriptToolResult }
        : E;

/** Parent Run boundaries and causal request settlement are separate published facts. */
export type SessionEvent =
  | SharedSessionEvent<CommittedEvent>
  | ({
      type: "request_settled";
      sessionId: string;
      requestId: string;
    } & RunResult);
