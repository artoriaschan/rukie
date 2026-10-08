import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createSession, loadSettings } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { wireResponse } from "../helpers/model-wire.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
let server: ReturnType<typeof Bun.serve> | undefined;
const key = "RUKIE_PROBE_TEST_KEY";
const previousKey = process.env[key];
afterEach(async () => {
  server?.stop(true);
  if (previousKey === undefined) delete process.env[key];
  else process.env[key] = previousKey;
  await dirs?.cleanup();
});

test.each(["openai-responses", "anthropic-messages"])(
  "%s probes native additions outside the Transcript and reuses the cache",
  async (api) => {
    dirs = await tempDirs();
    process.env[key] = "test-key";
    let probes = 0;
    const requests: unknown[] = [];
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body: unknown = await request.json();
        if (JSON.stringify(body).includes("rukie_native_tool_probe")) {
          probes++;
          return wireResponse(api, true, "rukie_native_tool_probe", {});
        }
        if (JSON.stringify(body).includes("Create a concise title"))
          return wireResponse(api, false);
        requests.push(body);
        return wireResponse(api, requests.length === 1);
      },
    });
    await Bun.write(
      join(dirs.homeDir, ".rukie/settings.json"),
      JSON.stringify({
        model: "custom/m",
        toolSearch: "on",
        providers: [
          { id: "custom", api, baseUrl: server.url.origin, apiKeyEnv: key, models: [{ id: "m" }] },
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
            args: [new URL("../helpers/mcp-server.ts", import.meta.url).pathname],
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
      expect(probes).toBe(1);
      expect(JSON.stringify(requests[1])).toContain(
        api === "openai-responses" ? '"type":"tool_search_output"' : '"type":"tool_addition"',
      );
      expect(JSON.stringify(session.messages)).not.toContain("rukie_native_tool_probe");
      const resumeId = session.id;
      await session.close();
      session = await createSession({ ...dirs, settings, resumeId });
      await session.run("continue");
      expect(probes).toBe(1);
      expect(JSON.stringify(session.messages)).not.toContain("rukie_native_tool_probe");
      const cache: unknown = await Bun.file(
        join(dirs.homeDir, ".rukie/model-capabilities.json"),
      ).json();
      expect(JSON.stringify(cache)).toContain('"outcome":"supported"');
      expect(JSON.stringify(cache)).toContain('"usage"');
      expect(JSON.stringify(cache)).not.toContain("test-key");
    } finally {
      await session.close();
    }
  },
);
