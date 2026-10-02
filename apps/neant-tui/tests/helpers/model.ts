import {
  createAssistantMessageEventStream,
  createFauxCore,
  fauxAssistantMessage,
  fauxToolCall,
  type AssistantMessage,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { SessionOptions } from "@neant/agent";

/** Model boundary controlled by the test, including streamed text and cancellation. */
export function controlledModel() {
  const model = createFauxCore({ api: "faux", provider: "faux" }).getModel();
  const calls: {
    context: TranscriptContext;
    signal?: AbortSignal;
    reasoning?: string;
    delta(text: string): void;
    finish(input?: number, output?: number): void;
    tool(name: string, args: Parameters<typeof fauxToolCall>[1]): void;
    tools(tools: { name: string; args: Parameters<typeof fauxToolCall>[1] }[]): void;
    fail(message: string): void;
  }[] = [];
  const streamFn: NonNullable<SessionOptions["streamFn"]> = (_model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const partial = fauxAssistantMessage("", { stopReason: "pending" });
    let text = "";
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
    const complete = (message: AssistantMessage, input = 11, output = 5) => {
      ended = true;
      options?.signal?.removeEventListener("abort", abort);
      message.usage = { ...message.usage, input, output, totalTokens: input + output };
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
          tools.map(({ name, args }, index) =>
            fauxToolCall(name, args, { id: `call-${calls.length}-${index}` }),
          ),
          { stopReason: "toolUse" },
        ),
      );
    calls.push({
      context: structuredClone(context),
      signal: options?.signal,
      reasoning: options?.reasoning,
      delta(delta) {
        text += delta;
        partial.content = [{ type: "text", text }];
        stream.push({ type: "text_delta", contentIndex: 0, delta, partial });
      },
      finish(input = 11, output = 5) {
        complete({ ...partial, stopReason: "stop" }, input, output);
      },
      tool: (name, args) => tools([{ name, args }]),
      tools,
      fail: (message) => fail("error", message),
    });
    return stream;
  };
  return { model, streamFn, calls };
}
