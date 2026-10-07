import { withAuxiliaryRequests } from "./auxiliary-model.ts";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";

/** Model that replies once with `echo: <JSON of the last message content>`. */
export function echoModel() {
  const faux = createFauxCore({ api: "faux", provider: "faux" });
  faux.setResponses([
    (context) => fauxAssistantMessage(`echo: ${JSON.stringify(context.messages.at(-1)?.content)}`),
  ]);
  return { streamFn: withAuxiliaryRequests(faux.streamSimple), model: faux.getModel() };
}
