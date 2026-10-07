import type {
  AssistantMessage,
  Message,
  UserMessage,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { ToolCallView, ToolResultView } from "@rukie/shared";
import type { ContextView, EntryRecord } from "@earendil-works/pi-durable";
import type { SystemReminder } from "../reminders/index.ts";
import type { SessionNoticeMessage } from "./session-notice.ts";
import { readSessionNotice } from "./session-notice.ts";

export type TranscriptAssistantMessage = Omit<AssistantMessage, "content"> & {
  content: (AssistantMessage["content"][number] & { view?: ToolCallView })[];
  rukieThinkingDurationMs?: number;
};
export type TranscriptToolResult = ToolResultMessage & {
  view?: ToolResultView;
  /** The native tool task was interrupted after execution may have started. */
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

/** Place committed post-compaction instructions before the retained context tail. */
function orderCompactionEntries(entries: readonly EntryRecord[]): readonly EntryRecord[] {
  const anchors = new Set(
    entries.filter((entry) => entry.kind === "pi.compaction").map((entry) => Number(entry.id)),
  );
  const anchored = new Map<number, EntryRecord[]>();
  const remaining = entries.filter((entry) => {
    const data = entry.data;
    const anchor =
      entry.kind === "rukie.reminder" && data && typeof data === "object" && !Array.isArray(data)
        ? data.afterCompactionId
        : undefined;
    if (typeof anchor !== "number" || !anchors.has(anchor)) return true;
    const group = anchored.get(anchor) ?? [];
    group.push(entry);
    anchored.set(anchor, group);
    return false;
  });
  return remaining.flatMap((entry) => [entry, ...(anchored.get(Number(entry.id)) ?? [])]);
}

/** Keep native context edits, excluded attempts and synthetic results intact while ordering owner inputs. */
export function modelContextMessages(view: ContextView): readonly Message[] {
  const contributions = new Map(
    view.entries.map((entry, index) => [entry, view.contributions[index] ?? []]),
  );
  const ordered = orderCompactionEntries(view.entries);
  const moved = ordered.flatMap((entry) => {
    const data = entry.data;
    return entry.kind === "rukie.reminder" &&
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      typeof data.afterCompactionId === "number"
      ? [...(contributions.get(entry) ?? [])]
      : [];
  });
  if (!moved.length) return view.messages;
  const remaining = view.messages.filter((message) => !moved.includes(message));
  for (const anchor of ordered.filter((entry) => entry.kind === "pi.compaction")) {
    const group = ordered.flatMap((entry) => {
      const data = entry.data;
      return entry.kind === "rukie.reminder" &&
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        data.afterCompactionId === Number(anchor.id)
        ? [...(contributions.get(entry) ?? [])]
        : [];
    });
    const summary = contributions.get(anchor)?.at(-1);
    const index = summary === undefined ? -1 : remaining.indexOf(summary);
    if (index >= 0) remaining.splice(index + 1, 0, ...group);
    else remaining.push(...group);
  }
  return remaining;
}

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
  return orderCompactionEntries(entries).flatMap((entry): TranscriptMessage[] => {
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
    if (
      entry.kind === "pi.compaction" &&
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      (data.reason === "manual" || data.reason === "threshold" || data.reason === "overflow")
    )
      return [
        {
          role: "session-notice",
          notice: { kind: "compaction", reason: data.reason },
          timestamp: entry.model?.[0]?.timestamp ?? 0,
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
