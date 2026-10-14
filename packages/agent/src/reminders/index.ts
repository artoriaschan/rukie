import { userDataDirectory } from "../config/paths.ts";
import type { TranscriptMessage } from "../session/messages.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SystemReminder {
  role: "system-reminder";
  source: string;
  content: string;
  timestamp: number;
}

/** Sources supply content; incremental sources compare their own persisted history. */
export interface ReminderSource {
  source: string;
  currentContent: (history?: readonly string[]) => string | undefined | Promise<string | undefined>;
  /** Incremental sources compare their complete source history themselves. */
  compareContent?: boolean;
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

function latestReminderContents(messages: readonly TranscriptMessage[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "system-reminder") latest.set(message.source, message.content);
  }
  return latest;
}

export async function collectReminders(options: {
  messages: TranscriptMessage[];
  cwd: string;
  additionalDirectories?: readonly string[];
  homeDir: string;
  dataRoot?: string;
  now: Date;
  sources: ReminderSource[];
  /** Environment is a one-time snapshot, never part of compaction reinjection. */
  includeEnvironment?: boolean;
  /** Session Move requires a fresh cwd snapshot even with existing user history. */
  refreshEnvironment?: boolean;
}): Promise<SystemReminder[]> {
  const { messages, cwd, now } = options;
  const latest = latestReminderContents(messages);
  const sources: ReminderSource[] = [];
  const firstRun = !messages.some((message) => message.role === "user");
  if (
    options.includeEnvironment !== false &&
    (options.refreshEnvironment || (firstRun && !latest.has("environment")))
  ) {
    sources.push({
      source: "environment",
      compareContent: !options.refreshEnvironment,
      currentContent: async () => {
        const branch = await git(cwd, ["branch", "--show-current"]);
        const status = await git(cwd, ["status", "--short"]);
        return `git branch: ${branch || "detached HEAD"}\ngit status:\n${status || "clean"}`;
      },
    });
  }
  sources.push({
    source: "time",
    compareContent: false,
    currentContent: () => timeContent(messages, now),
  });
  const userPath = join(
    userDataDirectory(options),
    ...(options.dataRoot === undefined ? [] : ["rules"]),
    "AGENTS.md",
  );
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
  for (const directory of options.additionalDirectories ?? []) {
    const path = join(directory, "AGENTS.md");
    sources.push({
      source: `project-instructions:${directory}`,
      currentContent: async () => {
        const text = await optionalText(path);
        return text === undefined ? undefined : `Project Instructions (${path}):\n${text}`;
      },
    });
  }
  sources.push(...options.sources);
  return collectSourceReminders(messages, sources, now);
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeContent(messages: readonly TranscriptMessage[], now: Date): string | undefined {
  const zone = Intl.DateTimeFormat("en-US").resolvedOptions().timeZone;
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now);
  const clock = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  const offset = -now.getTimezoneOffset();
  const absolute = Math.abs(offset);
  const current = `${localDate(now)} ${weekday} ${clock} (system time zone ${zone}, UTC${offset >= 0 ? "+" : "-"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")})`;
  const previous = messages.findLast((m) => m.role === "system-reminder" && m.source === "time");
  if (!previous) return `Current time: ${current}. This snapshot does not update automatically.`;
  const activity = messages.findLast(
    (m) =>
      m.role === "user" ||
      m.role === "assistant" ||
      m.role === "toolResult" ||
      (m.role === "system-reminder" && m.source === "time"),
  );
  const idle = now.getTime() - (activity?.timestamp ?? previous.timestamp);
  const crossedDay = localDate(new Date(previous.timestamp)) !== localDate(now);
  if (idle < 2 * 60 * 60 * 1000 && !crossedDay) return undefined;
  const elapsed =
    idle >= 2 * 60 * 60 * 1000 ? `Conversation idle for ${Math.floor(idle / 1000)} seconds. ` : "";
  return `${elapsed}Current time: ${current}.${crossedDay ? " Do not mention the date change to the user." : ""}`;
}

/** Compare only the supplied sources against their latest persisted content. */
async function collectSourceReminders(
  messages: readonly TranscriptMessage[],
  sources: readonly ReminderSource[],
  now: Date,
): Promise<SystemReminder[]> {
  const latest = latestReminderContents(messages);
  const reminders: SystemReminder[] = [];
  for (const source of sources) {
    const history = messages.flatMap((message) =>
      message.role === "system-reminder" && message.source === source.source
        ? [message.content]
        : [],
    );
    const content = await source.currentContent(history);
    if (
      content === undefined ||
      (source.compareContent !== false && latest.get(source.source) === content)
    )
      continue;
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
