import type { CustomSessionEvent } from "@rukie/shared";

type NoticeError = { code: string; params: Record<string, string | number> };
/** Model-invisible facts for auxiliary messages that cannot be rebuilt from native messages. */
export type SessionNotice =
  | {
      kind: "interrupted" | "error" | "hook_stopped" | "hook_blocked";
      reason?: string;
      /** Identifies a committed native error whose Run actually ended by user interruption. */
      assistantTimestamp?: number;
    }
  | { kind: "hook_message"; message: string }
  | { kind: "hook_warning"; event: string; hook: string; message: string; error?: NoticeError };
interface SessionNoticeMessage {
  role: "session-notice";
  notice: SessionNotice;
  timestamp: number;
}
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    "session-notice": SessionNoticeMessage;
  }
}

export function sessionNoticeFromHook(
  event: Extract<CustomSessionEvent, { type: "hook_warning" | "hook_message" }>,
): SessionNotice {
  return event.type === "hook_message"
    ? { kind: "hook_message", message: event.message }
    : {
        kind: "hook_warning",
        event: event.event,
        hook: event.hook,
        message: event.message,
        ...(event.error && { error: event.error }),
      };
}

function readError(value: unknown): NoticeError | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("code" in value) ||
    typeof value.code !== "string" ||
    !("params" in value) ||
    !value.params ||
    typeof value.params !== "object" ||
    Array.isArray(value.params)
  )
    return undefined;
  const params: NoticeError["params"] = {};
  for (const [key, parameter] of Object.entries(value.params)) {
    if (
      typeof parameter !== "string" &&
      !(typeof parameter === "number" && Number.isFinite(parameter))
    )
      return undefined;
    params[key] = parameter;
  }
  return { code: value.code, params };
}

/** Native custom message decoding is untrusted; reject malformed persisted facts. */
export function readSessionNotice(message: unknown): SessionNotice | undefined {
  if (
    !message ||
    typeof message !== "object" ||
    !("role" in message) ||
    message.role !== "session-notice" ||
    !("notice" in message)
  )
    return undefined;
  const notice = message.notice;
  if (!notice || typeof notice !== "object" || !("kind" in notice)) return undefined;
  if (notice.kind === "hook_message")
    return "message" in notice && typeof notice.message === "string"
      ? { kind: notice.kind, message: notice.message }
      : undefined;
  if (notice.kind === "hook_warning") {
    if (
      !("message" in notice) ||
      typeof notice.message !== "string" ||
      !("event" in notice) ||
      typeof notice.event !== "string" ||
      !("hook" in notice) ||
      typeof notice.hook !== "string"
    )
      return undefined;
    const error = "error" in notice ? readError(notice.error) : undefined;
    return {
      kind: notice.kind,
      message: notice.message,
      event: notice.event,
      hook: notice.hook,
      ...(error && { error }),
    };
  }
  if (
    notice.kind !== "interrupted" &&
    notice.kind !== "error" &&
    notice.kind !== "hook_stopped" &&
    notice.kind !== "hook_blocked"
  )
    return undefined;
  if ("reason" in notice && notice.reason !== undefined && typeof notice.reason !== "string")
    return undefined;
  if (
    "assistantTimestamp" in notice &&
    notice.assistantTimestamp !== undefined &&
    (typeof notice.assistantTimestamp !== "number" || !Number.isFinite(notice.assistantTimestamp))
  )
    return undefined;
  return {
    kind: notice.kind,
    ...("reason" in notice && typeof notice.reason === "string" && { reason: notice.reason }),
    ...("assistantTimestamp" in notice &&
      typeof notice.assistantTimestamp === "number" && {
        assistantTimestamp: notice.assistantTimestamp,
      }),
  };
}
