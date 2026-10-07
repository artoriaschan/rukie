import { runRequest } from "../helpers/crashed-subagents.ts";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createSession, type McpAuthRequest, type McpAuthReply } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { mcpOAuthServer } from "../helpers/mcp-oauth-server.ts";

async function paste({ authorizationUrl }: McpAuthRequest): Promise<McpAuthReply> {
  const response = await fetch(authorizationUrl, { redirect: "manual" });
  const url = response.headers.get("location");
  if (!url) throw new Error("Authorization fixture did not provide a callback.");
  return { type: "callback-url", url };
}

const delegate = (tool: string, type?: string) =>
  fauxAssistantMessage(
    fauxToolCall(tool, {
      description: "Authorize MCP",
      prompt: "Authenticate and use MCP",
      run_in_background: false,
      ...(type && { subagent_type: type }),
    }),
    { stopReason: "toolUse" },
  );
const authenticate = () =>
  fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" });
const echo = () =>
  fauxAssistantMessage(fauxToolCall("mcp__srv__echo", {}), { stopReason: "toolUse" });

test.each(["subagent", "subagent_fork"])(
  "%s authorizes with child origin, uses real tools, and shares the credential with the parent's next Run",
  async (tool) => {
    const dirs = await tempDirs();
    const server = mcpOAuthServer();
    try {
      await Bun.write(
        join(dirs.homeDir, ".rukie/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
      );
      const fake = fakeModel([
        delegate(tool),
        authenticate(),
        echo(),
        fauxAssistantMessage("child done"),
        fauxAssistantMessage("parent done"),
        echo(),
        fauxAssistantMessage("parent reused"),
      ]);
      const requests: McpAuthRequest[] = [];
      const session = await createSession({
        ...dirs,
        ...fake,
        permissionMode: "full-access",
        onMcpAuth: async (request) => {
          requests.push(request);
          return paste(request);
        },
      });
      let childId: string | undefined;
      try {
        expect(
          (
            await runRequest(session, "delegate authorization", {
              onEvent(event) {
                if (event.type === "subagent_event") childId = event.agentId;
              },
            })
          ).text,
        ).toBe("parent done");
        expect(
          getCurrentTools(fake.contexts[1]!.messages)
            .filter((item) => item.name.startsWith("mcp__"))
            .map((item) => item.name),
        ).toEqual(["mcp__srv__authenticate"]);
        expect(
          fake.contexts[3]!.messages.findLast((message) => message.role === "toolResult"),
        ).toMatchObject({ isError: false, content: [{ type: "text", text: "OAuth MCP: called" }] });
        expect(
          getCurrentTools(fake.contexts[2]!.messages)
            .filter((item) => item.name.startsWith("mcp__"))
            .map((item) => item.name),
        ).toEqual(["mcp__srv__echo"]);
        expect(requests).toHaveLength(1);
        expect(requests[0]?.origin).toEqual({ agentId: childId!, description: "Authorize MCP" });
        expect((await runRequest(session, "use child credential")).text).toBe("parent reused");
        expect(
          getCurrentTools(fake.contexts[5]!.messages)
            .filter((item) => item.name.startsWith("mcp__"))
            .map((item) => item.name),
        ).toEqual(["mcp__srv__echo"]);
        expect(
          fake.contexts[6]!.messages.findLast((message) => message.role === "toolResult"),
        ).toMatchObject({ isError: false, content: [{ type: "text", text: "OAuth MCP: called" }] });
        expect(requests).toHaveLength(1);
      } finally {
        await session.close();
      }
    } finally {
      await server.stop();
      await dirs.cleanup();
    }
  },
);

test.each(["subagent", "subagent_fork"])(
  "Headless %s has no authenticate tools or browser interaction",
  async (tool) => {
    const dirs = await tempDirs();
    const server = mcpOAuthServer();
    try {
      await Bun.write(
        join(dirs.homeDir, ".rukie/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
      );
      const fake = fakeModel([
        delegate(tool),
        fauxAssistantMessage("child done"),
        fauxAssistantMessage("parent done"),
      ]);
      const session = await createSession({ ...dirs, ...fake, onWarning: () => {} });
      try {
        expect((await runRequest(session, "delegate")).text).toBe("parent done");
        expect(
          getCurrentTools(fake.contexts[1]!.messages).filter((item) =>
            item.name.startsWith("mcp__"),
          ),
        ).toEqual([]);
        expect(server.requests.filter((request) => request.path === "/authorize")).toEqual([]);
      } finally {
        await session.close();
      }
    } finally {
      await server.stop();
      await dirs.cleanup();
    }
  },
);

test("a child's cancelled OAuth interaction remains non-error and leaves the parent needing authentication", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    const fake = fakeModel([
      delegate("subagent"),
      authenticate(),
      fauxAssistantMessage("child continued"),
      fauxAssistantMessage("parent continued"),
      fauxAssistantMessage("still needs login"),
    ]);
    const requests: McpAuthRequest[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      onMcpAuth: async (request) => {
        requests.push(request);
        return { type: "cancelled" };
      },
    });
    try {
      expect((await runRequest(session, "delegate")).text).toBe("parent continued");
      expect(
        fake.contexts[2]!.messages.findLast((message) => message.role === "toolResult"),
      ).toMatchObject({ isError: false, details: { type: "cancelled", server: "srv" } });
      expect(requests[0]?.origin?.description).toBe("Authorize MCP");
      const before = server.requests.filter((request) => request.path === "/mcp").length;
      await runRequest(session, "check again");
      expect(
        getCurrentTools(fake.contexts[4]!.messages)
          .filter((item) => item.name.startsWith("mcp__"))
          .map((item) => item.name),
      ).toEqual(["mcp__srv__authenticate"]);
      expect(server.requests.filter((request) => request.path === "/mcp")).toHaveLength(before);
      expect(requests).toHaveLength(1);
    } finally {
      await session.close();
    }
  } finally {
    await server.stop();
    await dirs.cleanup();
  }
});

test("an authenticate-only type keeps its exact restriction after logging in", async () => {
  const dirs = await tempDirs();
  const server = mcpOAuthServer();
  const other = mcpOAuthServer();
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url }, other: { url: other.url } } }),
    );
    await Bun.write(
      join(dirs.homeDir, ".rukie/agents/auth-only.md"),
      "---\nname: auth-only\ndescription: Authenticate without data access\ntools: [mcp__srv__authenticate]\n---\nOnly authenticate.",
    );
    const fake = fakeModel([
      delegate("subagent", "auth-only"),
      authenticate(),
      echo(),
      fauxAssistantMessage("child done"),
      fauxAssistantMessage("parent done"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      onMcpAuth: paste,
    });
    try {
      expect((await runRequest(session, "delegate")).text).toBe("parent done");
      expect(getCurrentTools(fake.contexts[1]!.messages).map((item) => item.name)).toEqual([
        "mcp__srv__authenticate",
      ]);
      expect(getCurrentTools(fake.contexts[2]!.messages)).toEqual([]);
      expect(
        fake.contexts[3]!.messages.findLast((message) => message.role === "toolResult"),
      ).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: "<harness>\n[error] Tool mcp__srv__echo is not available\n</harness>",
          },
        ],
      });
      expect(
        server.requests.filter((request) =>
          JSON.stringify(request.body)?.includes('"method":"tools/call"'),
        ),
      ).toEqual([]);
      expect(other.requests.filter((request) => request.path === "/authorize")).toEqual([]);
    } finally {
      await session.close();
    }
  } finally {
    await server.stop();
    await other.stop();
    await dirs.cleanup();
  }
});
