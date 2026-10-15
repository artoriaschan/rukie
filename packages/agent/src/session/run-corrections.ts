/** Ephemeral counters: the caller supplies the accepted Run and committed compaction scope. */
export function createRunCorrections() {
  let scope = "";
  let previous = "";
  let repeats = 0;
  let stalled = 0;
  let lengths = 0;
  let limitPublished = false;
  let completed = 0;
  return {
    enter(next: string, completedTodos: number) {
      if (next === scope) return;
      scope = next;
      previous = "";
      repeats = stalled = lengths = 0;
      limitPublished = false;
      completed = completedTodos;
    },
    tool(name: string, args: unknown, succeeded: boolean): string[] {
      const canonical = (value: unknown): string => {
        if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
        if (value && typeof value === "object")
          return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`)
            .join(",")}}`;
        return JSON.stringify(value) ?? "null";
      };
      const preview = canonical(args);
      const key = `${name}:${preview}`;
      repeats = key === previous ? repeats + 1 : 1;
      previous = key;
      let progress =
        succeeded &&
        [
          "write",
          "edit",
          "subagent",
          "subagent_fork",
          "exit_plan_mode",
          "ask_user_question",
        ].includes(name);
      if (
        succeeded &&
        name === "todo_write" &&
        args &&
        typeof args === "object" &&
        "todos" in args &&
        Array.isArray(args.todos)
      ) {
        const count = args.todos.filter(
          (item) =>
            item && typeof item === "object" && "status" in item && item.status === "completed",
        ).length;
        progress = count > completed;
        completed = count;
      }
      stalled = progress ? 0 : stalled + 1;
      const reminders: string[] = [];
      if ([3, 5, 8].includes(repeats))
        reminders.push(
          repeats === 3
            ? "You have repeated the same tool call three times. Check whether it is helping and consider a different approach."
            : `You have called ${name} ${repeats} consecutive times with identical arguments: ${preview.slice(0, 500)}. Stop repeating an ineffective call; diagnose the cause and change approach.`,
        );
      if ([15, 25, 40].includes(stalled))
        reminders.push(
          `There have been ${stalled} consecutive tool calls without a progress event. Reassess the task, identify the blocker, and choose a concrete next step.${stalled === 40 ? " Do not modify files or change Todo merely to reset this count." : ""}`,
        );
      return reminders;
    },
    limit(reached: boolean) {
      if (!reached || limitPublished) return undefined;
      limitPublished = true;
      return "The tool iteration limit has been reached. Stop calling tools and summarize what is complete, what remains incomplete, and how work can continue.";
    },
    length(visible: boolean) {
      if (lengths >= 3) return undefined;
      lengths++;
      return `<system-reminder>\nYour output was truncated by the output limit. Continue from the cutoff without repeating previous output.${visible ? "" : " No visible output was produced. Shorten your reasoning and provide a concise continuation."}\n</system-reminder>`;
    },
  };
}
