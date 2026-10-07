import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  type TranscriptContext,
  type Model,
  type Api,
  type SimpleStreamOptions,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";

export type ModelStream = (
  model: Model<Api>,
  context: TranscriptContext,
  request?: SimpleStreamOptions,
) => AssistantMessageEventStream;

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
export function withAuxiliaryRequests(
  primary: ModelStream,
  options: { titles?: ModelStream } = {},
): ModelStream {
  return (model, context, request) => {
    if (!isTitleRequest(context)) return primary(model, context, request);
    if (options.titles) return options.titles(model, context, request);
    const stream = createAssistantMessageEventStream();
    const message = fauxAssistantMessage("Test session");
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    return stream;
  };
}
