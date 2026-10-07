import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createSession, loadSettings } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const servers: ReturnType<typeof Bun.serve>[] = [];
const key = "RUKIE_IMAGE_INPUT_TEST_KEY";
const originalKey = process.env[key];
afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  if (originalKey === undefined) delete process.env[key];
  else process.env[key] = originalKey;
  await dirs?.cleanup();
});

// A valid 1×1 PNG, read through the model tool rather than a frontend attachment.
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";

function readImageProvider() {
  const requests: unknown[] = [];
  const chunk = (delta: object, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "image-input-request",
      object: "chat.completion.chunk",
      created: 0,
      model: "m",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body: unknown = await request.json();
      const title = JSON.stringify(body).includes(
        "Create a concise title for an AI coding-assistant session",
      );
      if (!title) requests.push(body);
      const read = !title && requests.length === 1;
      const delta = read
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "read-image",
                type: "function",
                function: { name: "read", arguments: JSON.stringify({ path: "screenshot.png" }) },
              },
            ],
          }
        : { role: "assistant", content: title ? "Screenshot" : "done" };
      return new Response(
        chunk(delta, null) + chunk({}, read ? "tool_calls" : "stop") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  servers.push(server);
  return { requests, baseUrl: `${server.url.origin}/v1` };
}

test.each([true, false])(
  "custom model read images reach the provider only when declared: %s",
  async (acceptsImages) => {
    dirs = await tempDirs();
    process.env[key] = "test-key";
    const provider = readImageProvider();
    await Bun.write(join(dirs.cwd, "screenshot.png"), Buffer.from(png, "base64"));
    await Bun.write(
      join(dirs.homeDir, ".rukie/settings.json"),
      JSON.stringify({
        model: "image-test/m",
        providers: [
          {
            id: "image-test",
            api: "openai-completions",
            baseUrl: provider.baseUrl,
            apiKeyEnv: key,
            models: [{ id: "m", ...(acceptsImages && { input: ["text", "image"] }) }],
          },
        ],
      }),
    );
    const { settings } = await loadSettings(dirs);
    const session = await createSession({ ...dirs, settings });
    try {
      expect(await session.run("Read screenshot.png")).toMatchObject({
        text: "done",
        success: true,
      });
      expect(provider.requests).toHaveLength(2);
      expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
        toolName: "read",
        isError: false,
        content: expect.arrayContaining([{ type: "image", data: png, mimeType: "image/png" }]),
      });
      if (acceptsImages) {
        expect(provider.requests[1]).toMatchObject({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              content: expect.arrayContaining([
                {
                  type: "image_url",
                  image_url: { url: `data:image/png;base64,${png}` },
                },
              ]),
            }),
          ]),
        });
        expect(JSON.stringify(provider.requests[1])).not.toContain("tool image omitted");
      } else {
        expect(provider.requests[1]).toMatchObject({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "tool",
              content: expect.stringContaining(
                "(tool image omitted: model does not support images)",
              ),
            }),
          ]),
        });
        expect(JSON.stringify(provider.requests[1])).not.toContain(png);
        expect(JSON.stringify(provider.requests[1])).not.toContain("image_url");
      }
    } finally {
      await session.dispose();
    }
  },
);
