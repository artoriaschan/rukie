import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createSession, loadSettings, type SubagentIdentity } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { runRequest } from "../helpers/crashed-subagents.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Awaited<ReturnType<typeof createSession>>[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await dirs?.cleanup();
});
async function fixture() {
  dirs = await tempDirs();
  await Bun.write(join(dirs.homeDir, ".rukie/settings.json"), JSON.stringify({ toolSearch: "on" }));
  await Bun.write(
    join(dirs.homeDir, "manifest.json"),
    JSON.stringify({ tools: ["echo", "hidden"] }),
  );
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
}
const search = (query: string) =>
  fauxAssistantMessage(fauxToolCall("ToolSearch", { query }), { stopReason: "toolUse" });
const names = (messages: Parameters<typeof getCurrentTools>[0]) =>
  getCurrentTools(messages).map((tool) => tool.name);
async function open(responses: Parameters<typeof fakeModel>[0]) {
  const fake = fakeModel(responses, {
    model: { contextWindow: 100000, compat: { supportsMidConvoToolChanges: true } },
  });
  const { settings } = await loadSettings(dirs);
  const session = await createSession({ ...dirs, ...fake, settings });
  sessions.push(session);
  return { session, fake };
}

test.each(["subagent", "subagent_fork"] as const)(
  "%s discovers tools independently of the parent",
  async (delegate) => {
    await fixture();
    const { session, fake } = await open([
      search("select:mcp__local__echo"),
      fauxAssistantMessage("parent learned echo"),
      fauxAssistantMessage(
        fauxToolCall(delegate, {
          description: "Independent",
          prompt: "discover echo independently",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        expect(names(context.messages)).toContain("ToolSearch");
        expect(names(context.messages)).not.toContain("mcp__local__echo");
        return search("select:mcp__local__echo");
      },
      (context) => {
        expect(names(context.messages)).toContain("mcp__local__echo");
        return fauxAssistantMessage("child learned echo");
      },
      fauxAssistantMessage("parent done"),
    ]);
    await runRequest(session, "learn echo");
    await runRequest(session, "delegate now");
    expect(fake.contexts).toHaveLength(6);
    expect(names(fake.contexts[5]!.messages)).toContain("mcp__local__echo");
  },
);

test("a retained child keeps its own discovered tools without exposing them to its parent", async () => {
  await fixture();
  let childId = "";
  let childRequests = 0;
  const response: Parameters<typeof fakeModel>[0][number] = (context) => {
    const tools = names(context.messages);
    if (!tools.includes("subagent")) {
      childRequests++;
      if (childRequests === 1) {
        expect(tools).not.toContain("mcp__local__echo");
        return search("select:mcp__local__echo");
      }
      expect(tools).toContain("mcp__local__echo");
      return fauxAssistantMessage("child done");
    }
    expect(tools).not.toContain("mcp__local__echo");
    const lastUser = context.messages.findLast((message) => message.role === "user");
    const text = lastUser?.role === "user" ? JSON.stringify(lastUser.content) : "";
    const callName = text.includes("continue child") ? "send_message" : "subagent";
    const alreadyCalled = context.messages.some(
      (message) =>
        message.role === "assistant" &&
        message.content.some((block) => block.type === "toolCall" && block.name === callName),
    );
    if (callName === "send_message" && !alreadyCalled)
      return fauxAssistantMessage(
        fauxToolCall("send_message", { agent_id: childId, message: "retained child checks echo" }),
        { stopReason: "toolUse" },
      );
    if (callName === "subagent" && !alreadyCalled)
      return fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Retained",
          prompt: "learn echo",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      );
    return fauxAssistantMessage("parent done");
  };
  const { session } = await open(Array.from({ length: 12 }, () => response));
  await runRequest(session, "start child");
  const identities = session.toolState("subagents") as SubagentIdentity[];
  childId = identities[0]!.id;
  await runRequest(session, "continue child");
  expect(childRequests).toBe(3);
});

test("an explicit child tool allowlist limits ToolSearch candidates", async () => {
  await fixture();
  await Bun.write(
    join(dirs.homeDir, ".rukie/agents/limited.md"),
    "---\nname: limited\ndescription: Restricted MCP search\ntools: [ToolSearch, mcp__local__echo]\n---\nOnly echo is permitted.",
  );
  const { session } = await open([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Limited",
        prompt: "search for all tools",
        subagent_type: "limited",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      expect(names(context.messages)).toEqual(["ToolSearch"]);
      return search("select:mcp__local__hidden,mcp__local__echo");
    },
    (context) => {
      expect(names(context.messages)).toEqual(["ToolSearch", "mcp__local__echo"]);
      const result = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "ToolSearch",
      );
      expect(JSON.stringify(result)).toContain("Unknown tool names: mcp__local__hidden");
      return fauxAssistantMessage("restricted child done");
    },
    fauxAssistantMessage("parent done"),
  ]);
  await runRequest(session, "delegate restricted search");
});

test("Compaction retains discovered declarations and restores the complete deferred reminder", async () => {
  await fixture();
  await Bun.write(join(dirs.cwd, "old.txt"), "OLD_EVIDENCE widget contract ".repeat(2000));
  const read = () => fauxToolCall("read", { path: "old.txt" });
  const { session, fake } = await open([
    fauxAssistantMessage(
      [read(), fauxToolCall("ToolSearch", { query: "select:mcp__local__echo" })],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("older evidence recorded"),
    fauxAssistantMessage(read(), { stopReason: "toolUse" }),
    fauxAssistantMessage("second evidence recorded"),
    fauxAssistantMessage("recent protected reply"),
    fauxAssistantMessage("Tool discovery and widget summary."),
    (context) => {
      expect(names(context.messages)).toContain("mcp__local__echo");
      expect(names(context.messages)).not.toContain("mcp__local__hidden");
      expect(JSON.stringify(context.messages)).toContain(
        "Deferred MCP tools (use ToolSearch to load their definitions):\\n- mcp__local__hidden",
      );
      return fauxAssistantMessage("continued");
    },
    fauxAssistantMessage(
      fauxToolCall("subagent_fork", {
        description: "Fork after compaction",
        prompt: "find your own tools",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      expect(names(context.messages)).not.toContain("mcp__local__echo");
      const reminder = context.messages.findLast(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("Deferred MCP tools"),
      );
      expect(JSON.stringify(reminder)).toContain("mcp__local__echo");
      return fauxAssistantMessage("fresh fork discovery is independent");
    },
    fauxAssistantMessage("fork done"),
  ]);
  await session.run("inspect old widgets and discover echo");
  await session.run("inspect second evidence");
  await session.run("recent retained task");
  await session.compact();
  expect(JSON.stringify(fake.contexts[5])).toContain("context summarization assistant");
  await session.run("continue after compaction");
  expect(fake.contexts).toHaveLength(7);
  await runRequest(session, "fork after compaction");
  expect(fake.contexts).toHaveLength(10);
});
