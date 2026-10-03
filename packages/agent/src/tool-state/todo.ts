import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { ToolStateDefinition } from "./index.ts";

export const todoSchema = Type.Array(
  Type.Object(
    {
      content: Type.String(),
      status: Type.Union([
        Type.Literal("pending"),
        Type.Literal("in_progress"),
        Type.Literal("completed"),
      ]),
    },
    { additionalProperties: false },
  ),
);
export type TodoItem = Static<typeof todoSchema>[number];

export const todoState: ToolStateDefinition = {
  name: "todo",
  version: 1,
  parse(version, value) {
    if (version !== 1) throw new Error(`Unsupported todo version: ${version}`);
    if (!Value.Check(todoSchema, value)) throw new Error("Invalid todo list schema.");
    return value;
  },
  renderReminder(value) {
    if (!Value.Check(todoSchema, value) || !value.some((item) => item.status !== "completed"))
      return undefined;
    const markers = { pending: "○", in_progress: "●", completed: "✓" };
    return `Current todo list:\n${value.map((item) => `${markers[item.status]} ${item.content}`).join("\n")}\nUpdate the todo list as needed.`;
  },
};
