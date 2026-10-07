import { Type, type Static } from "typebox";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const PERMISSION_MODES = ["ask", "auto-review", "full-access"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const HOOK_EVENTS = [
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit",
  "SessionStart",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "SessionEnd",
  "Notification",
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

const hookCommon = {
  if: Type.Optional(Type.String()),
  timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  statusMessage: Type.Optional(Type.String()),
};
const HookHandlerSchema = Type.Union([
  Type.Object(
    {
      ...hookCommon,
      type: Type.Literal("command"),
      command: Type.String({ minLength: 1 }),
      args: Type.Optional(Type.Array(Type.String())),
      async: Type.Optional(Type.Boolean()),
      asyncRewake: Type.Optional(Type.Boolean()),
      shell: Type.Optional(Type.Literal("bash")),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...hookCommon,
      type: Type.Literal("http"),
      url: Type.String({ minLength: 1 }),
      headers: Type.Optional(Type.Record(Type.String(), Type.String())),
      allowedEnvVars: Type.Optional(Type.Array(Type.String())),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...hookCommon,
      type: Type.Literal("mcp_tool"),
      server: Type.String({ minLength: 1 }),
      tool: Type.String({ minLength: 1 }),
      input: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...hookCommon,
      type: Type.Literal("prompt"),
      prompt: Type.String(),
      model: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...hookCommon,
      type: Type.Literal("agent"),
      prompt: Type.String(),
      model: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
]);
export type HookHandler = Static<typeof HookHandlerSchema>;
export const HooksSchema = Type.Object(
  Object.fromEntries(
    HOOK_EVENTS.map((event) => [
      event,
      Type.Optional(
        Type.Array(
          Type.Object(
            { matcher: Type.Optional(Type.String()), hooks: Type.Array(HookHandlerSchema) },
            { additionalProperties: false },
          ),
        ),
      ),
    ]),
  ),
  { additionalProperties: false },
);
export type HooksSettings = Partial<
  Record<HookEvent, { matcher?: string; hooks: HookHandler[] }[]>
>;

const CustomModel = Type.Object({
  id: Type.String(),
  /** Accepted modalities; omitted input means text only. Text must always be included. */
  input: Type.Optional(
    Type.Array(Type.Enum(["text", "image"]), { minItems: 1, contains: Type.Literal("text") }),
  ),
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

/** `~/.rukie/settings.json` and `<project>/.rukie/settings.json`. */
export const SettingsSchema = Type.Object({
  hooks: Type.Optional(HooksSchema),
  /** `provider/id`. */
  model: Type.Optional(Type.String()),
  reviewModel: Type.Optional(Type.String()),
  titleModel: Type.Optional(Type.String()),
  subagentModel: Type.Optional(Type.String()),
  /** Frontend language preference; unsupported tags fall through to environment candidates. */
  locale: Type.Optional(Type.String()),
  permissionMode: Type.Optional(Type.Enum([...PERMISSION_MODES])),
  /** Collapse multiline terminal tool titles to the first source line; defaults to true. */
  foldTerminalCommand: Type.Optional(Type.Boolean()),
  thinking: Type.Optional(Type.Enum([...THINKING_LEVELS])),
  /** Frontend diff presentation; omitted means auto. */
  diffLayout: Type.Optional(Type.Enum(["auto", "unified", "split"])),
  providers: Type.Optional(Type.Array(CustomProvider)),
  permissions: Type.Optional(
    Type.Object({
      allow: Type.Optional(Type.Array(Type.String())),
      ask: Type.Optional(Type.Array(Type.String())),
      deny: Type.Optional(Type.Array(Type.String())),
    }),
  ),
  trustedProjects: Type.Optional(Type.Array(Type.String())),
});

export type Settings = Omit<Static<typeof SettingsSchema>, "hooks"> & { hooks?: HooksSettings };
