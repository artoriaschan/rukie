import type { SessionEvent, SubagentIdentity } from "@neant/agent";
import type { SubagentView } from "../../components/subagent-message";

export interface SubagentState extends SubagentView {
  output: readonly { type: "text" | "thinking" | "tool"; text: string }[];
  streamedText: boolean;
  streamedKind?: "text" | "thinking";
}

function createRow(
  agentId: string,
  description: string,
  subagentType: string,
  now: number,
): SubagentState {
  return {
    agentId,
    childSessionId: agentId,
    description,
    subagentType,
    status: "idle",
    startedAt: now,
    durationMs: 0,
    tokens: 0,
    toolCalls: [],
    outputLines: [],
    output: [],
    streamedText: false,
  };
}

/** Durable history never creates a current Run. Unsettled and old records stay unknown. */
export function restoreSubagents(value: unknown): Readonly<Record<string, SubagentState>> {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries(
    value.flatMap((row) => {
      if (
        !row ||
        typeof row.id !== "string" ||
        typeof row.description !== "string" ||
        typeof row.type !== "string"
      )
        return [];
      const run = (row as SubagentIdentity).latestRun;
      return [
        [
          row.id,
          {
            ...createRow(row.id, row.description, row.type, run?.startedAt ?? 0),
            completedAt: run?.endedAt,
            durationMs: run?.endedAt ? Math.max(0, run.endedAt - run.startedAt) : 0,
            runOutcome: run?.outcome ?? "unknown",
            runReason: run?.reason ?? run?.error,
          },
        ],
      ];
    }),
  );
}

function appendOutput(row: SubagentState, type: "text" | "thinking", text: string): SubagentState {
  const last = row.output.at(-1);
  const output =
    last?.type === type && row.streamedKind === type
      ? [...row.output.slice(0, -1), { type, text: last.text + text }]
      : [...row.output, { type, text }];
  const lines = text.split(/\r?\n/);
  const outputLines =
    row.streamedKind === type && row.outputLines.length
      ? [...row.outputLines.slice(0, -1), row.outputLines.at(-1)! + lines[0], ...lines.slice(1)]
      : [...row.outputLines, ...lines];
  return {
    ...row,
    output,
    outputLines,
    streamedText: row.streamedText || type === "text",
    streamedKind: type,
  };
}

function toolResultPreview(result: unknown): string | undefined {
  if (
    typeof result !== "object" ||
    result === null ||
    !("content" in result) ||
    !Array.isArray(result.content)
  )
    return undefined;
  const text = result.content
    .flatMap((item: unknown) =>
      typeof item === "object" && item !== null && "text" in item && typeof item.text === "string"
        ? [item.text]
        : [],
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? (text.length > 80 ? text.slice(0, 80) + "…" : text) : undefined;
}

/** Fold child events separately from the parent transcript and activity. */
export function reduceSubagent(
  previous: SubagentState | undefined,
  wrapped: Extract<SessionEvent, { type: "subagent_event" }>,
  now: number,
): SubagentState {
  const row = previous ?? {
    ...createRow(wrapped.agentId, wrapped.description, wrapped.subagentType, now),
    status: "running" as const,
  };
  const event = wrapped.event;
  switch (event.type) {
    case "session_start":
      return {
        ...createRow(wrapped.agentId, wrapped.description, wrapped.subagentType, now),
        childSessionId: event.sessionId,
        status: "running",
        model: event.model,
      };
    case "message_start":
      return event.message.role === "assistant"
        ? { ...row, streamedText: false, streamedKind: undefined }
        : row;
    case "message_update": {
      const delta = event.assistantMessageEvent;
      return delta.type === "text_delta"
        ? appendOutput(row, "text", delta.delta)
        : delta.type === "thinking_delta"
          ? appendOutput(row, "thinking", delta.delta)
          : row;
    }
    case "tool_execution_start": {
      const argsPreview = JSON.stringify(event.args).replace(/\s+/g, " ");
      return {
        ...row,
        toolCalls: [
          ...row.toolCalls,
          {
            id: event.toolCallId,
            name: event.toolName,
            argsPreview,
            status: "running",
            startedAt: now,
          },
        ],
        output: [...row.output, { type: "tool", text: `${event.toolName} ${argsPreview}` }],
      };
    }
    case "tool_execution_end": {
      const preview = toolResultPreview(event.result);
      return {
        ...row,
        toolCalls: row.toolCalls.map((tool) =>
          tool.id === event.toolCallId
            ? {
                ...tool,
                status: event.isError ? "failed" : "completed",
                durationMs: Math.max(0, now - (tool.startedAt ?? now)),
                resultPreview: event.isError ? undefined : preview,
                error: event.isError ? preview : undefined,
              }
            : tool,
        ),
      };
    }
    case "message_end": {
      if (event.message.role !== "assistant") return row;
      const text = event.message.content
        .flatMap((item) => (item.type === "text" ? [item.text] : []))
        .join("");
      const next = !row.streamedText && text ? appendOutput(row, "text", text) : row;
      return {
        ...next,
        tokens: row.tokens + event.message.usage.totalTokens,
        status: event.message.stopReason === "aborted" ? "aborted" : row.status,
        error: event.message.errorMessage ?? row.error,
      };
    }
    case "result":
      return {
        ...row,
        status: row.status === "aborted" ? "aborted" : event.success ? "completed" : "failed",
        tokens: event.usage.totalTokens,
        durationMs: event.durationMs,
        completedAt: now,
        error: event.error,
      };
    default:
      return row;
  }
}
