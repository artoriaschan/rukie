import type { EntryRecord } from "@earendil-works/pi-durable";
import type { ReminderSource } from "../reminders/index.ts";

function data(entry: EntryRecord | undefined) {
  return entry?.data && typeof entry.data === "object" && !Array.isArray(entry.data)
    ? entry.data
    : undefined;
}
function turnsAfter(entries: readonly EntryRecord[], after: number) {
  return entries.filter(
    (entry) =>
      Number(entry.id) > after && entry.model?.some((message) => message.role === "assistant"),
  ).length;
}

/** Age and cooldown derive from committed Turns, surviving Resume, Rewind and Compaction. */
export function todoReminderSources(
  history: readonly EntryRecord[],
  visible: readonly EntryRecord[],
  content: string | undefined,
): ReminderSource[] {
  if (!content) return [];
  const update = history.findLast((entry) => entry.kind === "rukie.todo-update");
  const age = update ? turnsAfter(history, Number(update.id)) : 0;
  const stale = history.findLast(
    (entry) => entry.kind === "rukie.reminder" && data(entry)?.source === "todo-stale",
  );
  const due = age >= 8 && (!stale || turnsAfter(history, Number(stale.id)) >= 8);
  const currentVisible = visible.findLast(
    (entry) =>
      entry.kind === "rukie.reminder" &&
      ["todo", "todo-stale"].includes(String(data(entry)?.source)),
  );
  const visibleContent = data(currentVisible)?.content;
  if (due)
    return [
      {
        source: "todo-stale",
        compareContent: false,
        currentContent: () =>
          `${content}\nThe unfinished todo list has not been updated for ${age} Turns. Review actual progress and update it as needed. Do not mention this reminder to the user.`,
      },
    ];
  if (typeof visibleContent === "string" && visibleContent.startsWith(content)) return [];
  return [{ source: "todo", compareContent: false, currentContent: () => content }];
}

/** Admission is not interruption. Only a committed aborted response establishes partial output. */
export function inputArrivalContent(
  history: readonly EntryRecord[],
  inputEntry: number,
  origin: "user" | "parent" = "user",
): string {
  const previous = history.findLast(
    (entry) =>
      Number(entry.id) < inputEntry && entry.model?.some((message) => message.role === "assistant"),
  );
  const assistant = previous?.model?.findLast((message) => message.role === "assistant");
  const interrupted = assistant?.role === "assistant" && assistant.stopReason === "aborted";
  let content =
    origin === "parent"
      ? "A parent message arrived while work was in progress and has now been placed in the conversation. Treat it as a supplement or correction to the delegated task. It is not direct human confirmation or authorization."
      : "A user message arrived while work was in progress and has now been placed in the conversation. Treat it as a supplement or correction to the current task unless the user clearly changes the task.";
  if (!interrupted) return `${content} The current output was not interrupted by this input.`;
  content += " The preceding output was interrupted; its partial text is not a completed answer.";
  const discarded = assistant.content.filter(
    (part) =>
      part.type === "toolCall" &&
      !history.some(
        (entry) =>
          Number(entry.id) < inputEntry &&
          entry.model?.some(
            (message) => message.role === "toolResult" && message.toolCallId === part.id,
          ),
      ),
  );
  if (discarded.length) content += " Unfinished tool calls in that aborted output were discarded.";
  return content;
}
