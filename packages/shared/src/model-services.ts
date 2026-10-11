import { Type, type Static } from "typebox";
import { THINKING_LEVELS, CustomModelSchema } from "./settings.ts";
import { Value } from "typebox/value";

export const MODEL_SERVICE_THINKING_LEVELS = [
  "off",
  "automatic",
  ...THINKING_LEVELS.slice(1),
] as const;

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
          name: Type.Optional(Type.String({ maxLength: 256 })),
          automaticReasoning: Type.Optional(Type.Boolean()),
          enabled: Type.Optional(Type.Boolean()),
          /** Context occupancy percent; omitted uses the existing automatic policy. */
          compressionThreshold: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
          maxToolIterations: Type.Optional(Type.Integer({ minimum: 1 })),
          /** USD per million tokens. Omitted prices preserve the zero-cost custom-model default. */
          inputPrice: Type.Optional(Type.Number({ minimum: 0 })),
          outputPrice: Type.Optional(Type.Number({ minimum: 0 })),
          cacheReadPrice: Type.Optional(Type.Number({ minimum: 0 })),
          cacheWritePrice: Type.Optional(Type.Number({ minimum: 0 })),
          priceSource: Type.Optional(Type.String({ maxLength: 2048 })),
          defaultThinkingLevel: Type.Optional(Type.Enum([...MODEL_SERVICE_THINKING_LEVELS])),
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
export function modelServiceThinkingLevels(
  model: ModelService["models"][number],
): (typeof MODEL_SERVICE_THINKING_LEVELS)[number][] {
  if (!model.reasoning) return ["off"];
  return MODEL_SERVICE_THINKING_LEVELS.filter((level) => {
    if (level === "automatic") return model.automaticReasoning === true;
    const mapped = model.thinkingLevelMap?.[level];
    return mapped !== null && ((level !== "xhigh" && level !== "max") || mapped !== undefined);
  });
}

/** Public price lookup carries model identity only, never credentials or a caller-selected URL. */
export const ModelPriceRequestSchema = Type.Object(
  {
    baseUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
export type ModelPriceRequest = Static<typeof ModelPriceRequestSchema>;
export type ModelPriceResult =
  | {
      status: "found";
      prices: {
        inputPrice: number;
        outputPrice: number;
        cacheReadPrice?: number;
        cacheWritePrice?: number;
      };
      priceSource: string;
    }
  | { status: "unmatched" | "ambiguous" | "unavailable" };

export function parseModelPriceRequest(input: unknown): ModelPriceRequest | undefined {
  return Value.Check(ModelPriceRequestSchema, input) ? input : undefined;
}
