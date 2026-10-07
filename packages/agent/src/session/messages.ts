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
export type TranscriptToolResult = ToolResultMessage & {
  view?: ToolResultView;
  outcomeUnknown?: boolean;
};

type TranscriptMessageContent =
  | Exclude<Message, UserMessage | AssistantMessage | ToolResultMessage>
  | (UserMessage & { imageNames?: (string | null)[]; skillInvocation?: string; source?: string })
  | TranscriptAssistantMessage
  | TranscriptToolResult
  | SystemReminder
  | SessionNoticeMessage;

export type TranscriptMessage = TranscriptMessageContent & { entryId?: string };

/** Application facts remain distinct from each entry's native model contribution. */
export function transcriptMessages(entries: readonly EntryRecord[]): TranscriptMessage[] {
  const facts = entries.flatMap((entry) =>
    entry.kind === "rukie.message-facts" &&
    entry.data &&
    typeof entry.data === "object" &&
    !Array.isArray(entry.data)
      ? [entry.data]
      : [],
  );
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
            entryId: String(entry.id),
            timestamp: typeof data.timestamp === "number" ? data.timestamp : 0,
          },
        ];
    }
    return (entry.model ?? []).map((message): TranscriptMessage => {
      const projected: TranscriptMessage = {
        ...structuredClone(message),
        entryId: String(entry.id),
      };
      for (const fact of facts) {
        const matches =
          fact.entryId === Number(entry.id) ||
          (fact.taskId === Number(entry.byTaskId) &&
            (fact.timestamp === message.timestamp ||
              (message.role === "user" &&
                typeof fact.content === "string" &&
                (typeof message.content === "string"
                  ? message.content
                  : message.content
                      .flatMap((block) => (block.type === "text" ? [block.text] : []))
                      .join("")) === fact.content)));
        if (!matches) continue;
        if (projected.role === "user") {
          if (
            Array.isArray(fact.imageNames) &&
            fact.imageNames.every((name) => name === null || typeof name === "string")
          )
            projected.imageNames = fact.imageNames;
          if (typeof fact.skillInvocation === "string")
            projected.skillInvocation = fact.skillInvocation;
          if (typeof fact.source === "string") projected.source = fact.source;
        }
        if (
          projected.role === "assistant" &&
          typeof fact.thinkingDurationMs === "number" &&
          Number.isFinite(fact.thinkingDurationMs) &&
          fact.thinkingDurationMs >= 0
        )
          projected.rukieThinkingDurationMs = fact.thinkingDurationMs;
      }
      return projected;
    });
  });
}
