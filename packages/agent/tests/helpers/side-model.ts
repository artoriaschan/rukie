import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  type TranscriptContext,
} from "@earendil-works/pi-ai";

/** Hold only wrapped auxiliary requests at the external model boundary. */
export function sideModel(primary: StreamFn) {
  const started = Promise.withResolvers<void>();
  const calls: {
    context: TranscriptContext;
    signal?: AbortSignal;
    delta(text: string): void;
    thinking(text: string): void;
    finish(): void;
    fail(message: string): void;
  }[] = [];
  const streamFn: StreamFn = (model, context, options) => {
    const last = context.messages.at(-1);
    const text =
      last?.role === "user"
        ? typeof last.content === "string"
          ? last.content
          : last.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("")
        : "";
    if (!text.startsWith("<side-question-context>\n")) return primary(model, context, options);
    const stream = createAssistantMessageEventStream();
    const partial = fauxAssistantMessage("", { stopReason: "pending" });
    let output = "";
    let ended = false;
    const abort = () => fail("Request was aborted", "aborted");
    const fail = (errorMessage: string, reason: "error" | "aborted" = "error") => {
      if (ended) return;
      ended = true;
      options?.signal?.removeEventListener("abort", abort);
      const error = { ...partial, stopReason: reason, errorMessage };
      stream.push({ type: "error", reason, error });
      stream.end(error);
    };
    calls.push({
      context: structuredClone(context),
      signal: options?.signal,
      delta(delta) {
        output += delta;
        partial.content = [{ type: "text", text: output }];
        stream.push({ type: "text_delta", contentIndex: 0, delta, partial });
      },
      thinking(thinking) {
        stream.push({ type: "thinking_delta", contentIndex: 0, delta: thinking, partial });
      },
      finish() {
        if (ended) return;
        ended = true;
        options?.signal?.removeEventListener("abort", abort);
        const message = { ...partial, stopReason: "stop" as const };
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
      },
      fail,
    });
    stream.push({ type: "start", partial });
    options?.signal?.addEventListener("abort", abort, { once: true });
    if (options?.signal?.aborted) abort();
    started.resolve();
    return stream;
  };
  return { streamFn, calls, started: started.promise };
}
