/**
 * Fake OpenAI-compatible Chat Completions endpoint for Seam 2: streams `reply` for every
 * request and records the request bodies and auth headers it receives.
 */
export interface FakeOpenAIOptions {
  holdOpen?: boolean;
  error?: string;
  /** First response requests these tools; subsequent responses return text. */
  toolCalls?: { name: string; arguments: object }[];
  /** Standalone Permission Review reply; main responses keep their original text. */
  reviewReply?: string;
}

export function fakeOpenAI(reply: string, options: FakeOpenAIOptions = {}) {
  const received = Promise.withResolvers<void>();
  const requests: { body: any; authorization: string | null }[] = [];
  const titleRequests: typeof requests = [];
  const chunk = (delta: object, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      created: 0,
      model: "m",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const request: (typeof requests)[number] = {
        body: await req.json(),
        authorization: req.headers.get("authorization"),
      };
      if (
        request.body.messages.some(
          (message: { role: string; content?: string }) =>
            ["system", "developer"].includes(message.role) &&
            message.content?.startsWith(
              "Create a concise title for an AI coding-assistant session from the supplied human messages.",
            ),
        )
      ) {
        titleRequests.push(request);
        return new Response(
          chunk({ role: "assistant", content: "Test session" }, null) +
            chunk({}, "stop") +
            "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      requests.push(request);
      received.resolve();
      if (options.error) {
        return Response.json({ error: { message: options.error } }, { status: 400 });
      }
      if (requests.length === 1 && options.toolCalls) {
        return new Response(
          chunk(
            {
              role: "assistant",
              tool_calls: options.toolCalls.map((tool, index) => ({
                index,
                id: `call-${index}`,
                type: "function",
                function: { name: tool.name, arguments: JSON.stringify(tool.arguments) },
              })),
            },
            null,
          ) +
            chunk({}, "tool_calls") +
            "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      if (options.holdOpen) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(chunk({ role: "assistant", content: reply }, null)),
              );
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      const body =
        chunk(
          {
            role: "assistant",
            content: requests
              .at(-1)!
              .body.messages.some(
                (message: { role: string; content?: string }) =>
                  ["system", "developer"].includes(message.role) &&
                  message.content?.includes("REVIEW_POLICY"),
              )
              ? (options.reviewReply ?? reply)
              : reply,
          },
          null,
        ) +
        chunk({}, "stop") +
        `data: ${JSON.stringify({
          id: "chatcmpl-1",
          object: "chat.completion.chunk",
          created: 0,
          model: "m",
          choices: [],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 5,
            total_tokens: 17,
            prompt_tokens_details: { cached_tokens: 4 },
          },
        })}\n\n` +
        "data: [DONE]\n\n";
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  });
  return {
    baseUrl: `${server.url.origin}/v1`,
    requests,
    titleRequests,
    received: received.promise,
    stop: () => server.stop(true),
  };
}
