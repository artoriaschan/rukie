import type { ModelPriceRequest, ModelPriceResult } from "@rukie/shared";

const priceMapUrl =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const officialProviders: Record<string, string> = {
  "api.openai.com": "openai",
  "api.anthropic.com": "anthropic",
  "api.deepseek.com": "deepseek",
  "api.mistral.ai": "mistral",
  "api.groq.com": "groq",
  "api.x.ai": "xai",
  "openrouter.ai": "openrouter",
  "generativelanguage.googleapis.com": "gemini",
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const price = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && Number.isFinite(value * 1e6)
    ? Number((value * 1e6).toPrecision(12))
    : undefined;

/** Fixed public feed; identity matching never sends credentials or fetches the supplied endpoint. */
export async function lookupModelPrices(
  input: ModelPriceRequest,
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<ModelPriceResult> {
  let provider: string | undefined;
  try {
    const url = new URL(input.baseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return { status: "unmatched" };
    provider = officialProviders[url.hostname];
  } catch {
    return { status: "unmatched" };
  }
  if (!provider) return { status: "ambiguous" };
  try {
    const response = await fetcher(priceMapUrl, {
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!response.ok || !response.body) return { status: "unavailable" };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 8 * 1024 * 1024) {
          await reader.cancel();
          return { status: "unavailable" };
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!record(data)) return { status: "unavailable" };
    const candidates: {
      key: string;
      prices: Extract<ModelPriceResult, { status: "found" }>["prices"];
    }[] = [];
    for (const key of new Set([input.modelId, `${provider}/${input.modelId}`])) {
      const entry = data[key];
      if (
        !record(entry) ||
        entry.litellm_provider !== provider ||
        (entry.mode !== undefined && entry.mode !== "chat")
      )
        continue;
      if (
        entry.tiered_pricing !== undefined ||
        Object.keys(entry).some(
          (field) => /(?:above|over|up_to|tier)/.test(field) && field.includes("cost"),
        )
      )
        return { status: "ambiguous" };
      const inputPrice = price(entry.input_cost_per_token),
        outputPrice = price(entry.output_cost_per_token);
      if (inputPrice === undefined || outputPrice === undefined) continue;
      const cacheReadPrice = price(entry.cache_read_input_token_cost),
        cacheWritePrice = price(entry.cache_creation_input_token_cost);
      candidates.push({
        key,
        prices: {
          inputPrice,
          outputPrice,
          ...(cacheReadPrice !== undefined ? { cacheReadPrice } : {}),
          ...(cacheWritePrice !== undefined ? { cacheWritePrice } : {}),
        },
      });
    }
    if (!candidates.length) return { status: "unmatched" };
    if (
      candidates.some(
        (candidate) => JSON.stringify(candidate.prices) !== JSON.stringify(candidates[0]!.prices),
      )
    )
      return { status: "ambiguous" };
    const candidate = candidates[0]!;
    return {
      status: "found",
      prices: candidate.prices,
      priceSource: `https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json (${candidate.key}, USD/1M tokens)`,
    };
  } catch {
    return { status: "unavailable" };
  }
}
