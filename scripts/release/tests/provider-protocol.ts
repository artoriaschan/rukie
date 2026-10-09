export type ReleaseProtocol =
  | "openai-responses"
  | "anthropic-messages"
  | "azure"
  | "amazon-bedrock";
const reply = "packaged protocol reply";
const event = (type: string, value: object) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
function responses() {
  const item = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: reply, annotations: [] }],
  };
  return (
    event("response.created", { response: { id: "resp_1" } }) +
    event("response.output_item.added", {
      output_index: 0,
      item: { ...item, status: "in_progress", content: [] },
    }) +
    event("response.output_text.delta", {
      output_index: 0,
      item_id: "msg_1",
      content_index: 0,
      delta: reply,
    }) +
    event("response.output_item.done", { output_index: 0, item }) +
    event("response.completed", {
      response: {
        id: "resp_1",
        object: "response",
        status: "completed",
        output: [item],
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          total_tokens: 14,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    })
  );
}
function anthropic() {
  return (
    event("message_start", {
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "m",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    }) +
    event("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
    event("content_block_delta", { index: 0, delta: { type: "text_delta", text: reply } }) +
    event("content_block_stop", { index: 0 }) +
    event("message_delta", {
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 4 },
    }) +
    event("message_stop", {})
  );
}

/** Actual local wire protocols; request keys are fabricated and endpoint never leaves loopback. */
export function providerProtocol(
  protocol: ReleaseProtocol,
  options: { error?: boolean; holdPrompt?: string } = {},
) {
  const requests: {
    path: string;
    authorization: string | null;
    apiKey: string | null;
    body: unknown;
  }[] = [];
  const received = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body: unknown = await request.json();
      requests.push({
        path: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
        apiKey: request.headers.get("x-api-key") ?? request.headers.get("api-key"),
        body,
      });
      if (protocol === "amazon-bedrock")
        return Response.json(
          { message: "local fabricated AWS adapter accepted" },
          { status: 400, headers: { "x-amzn-errortype": "ValidationException" } },
        );
      if (options.error)
        return Response.json(
          { error: { type: "invalid_request_error", message: "local protocol rejection" } },
          { status: 400 },
        );
      if (options.holdPrompt && JSON.stringify(body).includes(options.holdPrompt)) {
        received.resolve();
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  event("response.created", { response: { id: "pending" } }),
                ),
              );
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response(protocol === "anthropic-messages" ? anthropic() : responses(), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  return {
    baseUrl: server.url.origin,
    requests,
    received: received.promise,
    stop: () => server.stop(true),
  };
}
