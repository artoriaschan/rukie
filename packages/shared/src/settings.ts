import { Type, type Static } from "typebox";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const PERMISSION_MODES = ["ask", "auto-review", "full-access"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

const CustomModel = Type.Object({
  id: Type.String(),
  reasoning: Type.Optional(Type.Boolean()),
  contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
  maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
});

const CustomProvider = Type.Object({
  id: Type.String({ minLength: 1 }),
  api: Type.Enum(["openai-completions", "openai-responses", "anthropic-messages"]),
  baseUrl: Type.String(),
  /** Name of the env var holding the key; settings never contain the key itself. */
  apiKeyEnv: Type.String({ minLength: 1 }),
  models: Type.Array(CustomModel),
});

/** `~/.neant/settings.json` and `<project>/.neant/settings.json`. */
export const SettingsSchema = Type.Object({
  /** `provider/id`. */
  model: Type.Optional(Type.String()),
  reviewModel: Type.Optional(Type.String()),
  permissionMode: Type.Optional(Type.Enum([...PERMISSION_MODES])),
  thinking: Type.Optional(Type.Enum([...THINKING_LEVELS])),
  providers: Type.Optional(Type.Array(CustomProvider)),
  allowTools: Type.Optional(Type.Array(Type.String())),
  trustedProjects: Type.Optional(Type.Array(Type.String())),
});

export type Settings = Static<typeof SettingsSchema>;
