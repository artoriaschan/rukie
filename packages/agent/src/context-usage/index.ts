import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getCurrentSystemMessage, getCurrentTools, toToolDeclaration } from "@earendil-works/pi-ai";
import type { ContextUsageEvent, ContextReport, ContextCategory } from "@rukie/shared";

import { convertToLlm } from "../reminders/index.ts";
import { inspectImage } from "../images/index.ts";

const tokens = (text: string) => Math.ceil(text.length / 4);

const imageTokens = (data: string) => {
  const info = inspectImage(Buffer.from(data, "base64"));
  return info && info.width > 0 && info.height > 0
    ? Math.min(1600, Math.ceil((info.width * info.height) / 750))
    : 1600;
};

/**
 * Recompute from restored context; historical provider counts are never summed here.
 * Images use ceil(width × height / 750), capped at 1600; unreadable headers use that cap.
 * Provider input tokens override only the total, retaining estimates for attribution.
 */
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
          else if (block.type === "image") segments[segment] += imageTokens(block.data);
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

/** Attribute the current restored model context without mutating it or making a request. */
export function contextReport(options: {
  messages: readonly AgentMessage[];
  model: string;
  window: number;
  inputTokens?: number;
  mcpServers: ReadonlyMap<string, string>;
}): ContextReport {
  const { messages, window } = options;
  const category: Record<ContextCategory, number> = {
    "system-prompt": 0,
    "memory-files": 0,
    "system-tools": 0,
    "mcp-tools": 0,
    skills: 0,
    messages: 0,
    "compaction-reserve": Math.floor(window * 0.2),
    "free-space": 0,
  };
  const memoryFiles: ContextReport["memoryFiles"] = [];
  const skills: ContextReport["skills"] = [];
  const mcpTools: ContextReport["mcpTools"] = [];
  const agentTypes: ContextReport["agentTypes"] = [];
  const latest = new Map<string, Extract<AgentMessage, { role: "system-reminder" }>>();
  for (const message of messages)
    if (message.role === "system-reminder") latest.set(message.source, message);
  const attributed = new Set<AgentMessage>();
  for (const source of ["user-instructions", "project-instructions"]) {
    const message = latest.get(source);
    if (!message) continue;
    const path = /^Project Instructions \(([^\n]+)\):\n/.exec(message.content)?.[1];
    if (!path) continue;
    const count = tokens(message.content);
    memoryFiles.push({ path, tokens: count });
    category["memory-files"] += count;
    attributed.add(message);
  }
  const catalog = latest.get("skills");
  if (catalog) {
    category.skills = tokens(catalog.content);
    attributed.add(catalog);
    for (const match of catalog.content.matchAll(/^- ([a-z0-9-]+): (.*)$/gm))
      skills.push({ name: match[1]!, tokens: tokens(match[0]) });
  }
  // Preserve exact identities from MCP discovery; persisted reminder headers
  // recover server names on resume, including names containing separators.
  const serverNames = [...(latest.get("mcp")?.content.matchAll(/^(.+):$/gm) ?? [])]
    .map((match) => match[1]!)
    .sort((a, b) => b.length - a.length);
  const system = getCurrentSystemMessage(messages);
  if (system) {
    const text =
      typeof system.content === "string"
        ? system.content
        : system.content.map((block) => block.text).join("");
    category["system-prompt"] =
      tokens(text) +
      Object.values(system.sections ?? {}).reduce(
        (sum, section) => sum + (section ? tokens(section) : 0),
        0,
      );
  }
  for (const tool of getCurrentTools(messages)) {
    const count = tokens(JSON.stringify(toToolDeclaration(tool)));
    if (tool.name.startsWith("mcp__")) {
      const server =
        options.mcpServers.get(tool.name) ??
        serverNames.find((name) => tool.name.startsWith(`mcp__${name}__`)) ??
        /^mcp__(.*?)__/.exec(tool.name)?.[1] ??
        "unknown";
      mcpTools.push({ server, name: tool.name.slice(`mcp__${server}__`.length), tokens: count });
      category["mcp-tools"] += count;
    } else {
      category["system-tools"] += count;
      if (tool.name === "subagent") {
        const list = tool.description.split("Available types:\n")[1];
        for (const match of list?.matchAll(/^([^:\n]+): (.*)$/gm) ?? [])
          agentTypes.push({ name: match[1]!, tokens: tokens(match[0]) });
      }
    }
  }
  // Superseded file/catalog snapshots still occupy model context. Only their
  // current, separately attributed snapshots are removed from Messages.
  const remainder = messages.filter(
    (message) => message.role !== "system" && !attributed.has(message),
  );
  const visible = remainder.flatMap((message): AgentMessage[] =>
    message.role === "user" && "skillInvocation" in message ? convertToLlm([message]) : [message],
  );
  category.messages = Object.values(contextUsage(visible, window).segments).reduce(
    (sum, count) => sum + count,
    0,
  );
  const estimate =
    category["system-prompt"] +
    category["memory-files"] +
    category["system-tools"] +
    category["mcp-tools"] +
    category.skills +
    category.messages;
  const used = options.inputTokens ?? estimate;
  category["free-space"] = Math.max(0, window - used - category["compaction-reserve"]);
  return {
    model: options.model,
    window,
    used,
    categories: Object.entries(category).map(([name, count]) => ({
      name: name as ContextCategory,
      tokens: count,
    })),
    memoryFiles,
    mcpTools,
    skills,
    agentTypes,
  };
}
