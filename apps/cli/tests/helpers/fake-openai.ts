/**
 * Fake OpenAI-compatible Chat Completions endpoint for Seam 2: streams `reply` for every
 * request and records the request bodies and auth headers it receives.
 */
export function fakeOpenAI(reply: string) {
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
      const body =
        chunk({ role: "assistant", content: reply }, null) + chunk({}, "stop") + "data: [DONE]\n\n";
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  });
  return { baseUrl: `${server.url.origin}/v1`, requests, stop: () => server.stop(true) };
}
