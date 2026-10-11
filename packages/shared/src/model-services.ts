import { Type, type Static } from "typebox";
import { THINKING_LEVELS, type ThinkingLevel, CustomModelSchema } from "./settings.ts";
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
          defaultThinkingLevel: Type.Optional(Type.Enum([...THINKING_LEVELS])),
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
  return Value.Check(ModelServiceSaveSchema, input) &&
    input.provider.models.every(
      (model) =>
        model.defaultThinkingLevel === undefined ||
        modelServiceThinkingLevels(model).includes(model.defaultThinkingLevel),
    )
    ? input
    : undefined;
}

/** Desktop model editing follows pi-ai's base and opt-in extended level contract. */
export function modelServiceThinkingLevels(model: ModelService["models"][number]): ThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  return THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    return mapped !== null && ((level !== "xhigh" && level !== "max") || mapped !== undefined);
  });
}
