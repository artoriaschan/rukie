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
export function fakeModel(responses: FauxResponseStep[]) {
  const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: Infinity });
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
