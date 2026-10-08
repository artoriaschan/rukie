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

test.each([true, false, undefined])(
  "custom Anthropic tool additions use declared compat: %s",
  async (enabled) => {
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
          return response(false);
        requests.push(body);
        return response(enabled === true && requests.length === 1);
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
            api: "anthropic-messages",
            baseUrl: server.url.origin,
            apiKeyEnv: key,
            models: [
              {
                id: "m",
                ...(enabled === undefined
                  ? {}
                  : {
                      compat: {
                        supportsMidConvoSystemMessages: enabled,
                        supportsMidConvoToolChanges: enabled,
                      },
                    }),
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
      if (enabled !== true) {
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          tools: expect.arrayContaining([expect.objectContaining({ name: "mcp__local__echo" })]),
        });
        expect(JSON.stringify(requests[0])).not.toContain('"name":"ToolSearch"');
        return;
      }
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({
        tools: expect.arrayContaining([expect.objectContaining({ name: "ToolSearch" })]),
      });
      expect(JSON.stringify(requests[0])).not.toContain('"name":"mcp__local__echo"');
      const additions = {
        tools: expect.not.arrayContaining([expect.objectContaining({ name: "mcp__local__echo" })]),
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
      expect(requests[1]).toMatchObject(additions);
      const resumeId = session.id;
      await session.close();
      session = await createSession({ ...dirs, settings, resumeId });
      expect(await session.run("continue")).toMatchObject({ success: true, text: "done" });
      expect(requests).toHaveLength(3);
      expect(requests[2]).toMatchObject(additions);
    } finally {
      await session.close();
    }
  },
);
