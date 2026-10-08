import type { Context } from "@earendil-works/chord";
import type { Cursor, DocumentRecord, Storage, StoredDocument } from "@earendil-works/pi-durable";
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";

const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const id = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const anchor = Type.Union([id, Type.Null()]);
const strings = Type.Array(Type.String());
const result = object({
  requestId: Type.String(),
  text: Type.String(),
  success: Type.Boolean(),
  durationMs: Type.Number({ minimum: 0 }),
  usage: object({
    input: Type.Number({ minimum: 0 }),
    output: Type.Number({ minimum: 0 }),
    cacheRead: Type.Number({ minimum: 0 }),
    cacheWrite: Type.Number({ minimum: 0 }),
    totalTokens: Type.Number({ minimum: 0 }),
  }),
  error: Type.Optional(Type.String()),
  stopReason: Type.Optional(
    Type.Union([Type.Literal("hook_blocked"), Type.Literal("hook_stopped")]),
  ),
  reason: Type.Optional(Type.String()),
});
const schemas: Readonly<Record<string, TSchema>> = {
  "rukie.hook-continuation": object({ taskId: anchor, count }),
  "rukie.child-facts": object({ title: Type.String(), description: Type.String() }),
  "rukie.requests": object({
    requests: Type.Record(
      Type.String(),
      object({
        submissions: Type.Array(id),
        tasks: Type.Array(id),
        startedAt: count,
        result: Type.Union([result, Type.Null()]),
      }),
    ),
  }),
  "rukie.compact-hook-context": object({ pending: strings, afterEntry: anchor }),
  "rukie.hook-yield": object({ runAnchor: anchor, pending: strings }),
  "rukie.job-stops": object({ pending: Type.Record(Type.String(), Type.String()) }),
  "rukie.plan-takeovers": object({ requests: Type.Record(Type.String(), Type.Literal(true)) }),
  "rukie.hook-stops": object({ requests: Type.Record(Type.String(), Type.String()) }),
  // Input fact payloads are extensible JSON objects; native Storage validates their JSON leaves.
  "rukie.pending-input-facts": object({
    inputs: Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown())),
  }),
  "rukie.child-hook-context": object({
    pending: Type.Array(object({ source: Type.String(), content: Type.String() })),
  }),
};

/** Validate owned persisted versions and contents whenever native Storage materializes them. */
export function validateSessionDocument(document: StoredDocument | undefined): void {
  if (!document) return;
  const schema = schemas[document.record.kind];
  if (schema && document.version !== 1)
    throw new Error(
      `Session document ${document.record.kind} has unsupported version ${document.version}.`,
    );
  if (schema && !Value.Check(schema, document.value))
    throw new Error(`Invalid Session document ${document.record.kind}.`);
}

/** Reject even lazily used Session facts before opening Harness or invoking startup Hooks. */
export async function validateSessionDocuments(storage: Storage, context: Context): Promise<void> {
  const scopes: DocumentRecord["scope"][] = [{ kind: "session" }];
  let conversations: Cursor | undefined;
  do {
    const page = await storage.scanConversations({}, 128, conversations, context);
    scopes.push(
      ...page.items.map((row) => ({ kind: "conversation" as const, conversationId: row.id })),
    );
    conversations = page.next;
  } while (conversations);
  for (const scope of scopes) {
    let cursor: Cursor | undefined;
    do {
      const page = await storage.scanDocuments({ scope, at: "current" }, 128, cursor, context);
      for (const record of page.items)
        if (schemas[record.kind])
          validateSessionDocument(await storage.document(record.id, "current", context));
      cursor = page.next;
    } while (cursor);
  }
}
