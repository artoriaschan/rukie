import type { ModelService } from "@rukie/shared";
import type { ProviderPreset } from "./types.ts";

const flash: ModelService["models"][number] = {
  id: "deepseek-flash",
  name: "DeepSeek V4.1 Flash",
  input: ["text", "image"],
  reasoning: true,
  automaticReasoning: true,
  defaultThinkingLevel: "automatic",
  contextWindow: 1_000_000,
  maxTokens: 384_000,
  thinkingLevelMap: { minimal: null, medium: null, low: "low", high: "high", max: "max" },
  inputPrice: 0.3,
  outputPrice: 1.2,
  cacheReadPrice: 0.006,
  cacheWritePrice: 0,
  priceSource: "https://api-docs.deepseek.com/quick_start/pricing",
};
const pro: ModelService["models"][number] = {
  ...flash,
  id: "deepseek-v4-pro",
  name: "DeepSeek V4 Pro",
  input: ["text"],
  thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" },
  inputPrice: 1.32,
  outputPrice: 3.96,
  cacheReadPrice: 0.044,
};

export const deepseekPreset: ProviderPreset = {
  id: "deepseek",
  name: "DeepSeek",
  icon: "deepseek",
  apiKeyUrl: "https://platform.deepseek.com/api_keys",
  defaultApi: "anthropic-messages",
  variants: {
    // Checked 2026-10-12: https://api-docs.deepseek.com/guides/anthropic_api
    // Model capabilities/peak prices: https://api-docs.deepseek.com/quick_start/pricing
    "anthropic-messages": {
      baseUrl: "https://api.deepseek.com/anthropic",
      models: [flash, pro].map((model) => ({
        ...model,
        thinkingLevelMap: { ...model.thinkingLevelMap, off: null },
        compat: { forceAdaptiveThinking: true, supportsLongCacheRetention: false },
      })),
    },
    // Checked 2026-10-12: pi-ai 1.0.4 providers/data/deepseek.json;
    // peak prices: https://api-docs.deepseek.com/quick_start/pricing
    "openai-completions": {
      baseUrl: "https://api.deepseek.com",
      models: [flash, pro].map((model) => ({
        ...model,
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
          maxTokensField: "max_tokens",
          requiresReasoningContentOnAssistantMessages: true,
          thinkingFormat: "deepseek",
          supportsStrictMode: true,
          ...(model.id === "deepseek-v4-pro" ? { supportsMidConvoSystemMessages: true } : {}),
        },
      })),
    },
    // Checked 2026-10-12: https://api-docs.deepseek.com/guides/responses_api
    // Model capabilities/peak prices: https://api-docs.deepseek.com/quick_start/pricing
    "openai-responses": {
      baseUrl: "https://api.deepseek.com",
      models: [
        {
          ...flash,
          thinkingLevelMap: { ...flash.thinkingLevelMap, off: null },
          compat: {
            supportsDeveloperRole: false,
            supportsLongCacheRetention: false,
            sessionAffinityFormat: "openai-nosession",
          },
        },
      ],
    },
  },
};
