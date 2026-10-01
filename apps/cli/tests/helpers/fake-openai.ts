/**
 * Fake OpenAI-compatible Chat Completions endpoint for Seam 2: streams `reply` for every
 * request and records the request bodies and auth headers it receives.
 */
export function fakeOpenAI(reply: string, options: { holdOpen?: boolean; error?: string } = {}) {
  const received = Promise.withResolvers<void>();
  const requests: { body: any; authorization: string | null }[] = [];
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
      requests.push({ body: await req.json(), authorization: req.headers.get("authorization") });
      received.resolve();
      if (options.error) {
        return Response.json({ error: { message: options.error } }, { status: 400 });
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
        chunk({ role: "assistant", content: reply }, null) +
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
    received: received.promise,
    stop: () => server.stop(true),
  };
}
