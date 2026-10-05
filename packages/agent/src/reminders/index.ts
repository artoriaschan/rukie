import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { convertToLlm as convertPiMessages } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface SystemReminder {
  role: "system-reminder";
  source: string;
  content: string;
  timestamp: number;
}

declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    "system-reminder": SystemReminder;
  }
}

/** A new source only supplies its current content; comparison is owned here. */
export interface ReminderSource {
  source: string;
  currentContent: () => string | undefined | Promise<string | undefined>;
}

/** Custom messages stay intact in the Transcript and convert only at the model boundary. */
export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.flatMap((message): Message[] => {
    if (
      message.role === "user" &&
      "skillInvocation" in message &&
      typeof message.skillInvocation === "string"
    ) {
      const { skillInvocation, ...prompt } = message;
      return [
        prompt,
        {
          role: "user",
          content: [
            { type: "text", text: `<system-reminder>\n${skillInvocation}\n</system-reminder>` },
          ],
          timestamp: message.timestamp,
        },
      ];
    }
    if (message.role === "system-reminder") {
      return [
        {
          role: "user",
          content: [
            { type: "text", text: `<system-reminder>\n${message.content}\n</system-reminder>` },
          ],
          timestamp: message.timestamp,
        },
      ];
    }
    if (
      message.role === "system" ||
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "toolResult"
    ) {
      return [message];
    }
    return convertPiMessages([message]);
  });
}

async function optionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "--no-optional-locks", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const output = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? output.trimEnd() : "unavailable";
  } catch {
    return "unavailable";
  }
}

function latestReminderContents(messages: readonly AgentMessage[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "system-reminder") latest.set(message.source, message.content);
  }
  return latest;
}

export async function collectReminders(options: {
  messages: AgentMessage[];
  cwd: string;
  homeDir: string;
  now: Date;
  sources: ReminderSource[];
  /** Environment is a one-time snapshot, never part of compaction reinjection. */
  includeEnvironment?: boolean;
}): Promise<SystemReminder[]> {
  const { messages, cwd, homeDir, now } = options;
  const latest = latestReminderContents(messages);
  const sources: ReminderSource[] = [];
  const firstRun = !messages.some((message) => message.role === "user");
  if (options.includeEnvironment !== false && firstRun && !latest.has("environment")) {
    sources.push({
      source: "environment",
      currentContent: async () => {
        const branch = await git(cwd, ["branch", "--show-current"]);
        const status = await git(cwd, ["status", "--short"]);
        return `cwd: ${cwd}\nplatform: ${process.platform}\ngit branch: ${branch || "detached HEAD"}\ngit status:\n${status || "clean"}`;
      },
    });
  }
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  sources.push({ source: "date", currentContent: () => `Current date: ${date}` });
  const userPath = join(homeDir, ".neant/AGENTS.md");
  sources.push({
    source: "user-instructions",
    currentContent: async () => {
      const text = await optionalText(userPath);
      return text === undefined ? undefined : `Project Instructions (${userPath}):\n${text}`;
    },
  });
  sources.push({
    source: "project-instructions",
    currentContent: async () => {
      let path = join(cwd, "AGENTS.md");
      let text = await optionalText(path);
      if (text === undefined) {
        path = join(cwd, "CLAUDE.md");
        text = await optionalText(path);
      }
      return text === undefined ? undefined : `Project Instructions (${path}):\n${text}`;
    },
  });
  sources.push(...options.sources);
  return collectSourceReminders(messages, sources, now);
}

/** Compare only the supplied sources against their latest persisted content. */
export async function collectSourceReminders(
  messages: readonly AgentMessage[],
  sources: readonly ReminderSource[],
  now: Date,
): Promise<SystemReminder[]> {
  const latest = latestReminderContents(messages);
  const reminders: SystemReminder[] = [];
  for (const source of sources) {
    const content = await source.currentContent();
    if (content === undefined || latest.get(source.source) === content) continue;
    reminders.push({
      role: "system-reminder",
      source: source.source,
      content,
      timestamp: now.getTime(),
    });
    latest.set(source.source, content);
  }
  return reminders;
}
