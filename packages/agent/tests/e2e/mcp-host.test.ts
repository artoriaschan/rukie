import { expect, test } from "bun:test";
import { join } from "node:path";
import { fauxAssistantMessage, getCurrentTools } from "@earendil-works/pi-ai";
import { createMcpHost, createSession } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { mcpOAuthServer } from "../helpers/mcp-oauth-server.ts";

test("an injected MCP Host survives Session disposal and serves a later Session", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer({ authentication: false });
  const host = createMcpHost();
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    const first = await createSession({
      ...dirs,
      ...fakeModel([fauxAssistantMessage("first")]),
      mcpHost: host,
    });
    try {
      await first.run("use MCP");
      expect((await first.mcpServers()).servers).toMatchObject([
        { name: "srv", status: "connected", toolCount: 1 },
      ]);
    } finally {
      await first.close();
    }
    const fake = fakeModel([fauxAssistantMessage("later")]);
    const second = await createSession({ ...dirs, ...fake, mcpHost: host });
    try {
      expect((await second.run("use MCP again")).success).toBe(true);
      expect(getCurrentTools(fake.contexts[0]!.messages).map((tool) => tool.name)).toContain(
        "mcp__srv__echo",
      );
    } finally {
      await second.close();
    }
    await host.close();
    await expect(createSession({ ...dirs, ...fakeModel([]), mcpHost: host })).rejects.toThrow(
      "MCP Host has been closed",
    );
  } finally {
    await host.close();
    await server.stop();
    await dirs.cleanup();
  }
});

test("closing an injected MCP Host shuts down active resources and rejects later Runs", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer({ authentication: false });
  const host = createMcpHost();
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    const session = await createSession({
      ...dirs,
      ...fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("unexpected")]),
      mcpHost: host,
    });
    try {
      await session.run("connect");
      await host.close();
      expect(server.requests.at(-1)?.method).toBe("DELETE");
      const requests = server.requests.length;
      await expect(session.run("Host is closed")).rejects.toThrow("MCP view has been closed");
      expect(server.requests).toHaveLength(requests);
    } finally {
      await session.close();
    }
  } finally {
    await host.close();
    await server.stop();
    await dirs.cleanup();
  }
});
