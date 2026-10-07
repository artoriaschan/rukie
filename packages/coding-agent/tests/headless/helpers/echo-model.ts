import { auxiliaryModels } from "./auxiliary-model.ts";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";

/** Model that replies once with `echo: <JSON of the last message content>`. */
export function echoModel() {
  const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  faux.setResponses([
    (context) => {
      const prompt = context.messages.findLast((message) => {
        if (message.role !== "user") return false;
        const text =
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("");
        return !text.startsWith("<system-reminder>");
      });
      return fauxAssistantMessage(`echo: ${JSON.stringify(prompt?.content)}`);
    },
  ]);
  return { models: auxiliaryModels(faux.provider.streamSimple), model: faux.getModel() };
}
