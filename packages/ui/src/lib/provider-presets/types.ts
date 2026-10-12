import type { ModelService, ProviderIconKey } from "@rukie/shared";

/** Static creation data; generated Model Services retain no execution reference to a preset. */
export interface ProviderPreset {
  id: ProviderIconKey;
  name: string;
  icon: ProviderIconKey;
  apiKeyUrl: string;
  defaultApi: ModelService["api"];
  variants: Partial<
    Record<ModelService["api"], { baseUrl: string; models: ModelService["models"] }>
  >;
}
