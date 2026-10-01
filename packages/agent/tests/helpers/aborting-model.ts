import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { fakeModel } from "./fake-model.ts";

/** Emits a partial response and settles only when the caller aborts the Run. */
export function abortingModel() {
  const started = Promise.withResolvers<void>();
  const { model } = fakeModel([]);
  const streamFn: StreamFn = (_model, _context, options) => {
    const stream = createAssistantMessageEventStream();
    const partial = fauxAssistantMessage("partial output", { stopReason: "pending" });
    const abort = () => {
      const final = {
        ...partial,
        stopReason: "aborted" as const,
        errorMessage: "Request was aborted",
      };
      stream.push({ type: "error", reason: "aborted", error: final });
      stream.end(final);
    };
    options?.signal?.addEventListener("abort", abort, { once: true });
    stream.push({ type: "start", partial });
    stream.push({ type: "text_delta", contentIndex: 0, delta: "partial output", partial });
    started.resolve();
    return stream;
  };
  return { model, streamFn, started: started.promise };
}
