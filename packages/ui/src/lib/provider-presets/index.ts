/** Hand-maintained Provider Presets, in display order.
 * To add a supplier: (1) add its preset file and append it below, (2) add its
 * shared PROVIDER_ICONS key, (3) map that key in ProviderIcon, and (4) add zh/en
 * preset-name and API-key-link copy in model-service-copy.ts. Record sources and
 * the verification date on every protocol variant; schema tests cover the list.
 */
import { deepseekPreset } from "./deepseek.ts";
export type { ProviderPreset } from "./types.ts";
export const PROVIDER_PRESETS = [deepseekPreset];
