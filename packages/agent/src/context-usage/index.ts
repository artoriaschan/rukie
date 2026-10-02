import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import type { ContextUsageEvent } from "@neant/shared";

const tokens = (text: string) => Math.ceil(text.length / 4);

/** Recompute from restored context; historical provider counts are never summed here. */
export function contextUsage(
  messages: readonly AgentMessage[],
  window: number,
  inputTokens?: number,
): ContextUsageEvent {
  const segments = { system: 0, prompt: 0, assistant: 0, thinking: 0, tools: 0 };
  const system = getCurrentSystemMessage(messages.filter((message) => message.role === "system"));
  if (system) {
    segments.system = tokens(
      typeof system.content === "string"
        ? system.content
        : system.content.map((block) => block.text).join(""),
    );
    for (const section of Object.values(system.sections ?? {})) {
      if (section) segments.system += tokens(section);
    }
  }
  for (const message of messages) {
    if (message.role === "system-reminder") {
      segments.prompt += tokens(message.content);
    } else if (message.role === "user" || message.role === "toolResult") {
      const segment = message.role === "user" ? "prompt" : "tools";
      if (typeof message.content === "string") segments[segment] += tokens(message.content);
      else
        for (const block of message.content) {
          if (block.type === "text") segments[segment] += tokens(block.text);
        }
    } else if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "text") segments.assistant += tokens(block.text);
        else if (block.type === "thinking") segments.thinking += tokens(block.thinking);
        else if (block.type === "toolCall")
          segments.assistant += tokens(block.name + JSON.stringify(block.arguments));
      }
    } else if (message.role === "compactionSummary") {
      segments.prompt += tokens(message.summary);
    }
  }
  return {
    type: "context_usage",
    used: inputTokens ?? Object.values(segments).reduce((total, count) => total + count, 0),
    window,
    segments,
  };
}
