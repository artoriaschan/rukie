import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import {
  normalizeContext,
  type Api,
  type Model,
  type ToolCall,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { convertToLlm } from "../reminders/index.ts";
import { createUserVisibleError } from "@neant/shared";

function failed(cause?: string) {
  return cause
    ? createUserVisibleError(cause, { code: "side-question-provider-failed", params: { cause } })
    : createUserVisibleError("Side question failed.", { code: "side-question-failed", params: {} });
}

function wrapQuestion(question: string, pending: readonly ToolCall[]) {
  const running =
    pending.length === 0
      ? ""
      : `
The main task is still executing these tool calls; their results are not available yet:
${pending
  .map((call) => {
    const args = JSON.stringify(call.arguments).replace(/\s+/g, " ").trim();
    const code = args.charCodeAt(399);
    const end = code >= 0xd800 && code <= 0xdbff ? 399 : 400;
    return `- ${call.name} ${args.length <= 400 ? args : `${args.slice(0, end)}…`}`;
  })
  .join("\n")}`;
  return `<side-question-context>
Give one concise answer to the question below using the conversation already provided.
This auxiliary call runs alongside the main session. The main task continues independently;
do not describe it as interrupted, resumed, or as work performed by this call.
No tools are available here: do not claim to inspect files, execute commands, browse,
or carry out future actions. There will be no follow-up turn for this call.
When the available context is insufficient, state what is unknown without promising research.${running}
</side-question-context>

${question}`;
}

/** Providers may not settle setup or iteration on abort; the caller still must settle. */
function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** A standalone provider request over an owned context snapshot; no Agent loop or persistence. */
export async function* sideQuestion(options: {
  question: string;
  messages: AgentMessage[];
  systemPrompt: string;
  model: Model<Api>;
  streamFn: StreamFn;
  running: ReadonlySet<string>;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const answered = new Set(
    options.messages.flatMap((message) =>
      message.role === "toolResult" ? [message.toolCallId] : [],
    ),
  );
  const pending: ToolCall[] = [];
  const snapshot = options.messages.flatMap((message): AgentMessage[] => {
    if (message.role !== "assistant") return [message];
    const content = message.content.filter((block) => {
      if (block.type !== "toolCall" || answered.has(block.id)) return true;
      if (options.running.has(block.id)) pending.push(block);
      return false;
    });
    return content.length ? [{ ...message, content }] : [];
  });
  const messages = convertToLlm(snapshot).map((message) => {
    if (message.role !== "system") return message;
    const { toolsAdded: _added, toolsRemoved: _removed, ...withoutTools } = message;
    return withoutTools;
  });
  messages.push({
    role: "user",
    content: [{ type: "text", text: wrapQuestion(options.question, pending) }],
    timestamp: Date.now(),
  });
  const request = normalizeContext({
    messages,
    ...(messages.some((message) => message.role === "system")
      ? {}
      : { systemPrompt: options.systemPrompt }),
  });
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  let complete = false;
  try {
    signal.throwIfAborted();
    const stream = await cancellable(
      Promise.resolve(options.streamFn(options.model, request, { signal })),
      signal,
    );
    const iterator = stream[Symbol.asyncIterator]();
    let final: AssistantMessage | undefined;
    let emitted = "";
    while (true) {
      const next = await cancellable(iterator.next(), signal);
      if (next.done) break;
      const event = next.value;
      if (event.type === "text_delta") {
        emitted += event.delta;
        yield event.delta;
      } else if (event.type === "done") final = event.message;
      else if (event.type === "error") throw failed(event.error.errorMessage);
    }
    final ??= await cancellable(stream.result(), signal);
    signal.throwIfAborted();
    if (final.stopReason === "error" || final.stopReason === "aborted")
      throw failed(final.errorMessage);
    const text = final.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    if (!text.trim())
      throw createUserVisibleError("No response received.", {
        code: "side-question-no-response",
        params: {},
      });
    if (text.startsWith(emitted) && text.length > emitted.length) yield text.slice(emitted.length);
    complete = true;
  } finally {
    if (!complete) controller.abort();
  }
}
