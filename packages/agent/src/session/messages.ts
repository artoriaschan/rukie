import type {
  AssistantMessage,
  Message,
  UserMessage,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { ToolCallView, ToolResultView } from "@rukie/shared";
import type { EntryRecord } from "@earendil-works/pi-durable";
import type { SystemReminder } from "../reminders/index.ts";
import type { SessionNoticeMessage } from "./session-notice.ts";
import { readSessionNotice } from "./session-notice.ts";

export type TranscriptAssistantMessage = Omit<AssistantMessage, "content"> & {
  content: (AssistantMessage["content"][number] & { view?: ToolCallView })[];
  rukieThinkingDurationMs?: number;
};
export type TranscriptToolResult = ToolResultMessage & { view?: ToolResultView };

type TranscriptMessageContent =
  | Exclude<Message, UserMessage | AssistantMessage | ToolResultMessage>
  | (UserMessage & { imageNames?: string[]; skillInvocation?: string; source?: string })
  | TranscriptAssistantMessage
  | TranscriptToolResult
  | SystemReminder
  | SessionNoticeMessage;

export type TranscriptMessage = TranscriptMessageContent & { entryId?: string };

/** Application facts remain distinct from each entry's native model contribution. */
export function transcriptMessages(entries: readonly EntryRecord[]): TranscriptMessage[] {
  return entries.flatMap((entry): TranscriptMessage[] => {
    const data = entry.data;
    if (
      entry.kind === "rukie.reminder" &&
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      typeof data.source === "string" &&
      typeof data.content === "string" &&
      typeof data.timestamp === "number"
    )
      return [
        {
          role: "system-reminder",
          source: data.source,
          content: data.content,
          timestamp: data.timestamp,
          entryId: String(entry.id),
        },
      ];
    if (entry.kind === "rukie.notice" && data && typeof data === "object" && !Array.isArray(data)) {
      const notice = readSessionNotice(data);
      if (notice)
        return [
          {
            role: "session-notice",
            notice,
            timestamp: typeof data.timestamp === "number" ? data.timestamp : 0,
          },
        ];
    }
    return (entry.model ?? []).map((message) => ({
      ...structuredClone(message),
      entryId: String(entry.id),
    }));
  });
}
