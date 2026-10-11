import { Type, type Static } from "typebox";
import { CustomModelSchema } from "./settings.ts";
import { Value } from "typebox/value";

/** Desktop configuration has no environment-variable authentication. */
export const ModelServiceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    api: Type.Enum(["openai-completions", "openai-responses", "anthropic-messages"]),
    baseUrl: Type.String({ maxLength: 2048 }),
    models: Type.Array(
      Type.Object(
        {
          ...CustomModelSchema.properties,
          id: Type.String({ minLength: 1, maxLength: 256 }),
          enabled: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ModelService = Static<typeof ModelServiceSchema>;
export type ModelServiceSummary = ModelService & { hasCredential: boolean };
export const ModelServiceSaveSchema = Type.Object(
  {
    provider: ModelServiceSchema,
    credential: Type.Union([
      Type.Object({ type: Type.Literal("keep") }, { additionalProperties: false }),
      Type.Object({ type: Type.Literal("delete") }, { additionalProperties: false }),
      Type.Object(
        { type: Type.Literal("replace"), value: Type.String({ minLength: 1, maxLength: 65536 }) },
        { additionalProperties: false },
      ),
    ]),
  },
  { additionalProperties: false },
);
export type ModelServiceSave = Static<typeof ModelServiceSaveSchema>;
export function parseModelServiceSave(input: unknown): ModelServiceSave | undefined {
  return Value.Check(ModelServiceSaveSchema, input) ? input : undefined;
}
