import { expect, test } from "bun:test";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createSession } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { mcpOAuthServer } from "../helpers/mcp-oauth-server.ts";

test("Goal requests offer current MCP declarations on the first and successor rounds", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer({ authentication: false });
  const config = join(dirs.homeDir, ".rukie/mcp.json");
  await Bun.write(
    config,
    JSON.stringify({ mcpServers: { keep: { url: server.url }, removed: { url: server.url } } }),
  );
  const seen: string[][] = [];
  const fake = fakeModel([
    async (context) => {
      const tools = getCurrentTools(context.messages).map((tool) => tool.name);
      seen.push(tools);
      await Bun.write(config, JSON.stringify({ mcpServers: { keep: { url: server.url } } }));
      return fauxAssistantMessage("First round inspected server lifecycle.");
    },
    (context) => {
      seen.push(getCurrentTools(context.messages).map((tool) => tool.name));
      return fauxAssistantMessage(fauxToolCall("update_goal", { action: "complete" }), {
        stopReason: "toolUse",
      });
    },
    fauxAssistantMessage("Goal complete."),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  try {
    const goal = await session.createGoal("Inspect the MCP server lifecycle", { maxRounds: 2 });
    expect((await session.waitForRequest(goal.requestId)).success).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("mcp__keep__echo");
    expect(seen[0]).toContain("mcp__removed__echo");
    expect(seen[1]).toContain("mcp__keep__echo");
    expect(seen[1]).not.toContain("mcp__removed__echo");
    expect((await session.mcpServers()).servers.map((view) => view.name)).toEqual(["keep"]);
  } finally {
    await session.close();
    await server.stop();
    await dirs.cleanup();
  }
});
