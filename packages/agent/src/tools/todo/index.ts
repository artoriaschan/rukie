import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { todoSchema, type TodoItem } from "./state.ts";

export { todoState, type TodoItem } from "./state.ts";

const parameters = Type.Object({ todos: todoSchema });

export function createTodoTool(
  setTodo: (todos: TodoItem[]) => Promise<void>,
): AgentTool<typeof parameters> {
  return {
    name: "todo_write",
    label: "Update todo list",
    // Source: deepseek-harness packages/todo/tool-todo, parallel description.
    description:
      "Record and update a task list to plan multi-step work and show progress; skip it for trivial single-step tasks. Add one todo per concrete step before you start. While work remains, keep the todos being worked on `in_progress`, several only when work runs in parallel. Mark each todo `completed` as soon as it is done.",
    parameters,
    async execute(_id, { todos }) {
      const normalized = todos.map(({ content, status }) => ({ content: content.trim(), status }));
      const seen = new Set<string>();
      for (const { content } of normalized) {
        if (!content) throw new Error("Invalid todo: content must be a non-empty string.");
        if (seen.has(content))
          throw new Error(`Invalid todos: duplicate content ${JSON.stringify(content)}.`);
        seen.add(content);
      }
      await setTodo(normalized);
      const count = (status: TodoItem["status"]) =>
        normalized.filter((todo) => todo.status === status).length;
      return {
        content: [
          {
            type: "text",
            text: `Updated todo list: ${count("pending")} pending, ${count("in_progress")} in progress, ${count("completed")} completed.`,
          },
        ],
        details: {},
      };
    },
  };
}
