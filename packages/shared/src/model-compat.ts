import { Type } from "typebox";

const affinity = Type.Enum(["openai", "openai-nosession", "openrouter"]);
const strings = Type.Array(Type.String());
const percentile = Type.Union([
  Type.Number(),
  Type.Object(
    {
      p50: Type.Optional(Type.Number()),
      p75: Type.Optional(Type.Number()),
      p90: Type.Optional(Type.Number()),
      p99: Type.Optional(Type.Number()),
    },
    { additionalProperties: false },
  ),
]);
const price = Type.Union([Type.Number(), Type.String()]);
const routing = Type.Object(
  {
    allow_fallbacks: Type.Optional(Type.Boolean()),
    require_parameters: Type.Optional(Type.Boolean()),
    data_collection: Type.Optional(Type.Enum(["deny", "allow"])),
    zdr: Type.Optional(Type.Boolean()),
    enforce_distillable_text: Type.Optional(Type.Boolean()),
    order: Type.Optional(strings),
    only: Type.Optional(strings),
    ignore: Type.Optional(strings),
    quantizations: Type.Optional(strings),
    sort: Type.Optional(
      Type.Union([
        Type.String(),
        Type.Object(
          {
            by: Type.Optional(Type.String()),
            partition: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          },
          { additionalProperties: false },
        ),
      ]),
    ),
    max_price: Type.Optional(
      Type.Object(
        {
          prompt: Type.Optional(price),
          completion: Type.Optional(price),
          image: Type.Optional(price),
          audio: Type.Optional(price),
          request: Type.Optional(price),
        },
        { additionalProperties: false },
      ),
    ),
    preferred_min_throughput: Type.Optional(percentile),
    preferred_max_latency: Type.Optional(percentile),
  },
  { additionalProperties: false },
);
const template = Type.Record(
  Type.String(),
  Type.Union([
    Type.String(),
    Type.Number(),
    Type.Boolean(),
    Type.Null(),
    Type.Object(
      {
        $var: Type.Enum(["thinking.enabled", "thinking.effort", "thinking.budget"]),
        omitWhenOff: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
  ]),
);
const rates = {
  input: Type.Number(),
  output: Type.Number(),
  cacheRead: Type.Number(),
  cacheWrite: Type.Number(),
};
const fallbacks = Type.Array(
  Type.Object(
    {
      provider: Type.String(),
      model: Type.String(),
      cost: Type.Object(
        {
          ...rates,
          tiers: Type.Optional(
            Type.Array(
              Type.Object(
                { ...rates, inputTokensAbove: Type.Number() },
                { additionalProperties: false },
              ),
            ),
          ),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
);

/** Validated per-API overrides for the locked pi-ai model compatibility fields. */
export const ModelCompatSchemas = {
  "openai-completions": Type.Object(
    {
      supportsStore: Type.Optional(Type.Boolean()),
      supportsDeveloperRole: Type.Optional(Type.Boolean()),
      supportsReasoningEffort: Type.Optional(Type.Boolean()),
      supportsUsageInStreaming: Type.Optional(Type.Boolean()),
      supportsFinishReason: Type.Optional(Type.Boolean()),
      maxTokensField: Type.Optional(Type.Enum(["max_completion_tokens", "max_tokens"])),
      requiresToolResultName: Type.Optional(Type.Boolean()),
      requiresAssistantAfterToolResult: Type.Optional(Type.Boolean()),
      requiresThinkingAsText: Type.Optional(Type.Boolean()),
      requiresReasoningContentOnAssistantMessages: Type.Optional(Type.Boolean()),
      thinkingFormat: Type.Optional(
        Type.Enum([
          "openai",
          "openrouter",
          "deepseek",
          "together",
          "baseten",
          "zai",
          "qwen",
          "chat-template",
          "qwen-chat-template",
          "string-thinking",
          "ant-ling",
        ]),
      ),
      chatTemplateKwargs: Type.Optional(template),
      chatTemplateArgs: Type.Optional(template),
      openRouterRouting: Type.Optional(routing),
      vercelGatewayRouting: Type.Optional(
        Type.Object(
          { only: Type.Optional(strings), order: Type.Optional(strings) },
          { additionalProperties: false },
        ),
      ),
      zaiToolStream: Type.Optional(Type.Boolean()),
      thinkingTokenBudgetField: Type.Optional(
        Type.Enum(["thinking_token_budget", "thinking_budget", "thinking_budget_tokens"]),
      ),
      supportsThinkingTokenBudget: Type.Optional(Type.Boolean()),
      supportsOpenAIGrammarTools: Type.Optional(Type.Boolean()),
      supportsMidConvoSystemMessages: Type.Optional(Type.Boolean()),
      supportsMidConvoToolAdditions: Type.Optional(Type.Boolean()),
      supportsStrictMode: Type.Optional(Type.Boolean()),
      cacheControlFormat: Type.Optional(Type.Enum(["anthropic"])),
      sendSessionAffinityHeaders: Type.Optional(Type.Boolean()),
      sessionAffinityFormat: Type.Optional(affinity),
      supportsLongCacheRetention: Type.Optional(Type.Boolean()),
      vllmPriority: Type.Optional(Type.Number()),
    },
    { additionalProperties: false },
  ),
  "openai-responses": Type.Object(
    {
      supportsDeveloperRole: Type.Optional(Type.Boolean()),
      supportsMidConvoSystemMessages: Type.Optional(Type.Boolean()),
      sessionAffinityFormat: Type.Optional(affinity),
      supportsLongCacheRetention: Type.Optional(Type.Boolean()),
      supportsStrictMode: Type.Optional(Type.Boolean()),
      supportsOpenAIGrammarTools: Type.Optional(Type.Boolean()),
      supportsAdditionalTools: Type.Optional(Type.Boolean()),
      supportsToolSearch: Type.Optional(Type.Boolean()),
      supportsExplicitPromptCacheMode: Type.Optional(Type.Boolean()),
      supportsMaxOutputTokens: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  "anthropic-messages": Type.Object(
    {
      supportsEagerToolInputStreaming: Type.Optional(Type.Boolean()),
      supportsLongCacheRetention: Type.Optional(Type.Boolean()),
      sendSessionAffinityHeaders: Type.Optional(Type.Boolean()),
      sessionAffinityFormat: Type.Optional(Type.Enum(["openrouter"])),
      supportsCacheControlOnTools: Type.Optional(Type.Boolean()),
      supportsTemperature: Type.Optional(Type.Boolean()),
      forceAdaptiveThinking: Type.Optional(Type.Boolean()),
      allowEmptySignature: Type.Optional(Type.Boolean()),
      supportsStrictTools: Type.Optional(Type.Boolean()),
      supportsMidConvoEffort: Type.Optional(Type.Boolean()),
      supportsMidConvoSystemMessages: Type.Optional(Type.Boolean()),
      supportsMidConvoToolChanges: Type.Optional(Type.Boolean()),
      allowedFallbackModels: Type.Optional(fallbacks),
    },
    { additionalProperties: false },
  ),
} as const;

export const ModelCompatSchema = Type.Union([
  ModelCompatSchemas["openai-completions"],
  ModelCompatSchemas["openai-responses"],
  ModelCompatSchemas["anthropic-messages"],
]);
