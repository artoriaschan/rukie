import { withAuxiliaryRequests } from "./auxiliary-model.ts";
import {
  createModels,
  fauxProvider,
  type FauxResponseStep,
  type TranscriptContext,
} from "@earendil-works/pi-ai";

/**
 * Scripted model: replies with `responses` in order and records every context it receives.
 * The only test double for the model side (Seam 1).
 */
export function fakeModel(responses: FauxResponseStep[], options: { chunkTokens?: number } = {}) {
  const faux = fauxProvider({
    api: "faux",
    provider: "faux",
    // Native faux zero uses microtasks; Infinity schedules zero-delay timers and stalls virtual clocks.
    tokensPerSecond: 0,
    ...(options.chunkTokens && {
      tokenSize: { min: options.chunkTokens, max: options.chunkTokens },
    }),
  });
  faux.setResponses(responses);
  const contexts: TranscriptContext[] = [];
  const stream = withAuxiliaryRequests((model, context, options) => {
    contexts.push(context);
    return faux.provider.streamSimple(model, context, options);
  });
  const models = createModels();
  models.setProvider({ ...faux.provider, streamSimple: stream });
  return { models, model: faux.getModel(), contexts };
}
