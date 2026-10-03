import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import {
  branchTip,
  insertEntry,
  setValue,
  type Entry,
  type JsonValue,
  type Session,
} from "@earendil-works/pi-agent-core/harness/session";

export { todoSchema, todoState, type TodoItem } from "./todo.ts";

export interface ToolStateDefinition {
  name: string;
  version: number;
  parse(version: number, value: unknown): JsonValue;
}

export function createToolState(
  definitions: readonly ToolStateDefinition[],
  entries: readonly Entry[],
  onWarning: (warning: string) => void,
) {
  const registered = new Map(definitions.map((definition) => [definition.name, definition]));
  const values = new Map<string, JsonValue>();
  for (const entry of entries) {
    if (entry.type !== "custom" || !entry.customType.startsWith("tool-state/")) continue;
    const name = entry.customType.slice("tool-state/".length);
    const definition = registered.get(name);
    if (!definition) continue;
    try {
      const data = entry.data;
      if (
        typeof data !== "object" ||
        data === null ||
        Array.isArray(data) ||
        typeof data.version !== "number"
      )
        throw new Error("Invalid Tool State snapshot.");
      values.set(name, definition.parse(data.version, data.value));
    } catch (error) {
      onWarning(
        `Skipping invalid ${entry.customType} entry ${entry.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    get(name: string): unknown {
      return values.get(name);
    },
    async set(name: string, value: JsonValue, session: Session, context: Context) {
      const definition = registered.get(name);
      if (!definition) throw new Error(`Unknown Tool State: ${name}`);
      const parsed = definition.parse(definition.version, value);
      await session.mutate(async (mutator) => {
        const tip = await mutator.getValue(branchTip("main"), context);
        if (!tip) throw new Error("Session has no main branch.");
        const id = session.idGenerator.next();
        await mutator.commit(
          [
            insertEntry({
              id,
              parentId: tip.value,
              type: "custom",
              customType: `tool-state/${name}`,
              data: { version: definition.version, value: parsed },
            }),
            setValue(branchTip("main"), id),
          ],
          context,
        );
      }, context);
      values.set(name, parsed);
      return parsed;
    },
  };
}
