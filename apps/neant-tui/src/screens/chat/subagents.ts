import type { Session, SessionEvent, SessionRecovery, SubagentIdentity } from "@neant/agent";
import { isUnknownToolOutcome } from "@neant/shared";
import type { SubagentView, SubagentOutput } from "../../components/subagent-message";

export interface SubagentState extends SubagentView {
  output: readonly { type: "user" | "text" | "thinking" | "tool"; text: string; toolId?: string }[];
  messageOutputStart?: number;
  historyLoaded?: boolean;
  streamedText: boolean;
  streamedKind?: "text" | "thinking";
}

function createRow(
  agentId: string,
  description: string,
  subagentType: string,
  now?: number,
): SubagentState {
  return {
    agentId,
    childSessionId: agentId,
    description,
    subagentType,
    status: "idle",
    startedAt: now,
    toolCalls: [],
    outputLines: [],
    output: [],
    streamedText: false,
  };
}

/** Read-only recovery refines durable history without creating a current Run. */
export function restoreSubagents(
  value: unknown,
  recovery?: SessionRecovery,
): Readonly<Record<string, SubagentState>> {
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
      const observed = recovery?.history?.find(
        (child) => child.id === row.id && child.runId === run?.id,
      );
      return [
        [
          row.id,
          {
            ...createRow(row.id, row.description, row.type, run?.startedAt),
            completedAt: run?.endedAt,
            durationMs:
              run?.durationMs ??
              (run?.endedAt === undefined ? undefined : Math.max(0, run.endedAt - run.startedAt)),
            model: run?.model,
            tokens: run?.tokens,
            error: run?.error,
            runOutcome: observed?.outcome ?? run?.outcome ?? "unknown",
            runReason: observed?.reason ?? run?.reason ?? run?.error,
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

function toolResultText(result: unknown): string | undefined {
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
    .join("\n")
    .trim();
  return text || undefined;
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
        ? {
            ...row,
            streamedText: false,
            streamedKind: undefined,
            messageOutputStart: row.output.length,
          }
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
            args: event.args,
            view: event.view,
            status: "running",
            startedAt: now,
          },
        ],
        output: row.output.some((block) => block.toolId === event.toolCallId)
          ? row.output
          : [
              ...row.output,
              { type: "tool", toolId: event.toolCallId, text: `${event.toolName} ${argsPreview}` },
            ],
      };
    }
    case "tool_execution_end": {
      const preview = toolResultText(event.result);
      return {
        ...row,
        toolCalls: row.toolCalls.map((tool) =>
          tool.id === event.toolCallId
            ? {
                ...tool,
                status: event.isError ? "failed" : "completed",
                durationMs: Math.max(0, now - (tool.startedAt ?? now)),
                resultView: event.view,
                endedAt: now,
                result: event.isError ? undefined : preview,
                resultPreview: event.isError ? undefined : preview,
                error: event.isError ? preview : undefined,
              }
            : tool,
        ),
      };
    }
    case "message_end": {
      if (event.message.role !== "assistant") return row;
      const blocks = event.message.content.flatMap<SubagentOutput>((block) =>
        block.type === "text" || block.type === "thinking"
          ? [{ type: block.type, text: block.type === "text" ? block.text : block.thinking }]
          : block.type === "toolCall"
            ? [
                {
                  type: "tool" as const,
                  toolId: block.id,
                  text: `${block.name} ${JSON.stringify(block.arguments)}`,
                },
              ]
            : [],
      );
      const output = [
        ...row.output.slice(0, row.messageOutputStart ?? row.output.length),
        ...blocks,
      ];
      return {
        ...row,
        output,
        outputLines: output
          .filter((block) => block.type === "text" || block.type === "thinking")
          .flatMap((block) => block.text.split(/\r?\n/)),
        streamedKind: undefined,
        tokens: (row.tokens ?? 0) + event.message.usage.totalTokens,
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

/** Replay actual saved child messages, preserving provider block and tool-result order. */
export function projectSubagent(
  row: SubagentState,
  snapshot: NonNullable<Awaited<ReturnType<Session["readSubagent"]>>>,
): SubagentState {
  const output: SubagentState["output"][number][] = [];
  const tools: SubagentView["toolCalls"][number][] = [];
  for (const message of snapshot.messages) {
    if (message.role === "user" && !("source" in message))
      output.push({
        type: "user",
        text:
          typeof message.content === "string"
            ? message.content
            : message.content
                .flatMap((block) => (block.type === "text" ? [block.text] : []))
                .join(""),
      });
    if (message.role === "assistant")
      for (const block of message.content) {
        if (block.type === "text") output.push({ type: "text", text: block.text });
        if (block.type === "thinking") output.push({ type: "thinking", text: block.thinking });
        if (block.type === "toolCall") {
          tools.push({
            id: block.id,
            name: block.name,
            args: block.arguments,
            argsPreview: JSON.stringify(block.arguments),
            view: block.view,
            status: "unknown",
          });
          output.push({
            type: "tool",
            toolId: block.id,
            text: `${block.name} ${JSON.stringify(block.arguments)}`,
          });
        }
      }
    if (message.role === "toolResult") {
      const index = tools.findIndex((tool) => tool.id === message.toolCallId);
      if (index >= 0) {
        const text = toolResultText(message);
        const unknown = isUnknownToolOutcome(message.details);
        tools[index] = {
          ...tools[index]!,
          status: unknown ? "unknown" : message.isError ? "failed" : "completed",
          resultView: message.view,
          result: unknown || message.isError ? undefined : text,
          error: !unknown && message.isError ? text : undefined,
        };
      }
    }
  }
  return {
    ...row,
    model: snapshot.model ?? row.model,
    runOutcome: snapshot.run?.outcome ?? row.runOutcome,
    runReason: snapshot.run?.reason ?? snapshot.run?.error ?? row.runReason,
    startedAt: snapshot.run?.startedAt ?? row.startedAt,
    completedAt: snapshot.run?.endedAt ?? row.completedAt,
    durationMs: snapshot.run?.durationMs ?? row.durationMs,
    tokens: snapshot.run?.tokens ?? row.tokens,
    error: snapshot.run?.error ?? row.error,
    output,
    toolCalls: tools,
    outputLines: output
      .filter((block) => block.type === "text" || block.type === "thinking")
      .flatMap((block) => block.text.split(/\r?\n/)),
  };
}
