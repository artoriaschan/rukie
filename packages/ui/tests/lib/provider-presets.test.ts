import { expect, test } from "vitest";
import { Value } from "typebox/value";
import {
  ModelServiceSchema,
  ModelCompatSchemas,
  PROVIDER_ICONS,
  modelServiceThinkingLevels,
  type ModelService,
} from "@rukie/shared";
import { modelServiceCopy } from "../../src/lib/model-service-copy.ts";
import { PROVIDER_PRESETS } from "../../src/lib/provider-presets/index.ts";

test("DeepSeek presets produce valid services with supported protocol reasoning levels", () => {
  expect(PROVIDER_PRESETS.map((preset) => preset.id)).toEqual(["deepseek"]);
  for (const preset of PROVIDER_PRESETS) {
    expect(PROVIDER_ICONS).toContain(preset.icon);
    for (const locale of ["zh", "en"] as const) {
      expect(modelServiceCopy[locale][`services.presets.${preset.id}`]).toBe(preset.name);
      expect(modelServiceCopy[locale]["services.getApiKey"]).toBeTruthy();
    }
    expect(preset.variants[preset.defaultApi]).toBeDefined();
    expect(preset.defaultApi).toBe("anthropic-messages");
    expect(preset.apiKeyUrl).toBe("https://platform.deepseek.com/api_keys");
    expect(Object.keys(preset.variants)).toEqual([
      "anthropic-messages",
      "openai-completions",
      "openai-responses",
    ]);
    for (const [api, variant] of Object.entries(preset.variants)) {
      expect(variant.baseUrl).toBe(
        api === "anthropic-messages"
          ? "https://api.deepseek.com/anthropic"
          : "https://api.deepseek.com",
      );
      const service = { id: preset.id, name: preset.name, icon: preset.icon, api, ...variant };
      expect(Value.Check(ModelServiceSchema, service)).toBe(true);
      expect(new Set(variant.models.map((model) => model.id)).size).toBe(variant.models.length);
      expect(variant.models.map((model) => model.id)).toEqual(
        api === "openai-responses" ? ["deepseek-flash"] : ["deepseek-flash", "deepseek-v4-pro"],
      );
      for (const model of variant.models) {
        expect(Value.Check(ModelCompatSchemas[api as ModelService["api"]], model.compat)).toBe(
          true,
        );
        expect(model.compat).toEqual(
          api === "anthropic-messages"
            ? { forceAdaptiveThinking: true, supportsLongCacheRetention: false }
            : api === "openai-responses"
              ? {
                  supportsDeveloperRole: false,
                  supportsLongCacheRetention: false,
                  sessionAffinityFormat: "openai-nosession",
                }
              : {
                  supportsStore: false,
                  supportsDeveloperRole: false,
                  supportsReasoningEffort: true,
                  maxTokensField: "max_tokens",
                  requiresReasoningContentOnAssistantMessages: true,
                  thinkingFormat: "deepseek",
                  supportsStrictMode: true,
                  ...(model.id === "deepseek-v4-pro"
                    ? { supportsMidConvoSystemMessages: true }
                    : {}),
                },
        );
        const levels =
          model.id === "deepseek-flash"
            ? ["automatic", "low", "high", "max"]
            : ["automatic", "high", "max"];
        expect(modelServiceThinkingLevels(model)).toEqual(
          api === "openai-completions" ? ["off", ...levels] : levels,
        );
        expect(model).toMatchObject({
          reasoning: true,
          automaticReasoning: true,
          defaultThinkingLevel: "automatic",
          contextWindow: 1000000,
          maxTokens: 384000,
          cacheWritePrice: 0,
          priceSource: "https://api-docs.deepseek.com/quick_start/pricing",
        });
        expect(model).toMatchObject(
          model.id === "deepseek-flash"
            ? {
                name: "DeepSeek V4.1 Flash",
                input: ["text", "image"],
                inputPrice: 0.3,
                outputPrice: 1.2,
                cacheReadPrice: 0.006,
              }
            : {
                name: "DeepSeek V4 Pro",
                input: ["text"],
                inputPrice: 1.32,
                outputPrice: 3.96,
                cacheReadPrice: 0.044,
              },
        );
      }
    }
  }
});
