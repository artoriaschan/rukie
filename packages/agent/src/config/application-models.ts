import { createModels, createProvider, type MutableModels } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import type { ModelService } from "@rukie/shared";
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
          api: apis[provider.api](),
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
              name: model.id,
              api: provider.api,
              provider: provider.id,
              baseUrl: provider.baseUrl,
              input: model.input ?? ["text"],
              reasoning: model.reasoning ?? false,
              contextWindow: model.contextWindow ?? 128_000,
              maxTokens: model.maxTokens ?? 16_384,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
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
