import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import type { SessionOptions } from "@rukie/agent";
import {
  createAssistantMessageEventStream,
  createModels,
  envApiKeyAuth,
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  type AssistantMessage,
  type Model,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { isTitleRequest } from "./auxiliary-model.ts";
import type { Provider } from "@earendil-works/pi-ai/models";

/** Model boundary controlled by the test, including streamed text and cancellation. */
export function controlledModel(controlReviews = false, controlTitles = false) {
  const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  const model = faux.getModel();
  const calls: {
    model: Model<string>;
    context: TranscriptContext;
    signal?: AbortSignal;
    reasoning?: string;
    delta(text: string): void;
    thinking(text: string): void;
    toolDelta(text: string): void;
    finish(input?: number, output?: number, cache?: { read: number; write: number }): void;
    reply(text: string): void;
    tool(name: string, args: Parameters<typeof fauxToolCall>[1]): void;
    tools(tools: { name: string; args: Parameters<typeof fauxToolCall>[1] }[]): void;
    fail(message: string): void;
  }[] = [];
  const reviews: typeof calls = [];
  const titles: typeof calls = [];
  const sideQuestions: typeof calls = [];
  const stream: Provider["streamSimple"] = (_model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const isTitle = isTitleRequest(context);
    if (isTitle && !controlTitles) {
      const message = fauxAssistantMessage("Test session");
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    }
    const last = context.messages.at(-1);
    const lastText =
      last?.role === "user"
        ? typeof last.content === "string"
          ? last.content
          : last.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")
        : "";
    const isSideQuestion = !isTitle && lastText.startsWith("<side-question-context>\n");
    const isReview =
      !isSideQuestion &&
      context.messages.some(
        (message) => message.role === "system" && JSON.stringify(message).includes("REVIEW_POLICY"),
      );
    // Most UI tests use immediate review denial; lifecycle tests hold this boundary open.
    if (isReview && !controlReviews) {
      const message = fauxAssistantMessage(
        '{"risk":"medium","decision":"deny","reason":"Test review requires consent"}',
      );
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    }
    const partial = {
      ...fauxAssistantMessage("", { stopReason: "pending" }),
      provider: _model.provider,
      model: _model.id,
      api: _model.api,
    };
    let text = "";
    let thinking = "";
    let toolArguments = "";
    let ended = false;
    const fail = (reason: "aborted" | "error", errorMessage: string) => {
      if (ended) return;
      ended = true;
      options?.signal?.removeEventListener("abort", abort);
      const final = { ...partial, stopReason: reason, errorMessage };
      stream.push({ type: "error", reason, error: final });
      stream.end(final);
    };
    const abort = () => fail("aborted", "Request was aborted");
    options?.signal?.addEventListener("abort", abort, { once: true });
    stream.push({ type: "start", partial });
    const complete = (
      message: AssistantMessage,
      input = 11,
      output = 5,
      cache = { read: 0, write: 0 },
    ) => {
      ended = true;
      options?.signal?.removeEventListener("abort", abort);
      message.provider = _model.provider;
      message.model = _model.id;
      message.api = _model.api;
      message.usage = {
        ...message.usage,
        input,
        output,
        cacheRead: cache.read,
        cacheWrite: cache.write,
        totalTokens: input + output + cache.read + cache.write,
      };
      stream.push({
        type: "done",
        reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
        message,
      });
      stream.end(message);
    };
    const tools = (tools: { name: string; args: Parameters<typeof fauxToolCall>[1] }[]) =>
      complete(
        fauxAssistantMessage(
          [
            ...(thinking ? [{ type: "thinking" as const, thinking }] : []),
            ...tools.map(({ name, args }, index) =>
              fauxToolCall(name, args, { id: `call-${calls.length}-${index}` }),
            ),
          ],
          { stopReason: "toolUse" },
        ),
      );
    (isTitle ? titles : isSideQuestion ? sideQuestions : isReview ? reviews : calls).push({
      model: structuredClone(_model),
      // Match the native SDK boundary while durable Transcript entries retain originals.
      context: structuredClone({
        ...context,
        messages: transformMessages([...context.messages], _model),
      }),
      signal: options?.signal,
      reasoning: options?.reasoning,
      delta(delta) {
        text += delta;
        partial.content = [
          ...(thinking ? [{ type: "thinking" as const, thinking }] : []),
          { type: "text", text },
        ];
        stream.push({ type: "text_delta", contentIndex: thinking ? 1 : 0, delta, partial });
      },
      thinking(delta) {
        thinking += delta;
        partial.content = [
          { type: "thinking", thinking },
          ...(text ? [{ type: "text" as const, text }] : []),
        ];
        stream.push({ type: "thinking_delta", contentIndex: 0, delta, partial });
      },
      toolDelta(delta) {
        toolArguments += delta;
        partial.content = [
          ...(thinking ? [{ type: "thinking" as const, thinking }] : []),
          fauxToolCall("bash", { command: toolArguments }, { id: "partial-tool" }),
        ];
        stream.push({ type: "toolcall_delta", contentIndex: 0, delta, partial });
      },
      reply: (text) => complete(fauxAssistantMessage(text)),
      finish(input = 11, output = 5, cache) {
        complete({ ...partial, stopReason: "stop" }, input, output, cache);
      },
      tool: (name, args) => tools([{ name, args }]),
      tools,
      fail: (message) => fail("error", message),
    });
    if (options?.signal?.aborted) abort();
    return stream;
  };
  const fixtureKeyEnvs = new Set<string>();
  const models = createModels({
    authContext: {
      env: async (name) => (fixtureKeyEnvs.has(name) ? process.env[name] : undefined),
      fileExists: async () => false,
    },
  });
  const provider = { ...faux.provider, streamSimple: stream };
  models.setProvider(provider);
  function configuredModel(settings: NonNullable<SessionOptions["settings"]>) {
    models.deleteProvider(provider.id);
    for (const configured of settings.providers ?? []) {
      fixtureKeyEnvs.add(configured.apiKeyEnv);
      const entries = configured.models.map((limits) => ({
        ...model,
        id: limits.id,
        provider: configured.id,
        name: limits.id,
        input: limits.input ?? ["text" as const],
        api: configured.api,
        baseUrl: configured.baseUrl,
        reasoning: limits.reasoning ?? false,
        contextWindow: limits.contextWindow ?? 128_000,
        maxTokens: limits.maxTokens ?? 16_384,
      }));
      models.setProvider({
        ...provider,
        id: configured.id,
        name: configured.id,
        auth: { apiKey: envApiKeyAuth(`${configured.id} API key`, [configured.apiKeyEnv]) },
        getModels: () => entries,
        getAllModels: () => entries,
        stream: (model, context, options) => stream(model, context, { signal: options?.signal }),
        streamSimple: stream,
      });
    }
    if (!settings.model) return undefined;
    const slash = settings.model.indexOf("/");
    return models.getModel(settings.model.slice(0, slash), settings.model.slice(slash + 1));
  }
  return { model, models, provider, calls, reviews, titles, sideQuestions, configuredModel };
}
