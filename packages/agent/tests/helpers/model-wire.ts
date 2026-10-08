function response(tool: boolean, name: string, args: object) {
  const event = (type: string, data: object) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return new Response(
    event("message_start", {
      message: {
        id: "msg-test",
        type: "message",
        role: "assistant",
        model: "m",
        content: [],
        stop_reason: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    }) +
      event("content_block_start", {
        index: 0,
        content_block: tool
          ? { type: "tool_use", id: "search-call", name, input: {} }
          : { type: "text", text: "" },
      }) +
      event("content_block_delta", {
        index: 0,
        delta: tool
          ? {
              type: "input_json_delta",
              partial_json: JSON.stringify(args),
            }
          : { type: "text_delta", text: "done" },
      }) +
      event("content_block_stop", { index: 0 }) +
      event("message_delta", {
        delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      }) +
      event("message_stop", {}),
    { headers: { "content-type": "text/event-stream" } },
  );
}

export function wireResponse(
  api: string,
  search: boolean,
  name = "ToolSearch",
  args: object = { query: "select:mcp__local__echo" },
) {
  if (api === "anthropic-messages") return response(search, name, args);
  if (api === "openai-completions") {
    const chunk = (delta: object, finish: string | null) =>
      `data: ${JSON.stringify({ id: "compat-test", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const delta = search
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "search-call",
              type: "function",
              function: {
                name,
                arguments: JSON.stringify(args),
              },
            },
          ],
        }
      : { role: "assistant", content: "done" };
    return new Response(
      chunk(delta, null) + chunk({}, search ? "tool_calls" : "stop") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  }
  const event = (type: string, data: object) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const item = search
    ? {
        type: "function_call",
        id: "fc_search",
        call_id: "search-call",
        name,
        arguments: JSON.stringify(args),
        status: "completed",
      }
    : {
        type: "message",
        id: "msg_done",
        role: "assistant",
        content: [{ type: "output_text", text: "done", annotations: [] }],
        status: "completed",
      };
  return new Response(
    event("response.created", { response: { id: "resp_test" } }) +
      event("response.output_item.added", { output_index: 0, item }) +
      event("response.output_item.done", { output_index: 0, item }) +
      event("response.completed", {
        response: {
          id: "resp_test",
          status: "completed",
          output: [item],
          usage: {
            input_tokens: 10,
            output_tokens: 1,
            total_tokens: 11,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
