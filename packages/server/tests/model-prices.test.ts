import { expect, test } from "bun:test";
import { lookupModelPrices } from "../src/model-prices";

test("model price lookup converts exact endpoint-qualified USD prices and preserves unknown cache prices", async () => {
  const result = await lookupModelPrices(
    { baseUrl: "https://api.deepseek.com/v1", modelId: "deepseek-chat" },
    async (url, init) => {
      expect(url).toBe(
        "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
      );
      expect(init?.headers).toBeUndefined();
      return Response.json({
        "deepseek-chat": {
          litellm_provider: "deepseek",
          input_cost_per_token: 0.00000028,
          output_cost_per_token: 0.00000042,
          cache_read_input_token_cost: 0.000000028,
          cache_creation_input_token_cost: 0,
        },
      });
    },
  );
  expect(result).toEqual({
    status: "found",
    prices: { inputPrice: 0.28, outputPrice: 0.42, cacheReadPrice: 0.028 },
    priceSource:
      "https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json (deepseek-chat, USD/1M tokens)",
  });
});

test("model price lookup refuses ambiguous endpoints, tiered aliases, missing prices and failed feeds", async () => {
  const fetcher = async () =>
    Response.json({
      "gpt-4o": {
        mode: "chat",
        litellm_provider: "openai",
        input_cost_per_token: 0.0000025,
        output_cost_per_token: 0.00001,
        input_cost_per_token_above_128k_tokens: 0.000005,
      },
    });
  expect(
    await lookupModelPrices({ baseUrl: "https://proxy.example", modelId: "gpt-4o" }, fetcher),
  ).toEqual({ status: "ambiguous" });
  expect(
    await lookupModelPrices({ baseUrl: "https://api.openai.com/v1", modelId: "gpt-4o" }, fetcher),
  ).toEqual({ status: "ambiguous" });
  expect(
    await lookupModelPrices({ baseUrl: "https://api.openai.com/v1", modelId: "missing" }, fetcher),
  ).toEqual({ status: "unmatched" });
  expect(
    await lookupModelPrices(
      { baseUrl: "https://api.openai.com/v1", modelId: "gpt-4o" },
      async () => {
        throw new Error("offline");
      },
    ),
  ).toEqual({ status: "unavailable" });
  expect(
    await lookupModelPrices({ baseUrl: "https://api.openai.com/v1", modelId: "gpt-4o" }, async () =>
      Response.json({
        "gpt-4o": { litellm_provider: "openai", input_cost_per_token: 0, output_cost_per_token: 0 },
      }),
    ),
  ).toEqual({ status: "unmatched" });
});
