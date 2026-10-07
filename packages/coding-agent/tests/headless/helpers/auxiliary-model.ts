import type { Provider } from "@earendil-works/pi-ai/models";
type ModelStream = Provider["streamSimple"];
import {
  createAssistantMessageEventStream,
  createModels,
  fauxProvider,
  type Models,
  fauxAssistantMessage,
  type TranscriptContext,
} from "@earendil-works/pi-ai";

/** Identify this isolated operation by its policy, never by user content or missing tools. */
function isTitleRequest(context: TranscriptContext) {
  const message = context.messages[0];
  const text =
    message?.role === "system"
      ? typeof message.content === "string"
        ? message.content
        : message.content.map((block) => block.text).join("")
      : "";
  return text.startsWith(
    "Create a concise title for an AI coding-assistant session from the supplied human messages.",
  );
}

/** Auxiliary requests must not consume the main conversation's scripted responses. */
export function auxiliaryModels(
  primary: ModelStream,
  options: { titles?: ModelStream } = {},
): Models {
  const streamSimple: ModelStream = (model, context, request) => {
    if (!isTitleRequest(context)) return primary(model, context, request);
    if (options.titles) return options.titles(model, context, request);
    const stream = createAssistantMessageEventStream();
    const message = fauxAssistantMessage("Test session");
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    return stream;
  };
  const models = createModels();
  models.setProvider({
    ...fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: Infinity }).provider,
    streamSimple,
  });
  return models;
}
