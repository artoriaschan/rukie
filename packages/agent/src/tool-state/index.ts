import {
  defineDoc,
  type Conversation,
  type Harness,
  type ConversationDocToken,
  type EntryDraft,
  type CommitPublication,
} from "@earendil-works/pi-durable";
import type { Context, JsonValue } from "@earendil-works/chord";
import type { ReminderSource } from "../reminders/index.ts";

export interface ToolStateDefinition {
  name: string;
  version: number;
  document: ConversationDocToken<{ value: JsonValue }>;
  parse(version: number, value: unknown): JsonValue;
  renderReminder?(value: JsonValue): string | undefined;
}

/** Owners choose copy/history semantics; the registry only coordinates committed reads and writes. */
export function defineToolState(
  definition: Omit<ToolStateDefinition, "document"> & {
    history: "latest" | "rewindable";
    fork: "current" | "asOf" | "initial";
  },
): ToolStateDefinition {
  const { history, fork, ...owner } = definition;
  const common = {
    kind: `rukie.${definition.name}`,
    version: definition.version,
    scope: "conversation" as const,
    initial: () => ({ value: null as JsonValue }),
  };
  const document =
    history === "rewindable"
      ? defineDoc({ ...common, history, fork })
      : defineDoc({ ...common, history, fork: fork === "current" ? "current" : "initial" });
  return { ...owner, document };
}

export async function createToolState(
  definitions: readonly ToolStateDefinition[],
  harness: Harness,
  conversation: Conversation,
  context: Context,
) {
  const registered = new Map(definitions.map((definition) => [definition.name, definition]));
  const values = new Map<string, JsonValue>();
  async function refresh() {
    const next = new Map<string, JsonValue>();
    for (const definition of definitions) {
      const snapshot = await harness.snapshot(definition.document, conversation.id, context);
      if (snapshot && snapshot.value !== null)
        next.set(definition.name, definition.parse(definition.version, snapshot.value));
    }
    values.clear();
    for (const [name, value] of next) values.set(name, value);
  }
  await refresh();
  return {
    refresh,
    snapshot() {
      return Object.fromEntries([...values].map(([name, value]) => [name, structuredClone(value)]));
    },
    adopt(publication: CommitPublication) {
      const changed: { name: string; value: unknown }[] = [];
      for (const change of publication.changes) {
        if (change.type !== "document" || change.conversationId !== conversation.id) continue;
        const definition = definitions.find(
          (definition) => definition.document.definition.kind === change.record.kind,
        );
        if (!definition) continue;
        const raw = change.value?.value;
        if (raw === undefined || raw === null) values.delete(definition.name);
        else
          values.set(definition.name, definition.parse(change.version ?? definition.version, raw));
        changed.push({ name: definition.name, value: values.get(definition.name) });
      }
      return changed;
    },
    reminderSources: definitions.flatMap((definition): ReminderSource[] =>
      definition.renderReminder
        ? [
            {
              source: definition.name,
              currentContent: () => {
                const value = values.get(definition.name);
                return value === undefined ? undefined : definition.renderReminder!(value);
              },
            },
          ]
        : [],
    ),
    get(name: string): unknown {
      const value = values.get(name);
      return value === undefined ? undefined : structuredClone(value);
    },
    async set(name: string, value: JsonValue, context: Context, reminder?: EntryDraft) {
      const definition = registered.get(name);
      if (!definition) throw new Error(`Unknown Tool State: ${name}`);
      const parsed = definition.parse(definition.version, value);
      await conversation.commit(async (tx) => {
        (await tx.doc(definition.document, conversation.id)).value = parsed;
        if (reminder) await tx.appendEntry(conversation.id, reminder);
      }, context);
      if (parsed === null) values.delete(name);
      else values.set(name, structuredClone(parsed));
      return parsed;
    },
  };
}
