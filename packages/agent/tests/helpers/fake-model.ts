import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createFauxCore,
  type FauxResponseStep,
  type TranscriptContext,
} from "@earendil-works/pi-ai";

/**
 * Scripted model: replies with `responses` in order and records every context it receives.
 * The only test double for the model side (Seam 1).
 */
export function fakeModel(responses: FauxResponseStep[]) {
  const faux = createFauxCore({ api: "faux", provider: "faux" });
  faux.setResponses(responses);
  const contexts: TranscriptContext[] = [];
  const streamFn: StreamFn = (model, context, options) => {
    contexts.push(context);
    return faux.streamSimple(model, context, options);
  };
  return { streamFn, model: faux.getModel(), contexts };
}
