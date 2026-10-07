import {
  createAssistantMessageEventStream,
  createModels,
  type Models,
  type MutableModels,
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

/** Capture the native provider callbacks before wrapping or replacing a test registry. */
export function modelStream(models: Models): ModelStream {
  const providers = new Map(models.getProviders().map((provider) => [provider.id, provider]));
  return (model, context, request) => {
    const provider = providers.get(model.provider);
    if (!provider) throw new Error(`No test provider for ${model.provider}`);
    return provider.streamSimple(model, context, request);
  };
}

/** A held test stream may publish later or deliberately ignore caller cancellation. */
export function deferredModelStream(
  work: Promise<AssistantMessageEventStream>,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  void work
    .then(async (source) => {
      for await (const event of source) stream.push(event);
      stream.end(await source.result());
    })
    .catch((cause: unknown) => {
      const error = fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: cause instanceof Error ? cause.message : String(cause),
      });
      stream.push({ type: "error", reason: "error", error });
      stream.end(error);
    });
  return stream;
}

/** A fresh native registry keeps overrides local to the owning test operation. */
export function withModelStream(models: Models, stream: ModelStream): MutableModels {
  const wrapped = createModels();
  for (const provider of models.getProviders())
    wrapped.setProvider({ ...provider, streamSimple: stream });
  return wrapped;
}

/** Register explicit test-only model names, preserving native provider dispatch. */
export function withModelAlias(
  models: Models,
  providerId: string,
  modelIds: readonly string[],
  options: { contextWindow?: number } = {},
): MutableModels {
  const wrapped = withModelStream(models, modelStream(models));
  const provider = models.getProviders()[0];
  const template = provider?.getModels()[0];
  if (!provider || !template) throw new Error("Expected a fixture provider with a model");
  wrapped.setProvider({
    ...provider,
    id: providerId,
    getAllModels: undefined,
    getModels: () => modelIds.map((id) => ({ ...template, ...options, id, provider: providerId })),
  });
  return wrapped;
}
