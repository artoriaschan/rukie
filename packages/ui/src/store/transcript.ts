import type { SessionEvent, TranscriptMessage } from "@rukie/agent";
import { ToolCallViewSchema, ToolResultViewSchema } from "@rukie/shared";
import { Value } from "typebox/value";
import type { TranscriptState, TranscriptTool, PromptGroup } from "../lib/transcript";
import { messageText, presentationCallId } from "../lib/transcript";

const empty = (): TranscriptState => ({
  committed: [],
  groups: [],
  tools: {},
  activeTools: {},
  queued: [],
  toolStates: {},
  background: [],
  summaries: [],
  active: false,
});
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function message(value: unknown): value is TranscriptMessage {
  if (
    !record(value) ||
    typeof value.role !== "string" ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp)
  )
    return false;
  if (value.entryId !== undefined && typeof value.entryId !== "string") return false;
  if (value.source !== undefined && typeof value.source !== "string") return false;
  if (value.errorMessage !== undefined && typeof value.errorMessage !== "string") return false;
  if (value.stopReason !== undefined && typeof value.stopReason !== "string") return false;
  if (value.outcomeUnknown !== undefined && typeof value.outcomeUnknown !== "boolean") return false;
  if (
    value.imageNames !== undefined &&
    (!Array.isArray(value.imageNames) ||
      !value.imageNames.every((name) => name === null || typeof name === "string"))
  )
    return false;
  if (value.role === "session-notice")
    return record(value.notice) && typeof value.notice.kind === "string";
  if (value.view !== undefined && !Value.Check(ToolResultViewSchema, value.view)) return false;
  if (!["system", "system-reminder", "user", "assistant", "toolResult"].includes(value.role))
    return false;
  if (
    value.role === "toolResult" &&
    (typeof value.toolCallId !== "string" ||
      typeof value.toolName !== "string" ||
      typeof value.isError !== "boolean")
  )
    return false;
  if (typeof value.content === "string")
    return value.role !== "assistant" && value.role !== "toolResult";
  return (
    Array.isArray(value.content) &&
    value.content.every(
      (block) =>
        record(block) &&
        (block.view === undefined || Value.Check(ToolCallViewSchema, block.view)) &&
        ((block.type === "text" && typeof block.text === "string") ||
          (block.type === "thinking" && typeof block.thinking === "string") ||
          (block.type === "toolCall" &&
            typeof block.id === "string" &&
            typeof block.name === "string" &&
            record(block.arguments)) ||
          (block.type === "image" &&
            typeof block.data === "string" &&
            typeof block.mimeType === "string")),
    )
  );
}
function messages(value: unknown): value is TranscriptMessage[] {
  return Array.isArray(value) && value.every(message);
}

function queued(value: unknown) {
  return (
    record(value) &&
    typeof value.requestId === "string" &&
    typeof value.prompt === "string" &&
    Array.isArray(value.images) &&
    value.images.every(
      (image) =>
        record(image) &&
        typeof image.data === "string" &&
        typeof image.mimeType === "string" &&
        (image.name === undefined || typeof image.name === "string"),
    )
  );
}
function validEvent(event: unknown): event is SessionEvent {
  if (!record(event) || typeof event.type !== "string") return false;
  switch (event.type) {
    case "snapshot":
      return (
        messages(event.messages) &&
        (event.tools === undefined ||
          (Array.isArray(event.tools) &&
            event.tools.every(
              (slot) =>
                record(slot) &&
                typeof slot.callId === "string" &&
                typeof slot.name === "string" &&
                typeof slot.status === "string" &&
                (slot.output === undefined ||
                  slot.output === null ||
                  typeof slot.output === "string"),
            ))) &&
        (event.queuedInputs === undefined ||
          (Array.isArray(event.queuedInputs) && event.queuedInputs.every(queued))) &&
        (event.toolStates === undefined || record(event.toolStates)) &&
        (event.background === undefined ||
          (Array.isArray(event.background) &&
            event.background.every(
              (item) =>
                record(item) &&
                typeof item.id === "string" &&
                typeof item.description === "string" &&
                typeof item.subagentType === "string" &&
                typeof item.active === "boolean",
            ))) &&
        (event.runSummaries === undefined ||
          (Array.isArray(event.runSummaries) &&
            event.runSummaries.every(
              (item) =>
                record(item) &&
                typeof item.afterMessage === "number" &&
                typeof item.durationMs === "number" &&
                typeof item.success === "boolean" &&
                typeof item.endedAt === "number",
            )))
      );
    case "message_start":
    case "message_update":
      return message(event.message);
    case "message_end":
      return typeof event.entryId === "string" && messages(event.messages);
    case "run_start":
    case "run_end":
      return true;
    case "queued_inputs_update":
      return Array.isArray(event.items) && event.items.every(queued);
    case "tool_state_changed":
      return typeof event.name === "string";
    case "subagent_event":
      return (
        typeof event.agentId === "string" &&
        typeof event.description === "string" &&
        typeof event.subagentType === "string" &&
        record(event.event) &&
        typeof event.event.type === "string"
      );
    case "tool_execution_start":
      return (
        typeof event.toolCallId === "string" &&
        typeof event.toolName === "string" &&
        (event.view === undefined || Value.Check(ToolCallViewSchema, event.view))
      );
    case "tool_execution_update":
      return (
        typeof event.toolCallId === "string" &&
        (event.output === undefined ||
          (record(event.output) &&
            [event.output.set, event.output.append].every(
              (value) => value === undefined || value === null || typeof value === "string",
            )))
      );
    case "tool_execution_end":
      return (
        typeof event.toolCallId === "string" &&
        (event.result === undefined || message(event.result)) &&
        (event.view === undefined || Value.Check(ToolResultViewSchema, event.view))
      );
    case "result":
      return (
        typeof event.success === "boolean" &&
        typeof event.durationMs === "number" &&
        (event.error === undefined || typeof event.error === "string")
      );
    default:
      return false;
  }
}

function project(state: TranscriptState): TranscriptState {
  const tools: Record<string, TranscriptTool> = {};
  const activeTools: Record<string, string> = {};
  const groups: PromptGroup[] = [];
  let index = 0;
  for (const msg of [...state.committed, ...(state.partial ? [state.partial] : [])]) {
    index++;
    if (msg.role === "system" || msg.role === "system-reminder") continue;
    if (msg.role === "session-notice" && !groups.length) continue;
    if (
      (msg.role === "user" && (!("source" in msg) || !msg.source || msg.source === "user")) ||
      !groups.length
    ) {
      groups.push({
        id: msg.entryId ?? `turn-${index}`,
        messages: [],
        status: "complete",
        startedAt: msg.timestamp,
      });
    }
    const turn = groups.at(-1)!;
    turn.messages = [...turn.messages, msg];
    const summary = state.summaries.find((item) => item.afterMessage === index);
    if (
      (msg.role === "assistant" && msg.stopReason === "aborted") ||
      (msg.role === "session-notice" && msg.notice.kind === "interrupted")
    )
      turn.status = "aborted";
    if (msg.role === "assistant" && msg.stopReason === "error") {
      turn.status = "failed";
      if (typeof msg.errorMessage === "string") turn.error = msg.errorMessage;
    }
    if (summary) {
      turn.durationMs = summary.durationMs;
      if (turn.status !== "aborted")
        turn.status = summary.success
          ? "complete"
          : /abort|interrupt/i.test(state.error ?? "")
            ? "aborted"
            : "failed";
    }
    if (msg.role === "assistant")
      for (const block of msg.content) {
        if (block.type !== "toolCall") continue;
        const key = presentationCallId(msg, block.id);
        activeTools[block.id] = key;
        const current = state.tools[key];
        tools[key] = {
          id: key,
          name: block.name,
          status: "running",
          output: "",
          ...current,
          args: block.arguments,
          ...(block.view ? { callView: block.view } : {}),
        };
      }
    if (msg.role === "toolResult") {
      const key =
        activeTools[msg.toolCallId] ?? `result-${msg.entryId ?? msg.timestamp}:${msg.toolCallId}`;
      const current = tools[key];
      tools[key] = {
        id: key,
        name: msg.toolName,
        args: {},
        ...current,
        status: msg.outcomeUnknown ? "cancelled" : msg.isError ? "error" : "success",
        output: messageText(msg),
        resultView: msg.view,
      };
    }
  }
  const latest = groups.at(-1);
  if (latest && state.error) latest.error = state.error;
  const identities = state.toolStates.subagents;
  const background = [...state.background];
  if (Array.isArray(identities))
    for (const item of identities) {
      if (
        !record(item) ||
        typeof item.id !== "string" ||
        typeof item.description !== "string" ||
        typeof item.type !== "string" ||
        typeof item.active !== "boolean"
      )
        continue;
      const live = background.findIndex((agent) => agent.id === item.id);
      const active = item.active;
      const outcome =
        record(item.latestRun) && typeof item.latestRun.outcome === "string"
          ? item.latestRun.outcome
          : undefined;
      const activity = {
        id: item.id,
        description: item.description,
        subagentType: item.type,
        active,
        outcome,
      };
      if (live < 0) background.push(activity);
      else background[live] = activity;
    }
  const last = groups.at(-1);
  if (last && state.active) last.status = "running";
  return { ...state, groups, tools, background, activeTools };
}
/** Snapshots rebase history; commits replace one entry. Partials remain separate until committed. */
export function reduceTranscript(
  previous: TranscriptState | undefined,
  event: unknown,
): TranscriptState {
  let state = previous ?? empty();
  if (!validEvent(event)) return state;
  if (event.type === "snapshot") {
    state = {
      ...empty(),
      committed: messages(event.messages) ? event.messages : [],
      queued: event.queuedInputs ?? [],
      toolStates: event.toolStates ?? {},
      background: event.background ?? [],
      summaries: event.runSummaries ?? [],
      active: Boolean(event.run),
    };
    for (const slot of event.tools ?? []) {
      if (typeof slot.callId !== "string" || typeof slot.name !== "string") continue;
      const assistant = state.committed.findLast(
        (message) =>
          message.role === "assistant" &&
          message.content.some((block) => block.type === "toolCall" && block.id === slot.callId),
      );
      const key = assistant ? presentationCallId(assistant, slot.callId) : `live:${slot.callId}`;
      state.tools[key] = {
        id: key,
        name: slot.name,
        args: {},
        status: slot.status === "running" ? "running" : "success",
        output: typeof slot.output === "string" ? slot.output : "",
      };
    }
    if (event.generation?.message && message(event.generation.message))
      state.partial = event.generation.message;
  } else if (event.type === "message_start" || event.type === "message_update") {
    if (event.message.role === "assistant") state = { ...state, partial: event.message };
  } else if (event.type === "message_end" && messages(event.messages)) {
    const first = state.committed.findIndex((item) => item.entryId === event.entryId);
    const committed = state.committed.filter((item) => item.entryId !== event.entryId);
    committed.splice(first < 0 ? committed.length : first, 0, ...event.messages);
    state = {
      ...state,
      committed,
      partial: event.messages.some((item) => item.role === "assistant") ? undefined : state.partial,
    };
  } else if (event.type === "queued_inputs_update") state = { ...state, queued: event.items };
  else if (event.type === "tool_state_changed")
    state = { ...state, toolStates: { ...state.toolStates, [event.name]: event.value } };
  else if (event.type === "run_start") state = { ...state, active: true, error: undefined };
  else if (event.type === "run_end") state = { ...state, active: false };
  else if (event.type === "subagent_event")
    state = {
      ...state,
      background: [
        ...state.background.filter((item) => item.id !== event.agentId),
        {
          id: event.agentId,
          description: event.description,
          subagentType: event.subagentType,
          active: !["run_end", "result"].includes(event.event.type),
        },
      ],
    };
  else if (event.type === "tool_execution_start") {
    const key = state.activeTools[event.toolCallId] ?? `live:${event.toolCallId}`;
    state = {
      ...state,
      tools: {
        ...state.tools,
        [key]: {
          id: key,
          name: event.toolName,
          args: event.args,
          callView: event.view,
          status: "running",
          output: "",
        },
      },
    };
  } else if (event.type === "tool_execution_update") {
    const key = state.activeTools[event.toolCallId];
    const tool = key ? state.tools[key] : undefined;
    if (tool)
      state = {
        ...state,
        tools: {
          ...state.tools,
          [tool.id]: {
            ...tool,
            output:
              event.output && "set" in event.output
                ? (event.output.set ?? "")
                : event.output && "append" in event.output
                  ? tool.output + event.output.append
                  : tool.output,
          },
        },
      };
  } else if (event.type === "tool_execution_end") {
    const key = state.activeTools[event.toolCallId];
    const tool = key ? state.tools[key] : undefined;
    if (tool)
      state = {
        ...state,
        tools: {
          ...state.tools,
          [tool.id]: {
            ...tool,
            status: event.result?.isError ? "error" : "success",
            output: event.result ? messageText(event.result) : tool.output,
            resultView: event.view ?? event.result?.view,
          },
        },
      };
  } else if (event.type === "result") {
    state = {
      ...state,
      active: false,
      error: event.error,
      summaries: [
        ...state.summaries,
        {
          afterMessage: state.committed.length,
          durationMs: event.durationMs,
          endedAt: event.endedAt ?? Date.now(),
          success: event.success,
        },
      ],
    };
  }
  return project(state);
}
