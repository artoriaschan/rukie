import {
  createModels,
  createProvider,
  type MutableModels,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import type { ModelService } from "@rukie/shared";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { withToolCapabilityDetection, type ToolCapabilityStore } from "./tool-capabilities.ts";

/** Builds only explicitly configured application providers. Auth never reads terminal env or user files. */
export function createApplicationModels(options: {
  providers: ModelService[];
  hasCredential(id: string): Promise<boolean>;
  credential(id: string): Promise<string | undefined>;
  capabilityStore: ToolCapabilityStore;
  homeDir: string;
  onWarning?: (message: string) => void;
}): MutableModels {
  const models = createModels({
    authContext: { env: async () => undefined, fileExists: async () => false },
  });
  const apis = {
    "openai-completions": openAICompletionsApi,
    "openai-responses": openAIResponsesApi,
    "anthropic-messages": anthropicMessagesApi,
  };
  for (const provider of options.providers) {
    models.setProvider(
      withToolCapabilityDetection(
        createProvider({
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          api: (() => {
            const api = apis[provider.api]();
            const temperature = (id: string) =>
              provider.models.find((item) => item.id === id)?.temperature;
            const streams: ProviderStreams = {
              ...api,
              stream: (model, context, options) =>
                api.stream(model, context, {
                  ...options,
                  temperature: options?.temperature ?? temperature(model.id),
                }),
              streamSimple: (model, context, options) =>
                api.streamSimple(model, context, {
                  ...options,
                  temperature: options?.temperature ?? temperature(model.id),
                }),
            };
            return streams;
          })(),
          auth: {
            apiKey: {
              name: "Desktop encrypted credential",
              async check({ signal }) {
                signal.throwIfAborted();
                return (await options.hasCredential(provider.id))
                  ? { type: "api_key", source: "Desktop credential" }
                  : undefined;
              },
              async resolve({ signal }) {
                signal.throwIfAborted();
                const key = await options.credential(provider.id);
                signal.throwIfAborted();
                return key ? { auth: { apiKey: key }, source: "Desktop credential" } : undefined;
              },
            },
          },
          models: provider.models
            .filter((model) => model.enabled !== false)
            .map((model) => ({
              ...model,
              name: model.name ?? "",
              api: provider.api,
              provider: provider.id,
              baseUrl: provider.baseUrl,
              input: model.input ?? ["text"],
              reasoning: model.reasoning ?? false,
              contextWindow: model.contextWindow ?? 128_000,
              maxTokens: model.maxTokens ?? 16_384,
              cost: {
                input: model.inputPrice ?? 0,
                output: model.outputPrice ?? 0,
                cacheRead: model.cacheReadPrice ?? 0,
                cacheWrite: model.cacheWritePrice ?? 0,
              },
            })),
        }),
        options.homeDir,
        options.onWarning ?? (() => {}),
        { capabilityStore: options.capabilityStore },
      ),
    );
  }
  return models;
}

/** Static, non-sensitive metadata only; never checks or resolves built-in authentication. */
export function applicationModelTemplates(): ModelService[] {
  const catalog = builtinModels();
  const apis = ["anthropic-messages", "openai-completions", "openai-responses"] as const;
  return catalog.getProviders().flatMap((provider) =>
    apis.flatMap((api) => {
      const entries = catalog.getModels(provider.id).filter((model) => model.api === api);
      if (!entries.length) return [];
      return [
        {
          id: `${provider.id}-${api}`,
          name: provider.name ?? provider.id,
          api,
          baseUrl: entries[0]!.baseUrl,
          models: entries.map((model) => ({
            id: model.id,
            name: model.name,
            input: model.input,
            reasoning: model.reasoning,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            thinkingLevelMap: model.thinkingLevelMap,
            compat: model.compat,
          })),
        },
      ];
    }),
  );
}
