import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, loadSettings } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const servers: ReturnType<typeof Bun.serve>[] = [];
const key = "RUKIE_COMPAT_TEST_KEY";
const previousKey = process.env[key];
afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  if (previousKey === undefined) delete process.env[key];
  else process.env[key] = previousKey;
  await dirs?.cleanup();
});

function response(tool: boolean) {
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
          ? { type: "tool_use", id: "search-call", name: "ToolSearch", input: {} }
          : { type: "text", text: "" },
      }) +
      event("content_block_delta", {
        index: 0,
        delta: tool
          ? {
              type: "input_json_delta",
              partial_json: JSON.stringify({ query: "select:mcp__local__echo" }),
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

function toolMatcher(api: string, name: string) {
  return api === "openai-completions"
    ? expect.objectContaining({ function: expect.objectContaining({ name }) })
    : expect.objectContaining({ name });
}

function wireResponse(api: string, search: boolean) {
  if (api === "anthropic-messages") return response(search);
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
                name: "ToolSearch",
                arguments: JSON.stringify({ query: "select:mcp__local__echo" }),
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
        name: "ToolSearch",
        arguments: JSON.stringify({ query: "select:mcp__local__echo" }),
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

test.each([
  {
    api: "anthropic-messages",
    native: true,
    compat: { supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true },
  },
  {
    api: "anthropic-messages",
    native: false,
    compat: { supportsMidConvoSystemMessages: false, supportsMidConvoToolChanges: false },
  },
  { api: "anthropic-messages", native: false, compat: undefined },
  { api: "openai-completions", native: false, compat: undefined },
  { api: "openai-responses", native: false, compat: undefined },
  { api: "openai-responses", native: false, compat: { supportsToolSearch: false } },
  {
    api: "openai-responses",
    native: true,
    compat: { supportsToolSearch: true, supportsMidConvoSystemMessages: true },
  },
])(
  "custom $api tool discovery selects native=$native with compat=$compat",
  async ({ api, native, compat }) => {
    dirs = await tempDirs();
    process.env[key] = "test-key";
    const requests: unknown[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body: unknown = await request.json();
        if (
          JSON.stringify(body).includes("Create a concise title for an AI coding-assistant session")
        )
          return wireResponse(api, false);
        requests.push(body);
        return wireResponse(api, requests.length === 1);
      },
    });
    servers.push(server);
    await Bun.write(
      join(dirs.homeDir, ".rukie/settings.json"),
      JSON.stringify({
        model: "custom/m",
        toolSearch: "on",
        providers: [
          {
            id: "custom",
            api,
            baseUrl: server.url.origin,
            apiKeyEnv: key,
            models: [
              {
                id: "m",
                ...(compat === undefined ? {} : { compat }),
              },
            ],
          },
        ],
      }),
    );
    await Bun.write(join(dirs.homeDir, "manifest.json"), JSON.stringify({ tools: ["echo"] }));
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({
        mcpServers: {
          local: {
            command: process.execPath,
            args: [fileURLToPath(new URL("../helpers/mcp-server.ts", import.meta.url))],
            env: {
              MCP_MANIFEST: join(dirs.homeDir, "manifest.json"),
              MCP_PIDS: join(dirs.homeDir, "pids"),
              MCP_CALLS: join(dirs.homeDir, "calls"),
            },
          },
        },
      }),
    );
    const { settings } = await loadSettings(dirs);
    let session = await createSession({ ...dirs, settings });
    try {
      expect(await session.run("load echo")).toMatchObject({ success: true, text: "done" });
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({
        tools: expect.arrayContaining([toolMatcher(api, "ToolSearch")]),
      });
      expect(JSON.stringify(requests[0])).not.toContain('"name":"mcp__local__echo"');
      const additions = {
        tools: expect.not.arrayContaining([toolMatcher(api, "mcp__local__echo")]),
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool_addition",
                tool: {
                  type: "tool_definition",
                  definition: expect.objectContaining({ name: "mcp__local__echo" }),
                },
              }),
            ]),
          }),
        ]),
      };
      const expected = !native
        ? { tools: expect.arrayContaining([toolMatcher(api, "mcp__local__echo")]) }
        : api === "anthropic-messages"
          ? additions
          : {
              tools: expect.not.arrayContaining([toolMatcher(api, "mcp__local__echo")]),
              input: expect.arrayContaining([
                expect.objectContaining({
                  type: "tool_search_output",
                  tools: expect.arrayContaining([toolMatcher(api, "mcp__local__echo")]),
                }),
              ]),
            };
      expect(requests[1]).toMatchObject(expected);
      if (!native) {
        expect(JSON.stringify(requests[1])).not.toContain('"type":"tool_addition"');
        expect(JSON.stringify(requests[1])).not.toContain('"type":"tool_search_output"');
      }
      const resumeId = session.id;
      await session.close();
      session = await createSession({ ...dirs, settings, resumeId });
      expect(await session.run("continue")).toMatchObject({ success: true, text: "done" });
      expect(requests).toHaveLength(3);
      expect(requests[2]).toMatchObject(expected);
    } finally {
      await session.close();
    }
  },
);
