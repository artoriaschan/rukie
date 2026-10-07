import { auxiliaryModels } from "./auxiliary-model.ts";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";

/** Model that replies once with `echo: <JSON of the last message content>`. */
export function echoModel() {
  const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  faux.setResponses([
    (context) => fauxAssistantMessage(`echo: ${JSON.stringify(context.messages.at(-1)?.content)}`),
  ]);
  return { models: auxiliaryModels(faux.provider.streamSimple), model: faux.getModel() };
}
