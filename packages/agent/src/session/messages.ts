import type {
  AssistantMessage,
  Message,
  UserMessage,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { CustomSessionEvent, ToolCallView, ToolResultView } from "@rukie/shared";
import type { ContextView, EntryRecord, JsonObject, TaskId } from "@earendil-works/pi-durable";
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
  /** Committed permission owner decision for this exact native tool task. */
  permissionDenial?: PermissionDenial;
};

type PermissionDenial = Pick<
  Extract<CustomSessionEvent, { type: "permission_denied" }>,
  "by" | "rule" | "hook" | "reason"
>;

/** Session persists this owner fact before the native blocked result is committed. */
export function permissionDenialFacts(
  toolTaskId: TaskId,
  event: Extract<CustomSessionEvent, { type: "permission_denied" }>,
): JsonObject {
  return {
    toolTaskId: Number(toolTaskId),
    permissionDenial: {
      by: event.by,
      ...(event.rule !== undefined && { rule: event.rule }),
      ...(event.hook !== undefined && { hook: event.hook }),
      ...(event.reason !== undefined && { reason: event.reason }),
    },
  };
}

function readPermissionDenial(value: unknown): PermissionDenial | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  if (!("by" in value)) return undefined;
  const by = value.by;
  if (by !== "rule" && by !== "user" && by !== "review" && by !== "hook") return undefined;
  if ("rule" in value && typeof value.rule !== "string") return undefined;
  if ("hook" in value && typeof value.hook !== "string") return undefined;
  if ("reason" in value && typeof value.reason !== "string") return undefined;
  return {
    by,
    ...("rule" in value && typeof value.rule === "string" && { rule: value.rule }),
    ...("hook" in value && typeof value.hook === "string" && { hook: value.hook }),
    ...("reason" in value && typeof value.reason === "string" && { reason: value.reason }),
  };
}

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
  // Native adapters identify the initial tool baseline from the first message.
  // Owner reminders may precede its committed entry; later system deltas stay in place.
  const baselineIndex = remaining.findIndex((message) => message.role === "system");
  if (baselineIndex > 0) {
    const [baseline] = remaining.splice(baselineIndex, 1);
    if (baseline) remaining.unshift(baseline);
  }
  return remaining;
}

/** Application facts remain distinct from each entry's native model contribution. */
export function transcriptMessages(entries: readonly EntryRecord[]): TranscriptMessage[] {
  const factEntries = entries.flatMap((entry) =>
    entry.kind === "rukie.message-facts" &&
    entry.data &&
    typeof entry.data === "object" &&
    !Array.isArray(entry.data)
      ? [{ id: entry.id, fact: entry.data }]
      : [],
  );
  const facts = factEntries.map(({ fact }) => fact);
  // Pre-admission notification facts apply to one subsequent native input only.
  // A stable request/entry binding supersedes that temporary correlation on replay.
  const presentationEntries = new Map(
    factEntries.flatMap(({ id, fact }) => {
      if (typeof fact.modelContent !== "string") return [];
      const bound =
        typeof fact.requestId === "string"
          ? facts.findLast(
              (candidate) =>
                candidate.requestId === fact.requestId && typeof candidate.entryId === "number",
            )
          : undefined;
      if (bound && typeof bound.entryId === "number") return [[fact, bound.entryId] as const];
      const matched = entries.find(
        (candidate) =>
          candidate.id > id &&
          candidate.kind === "pi.user" &&
          !facts.some(
            (owner) =>
              owner.entryId === Number(candidate.id) &&
              typeof owner.requestId === "string" &&
              owner.requestId.startsWith("human:"),
          ) &&
          candidate.model?.some(
            (message) =>
              message.role === "user" &&
              (typeof message.content === "string"
                ? message.content
                : message.content
                    .flatMap((block) => (block.type === "text" ? [block.text] : []))
                    .join("")) === fact.modelContent,
          ),
      );
      return matched ? [[fact, Number(matched.id)] as const] : [];
    }),
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
      let projected: TranscriptMessage = {
        ...structuredClone(message),
        entryId: String(entry.id),
      };
      for (const fact of facts) {
        if (
          projected.role === "toolResult" &&
          typeof fact.toolTaskId === "number" &&
          Number.isSafeInteger(fact.toolTaskId) &&
          fact.toolTaskId > 0 &&
          entry.byTaskId !== undefined &&
          fact.toolTaskId === Number(entry.byTaskId)
        ) {
          const denial = readPermissionDenial(fact.permissionDenial);
          if (denial) projected.permissionDenial = denial;
        }
        const matches =
          fact.entryId === Number(entry.id) ||
          presentationEntries.get(fact) === Number(entry.id) ||
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
        if (
          message.role === "user" &&
          typeof fact.reminderContent === "string" &&
          typeof fact.source === "string"
        ) {
          projected = {
            role: "system-reminder",
            source: fact.source,
            content: fact.reminderContent,
            timestamp: message.timestamp,
            entryId: String(entry.id),
          };
          continue;
        }
        if (projected.role === "user") {
          if (typeof fact.displayContent === "string")
            projected.content = [{ type: "text", text: fact.displayContent }];
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

/** Reminder history whose native model contributions survive the current context projection. */
export function visibleReminderContents(view: ContextView, source: string): string[] {
  return transcriptMessages(
    view.entries.filter(
      (entry, index) =>
        entry.kind === "rukie.reminder" && (view.contributions[index]?.length ?? 0) > 0,
    ),
  ).flatMap((message) =>
    message.role === "system-reminder" && message.source === source ? [message.content] : [],
  );
}
