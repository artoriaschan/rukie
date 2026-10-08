import {
  createModels,
  fauxProvider,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  type TranscriptContext,
  type SimpleStreamOptions,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/chord";
import { awaitWithContext } from "@earendil-works/chord/context";
import { withAuxiliaryRequests } from "./auxiliary-model.ts";

export function recordedNativeModel() {
  const provider = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  let changed = Promise.withResolvers<void>();
  const publish = () => {
    const prior = changed;
    changed = Promise.withResolvers<void>();
    prior.resolve();
  };
  const calls: {
    context: TranscriptContext;
    options: SimpleStreamOptions | undefined;
    providerSessionId: string;
    done: boolean;
    finish(message: AssistantMessage): void;
  }[] = [];
  const models = createModels();
  models.setProvider({
    ...provider.provider,
    streamSimple: withAuxiliaryRequests((_model, context, options) => {
      const stream = createAssistantMessageEventStream();
      // This is the ACTUAL locked StreamOptions.sessionId, not a host request or provider call.id.
      if (!options?.sessionId) throw new Error("Missing native provider Session identity");
      const call = {
        context,
        options,
        providerSessionId: options.sessionId,
        done: false,
        finish(message: AssistantMessage) {
          if (call.done) throw new Error("Test model call settled twice");
          call.done = true;
          if (message.stopReason === "toolUse")
            stream.push({ type: "done", reason: "toolUse", message });
          else stream.push({ type: "done", reason: "stop", message });
          stream.end(message);
          publish();
        },
      };
      calls.push(call);
      options.signal?.addEventListener(
        "abort",
        () => {
          if (!call.done) {
            const error = fauxAssistantMessage("", { stopReason: "aborted" });
            call.done = true;
            stream.push({ type: "error", reason: "aborted", error });
            stream.end(error);
            publish();
          }
        },
        { once: true },
      );
      publish();
      return stream;
    }),
  });
  return {
    model: provider.getModel(),
    models,
    calls,
    notify: publish,
    async until(predicate: () => boolean, context: Context) {
      while (!predicate()) {
        const wake = changed.promise;
        if (predicate()) return;
        await awaitWithContext(wake, context);
      }
    },
  };
}
