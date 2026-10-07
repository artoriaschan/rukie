import { expect, test } from "bun:test";
import { join } from "node:path";
import { start } from "../helpers/app";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createJsonlStore, createSession } from "@rukie/agent";
import { auxiliaryModels } from "../helpers/auxiliary-model";

// Agent Core owns the real HTTP/OAuth fixture; tests drive only its external boundary.
const {
  mcpOAuthServer,
}: {
  mcpOAuthServer(options?: {
    authentication?: boolean;
    tools?: { name: string; description?: string; inputSchema: Record<string, unknown> }[];
    authorizationError?: string;
  }): {
    url: string;
    requests: { body: unknown }[];
    requireMoreScopes(): void;
    stop(): Promise<void>;
  };
} = await import(
  new URL("../../../../agent/tests/helpers/mcp-oauth-server.ts", import.meta.url).href
);
const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");
const idle = (app: Awaited<ReturnType<typeof start>>) =>
  !app.isWorking() && !app.screen().some((line) => line.trim() === "esc 中断");
const down = "\x1b[B";
const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;
const discoveries = (server: ReturnType<typeof mcpOAuthServer>) =>
  server.requests.filter((request) => JSON.stringify(request.body)?.includes('"tools/list"'))
    .length;
const callback = async (app: Awaited<ReturnType<typeof start>>, url: string) => {
  const response = await fetch(url, { redirect: "manual" });
  const location = response.headers.get("location");
  expect(location).not.toBeNull();
  app.stdin.write(paste(location!) + "\r");
};

test("same Run authorization publishes real tools, then a challenge removes the last tool from the open reader", async () => {
  const server = mcpOAuthServer({
    tools: [
      {
        name: "echo",
        description:
          "Echo an authorized message\n" +
          Array.from({ length: 20 }, (_, i) => `Reader line ${i}`).join("\n"),
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
      },
    ],
  });
  const opened: string[] = [];
  const app = await start(["authorize and use tools"], {
    rows: 32,
    session: { permissionMode: "full-access" },
    prepare: (root) =>
      Bun.write(
        join(root, ".rukie/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
      ).then(() => {}),
    host: {
      openExternal: async (url) => {
        opened.push(url);
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("❯ srv · 需要授权"));
    const initialDiscovery = discoveries(server);
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("❯ 登录"));
    app.calls[0]!.tool("mcp__srv__authenticate", {});
    await app.waitFor(() => opened.length === 1 && screen(app).includes("复制授权链接"));
    expect(screen(app)).not.toContain("操作 · ↑↓ Enter");
    await callback(app, opened[0]!);
    await app.waitFor(() => app.calls.length === 2 && screen(app).includes("查看工具"));
    expect(screen(app)).toContain("状态: 已连接");
    expect(discoveries(server)).toBe(initialDiscovery + 1);
    app.stdin.write("\t\x1b[6~");
    await app.waitFor(
      () => screen(app).includes("1 个工具") && !screen(app).includes("状态: 已连接"),
    );
    app.stdin.write("\t" + down + "\r");
    await app.waitFor(() => screen(app).includes("srv 的工具（1）"));
    app.stdin.write("\r");
    await app.waitFor(
      () => screen(app).includes("Reader line 0") && screen(app).includes("↑↓/PgUp/PgDn滚动"),
    );
    expect(screen(app)).toContain("Echo an authorized message");
    app.stdin.write("\x1b[6~");
    await app.flush();
    app.stdin.write("\x1b[6~".repeat(2));
    await app.waitFor(
      () => screen(app).includes("输入参数 JSON Schema") && !screen(app).includes("Reader line 0"),
    );
    const beforeChallenge = discoveries(server);
    server.requireMoreScopes();
    await Promise.resolve();
    app.calls[1]!.tool("mcp__srv__echo", { text: "needs expanded scope" });
    await app.waitFor(() => app.calls.length === 3 && screen(app).includes("已返回有效页面"));
    expect(screen(app)).toContain("配置来源: 用户");
    expect(screen(app)).toContain(`URL: ${server.url}`);
    expect(screen(app)).not.toContain("状态: 需要授权");
    expect(screen(app)).toContain("操作 · ↑↓ Enter");
    expect(screen(app)).not.toContain("❯ 登录");
    expect(screen(app)).not.toContain("输入参数 JSON Schema");
    expect(screen(app)).not.toContain("查看工具");
    expect(discoveries(server)).toBe(beforeChallenge);
    expect(app.calls[2]!.context.messages.findLast((m) => m.role === "toolResult")).toMatchObject({
      isError: true,
    });
    app.calls[2]!.tool("mcp__srv__authenticate", {});
    await app.waitFor(() => opened.length === 2 && screen(app).includes("复制授权链接"));
    expect(new URL(opened[1]!).searchParams.get("scope")).toBe("tools tools:write");
    await callback(app, opened[1]!);
    await app.waitFor(() => app.calls.length === 4 && screen(app).includes("查看工具"));
    expect(discoveries(server)).toBe(beforeChallenge + 1);
    app.calls[3]!.delta("same Run completed");
    app.calls[3]!.finish();
    await app.waitFor(() => idle(app) && screen(app).includes("same Run completed"));
    expect(app.calls).toHaveLength(4);
    expect(discoveries(server)).toBe(beforeChallenge + 1);
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test("permission, questions and OAuth take FIFO ownership while a scrolled MCP reader is retained", async () => {
  const server = mcpOAuthServer({
    authentication: false,
    tools: [
      {
        name: "echo",
        description: Array.from({ length: 24 }, (_, i) => `Stable reader ${i}`).join("\n"),
        inputSchema: { type: "object" },
      },
    ],
  });
  const oauth = mcpOAuthServer();
  const opened: string[] = [];
  const app = await start(["mixed interactions"], {
    rows: 32,
    prepare: (root) =>
      Bun.write(
        join(root, ".rukie/mcp.json"),
        JSON.stringify({ mcpServers: { alpha: { url: server.url }, oauth: { url: oauth.url } } }),
      ).then(() => {}),
    host: {
      openExternal: async (url) => {
        opened.push(url);
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("❯ alpha · 已连接"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("❯ 查看工具"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("alpha 的工具（1）"));
    app.stdin.write("\r");
    await app.waitFor(
      () => screen(app).includes("Stable reader 0") && screen(app).includes("↑↓/PgUp/PgDn滚动"),
    );
    app.stdin.write("\x1b[6~");
    await app.waitFor(() => screen(app).includes("Stable reader 12"));
    const readerLines = app.screen().filter((line) => line.includes("Stable reader"));
    const listRequests = discoveries(server);
    app.calls[0]!.tools([
      {
        name: "bash",
        args: { command: "printf mixed-permission", description: "Verify mixed permission FIFO" },
      },
      {
        name: "ask_user_question",
        args: {
          questions: [
            {
              header: "Parent",
              question: "Parent FIFO question?",
              options: [
                { label: "Yes", description: "Accept" },
                { label: "No", description: "Decline" },
              ],
            },
          ],
        },
      },
      { name: "mcp__oauth__authenticate", args: {} },
    ]);
    await app.waitFor(() => app.screen().some((line) => line.trim() === "printf mixed-permission"));
    expect(screen(app)).not.toContain("Stable reader");
    expect(opened).toHaveLength(0);
    app.stdin.write("3\r");
    await app.waitFor(() => screen(app).includes("Parent FIFO question?"));
    expect(screen(app)).not.toContain("Stable reader");
    expect(screen(app)).not.toContain("复制授权链接");
    app.stdin.write("\r");
    await app.waitFor(() => opened.length === 1 && screen(app).includes("复制授权链接"));
    expect(screen(app)).toContain("Parent FIFO question? → Yes");
    expect(screen(app)).not.toContain("Stable reader");
    await callback(app, opened[0]!);
    await app.waitFor(() => app.calls.length === 2 && screen(app).includes("Stable reader 12"));
    expect(app.screen().filter((line) => line.includes("Stable reader"))).toEqual(readerLines);
    expect(discoveries(server)).toBe(listRequests);
    app.calls[1]!.tool("subagent", { description: "FIFO child", prompt: "child FIFO marker" });
    await app.waitFor(() => app.calls.length >= 4);
    const child = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("child FIFO marker"),
      ),
    );
    expect(child).toBeDefined();
    child!.tool("ask_user_question", {
      questions: [
        {
          header: "Child",
          question: "Child FIFO question?",
          options: [
            { label: "Proceed", description: "Accept" },
            { label: "Stop", description: "Decline" },
          ],
        },
      ],
    });
    await app.waitFor(() => screen(app).includes("Child FIFO question?"));
    expect(screen(app)).not.toContain("Stable reader");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length >= 5 && screen(app).includes("Stable reader 12"));
    expect(app.screen().filter((line) => line.includes("Stable reader"))).toEqual(readerLines);
    app.stdin.write("\x03");
    await app.waitFor(() => idle(app) && !screen(app).includes("Stable reader"));
  } finally {
    await app.cleanup();
    await server.stop();
    await oauth.stop();
  }
});

test("a real Goal round removes a server and retreats to the list without selecting another server", async () => {
  const server = mcpOAuthServer({ authentication: false });
  const app = await start([], {
    rows: 32,
    session: { permissionMode: "full-access" },
    prepare: (root) =>
      Bun.write(
        join(root, ".rukie/mcp.json"),
        JSON.stringify({ mcpServers: { keep: { url: server.url }, removed: { url: server.url } } }),
      ).then(() => {}),
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/goal inspect server lifecycle\r");
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("❯ keep · 已连接"));
    app.stdin.write(down + "\r");
    await app.waitFor(() => screen(app).includes("❯ 查看工具"));
    app.stdin.write("\t\x1b[6~");
    await app.waitFor(
      () => screen(app).includes("授权方式:") && !screen(app).includes("状态: 已连接"),
    );
    app.stdin.write("\t\r");
    await app.waitFor(() => screen(app).includes("removed 的工具（1）"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("输入参数 JSON Schema"));
    await Bun.write(
      join(app.root, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { keep: { url: server.url } } }),
    );
    await Promise.resolve();
    app.calls[0]!.finish();
    await app.waitFor(() => app.calls.length === 2 && screen(app).includes("管理 MCP 服务器（1）"));
    expect(screen(app)).toContain("已返回有效页面");
    expect(screen(app)).toContain("keep · 已连接");
    expect(screen(app)).not.toContain("❯ keep");
    expect(screen(app)).not.toContain("removed 的工具");
    expect(screen(app)).not.toContain("输入参数 JSON Schema");
    app.stdin.write("\r");
    await app.flush();
    expect(screen(app)).toContain("管理 MCP 服务器（1）");
    app.stdin.write(down);
    await app.waitFor(() => screen(app).includes("❯ keep · 已连接"));
    app.calls[1]!.tool("update_goal", { action: "complete" });
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.delta("goal complete sentinel");
    app.calls[2]!.finish();
    await app.waitFor(() => idle(app) && screen(app).includes("goal complete sentinel"));
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test("failed OAuth management reports its result in the retained detail and leaves callback input usable", async () => {
  const server = mcpOAuthServer({ authorizationError: "invalid_scope" });
  const opened: string[] = [];
  const app = await start([], {
    rows: 32,
    prepare: (root) =>
      Bun.write(
        join(root, ".rukie/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
      ).then(() => {}),
    host: {
      openExternal: async (url) => {
        opened.push(url);
      },
    },
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("❯ srv · 需要授权"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("❯ 登录"));
    app.stdin.write("\r");
    await app.waitFor(() => opened.length === 1 && screen(app).includes("复制授权链接"));
    await callback(app, opened[0]!);
    await app.waitFor(
      () => screen(app).includes("invalid_scope") && screen(app).includes("❯ 登录"),
    );
    expect(screen(app)).not.toContain("复制授权链接");
    expect(screen(app)).not.toContain("正在处理");
    expect(app.calls).toHaveLength(0);
    const redirect = new URL(opened[0]!).searchParams.get("redirect_uri")!;
    await expect(fetch(redirect)).rejects.toThrow();
    app.stdin.write("\x03");
    await app.waitFor(() => !screen(app).includes("操作 · ↑↓ Enter"));
    app.stdin.write("after failed management\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(
      app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({ content: [{ type: "text", text: "after failed management" }] });
    app.calls[0]!.finish();
    await app.waitFor(() => idle(app));
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test("exiting an open tool reader restores the terminal and Resume keeps the Transcript without panel state", async () => {
  const server = mcpOAuthServer({
    authentication: false,
    tools: [
      {
        name: "private_tool",
        description: "Local panel description sentinel",
        inputSchema: { type: "object", properties: { panel_schema_sentinel: { type: "string" } } },
      },
    ],
  });
  const argv: string[] = [];
  let id = "";
  let store: ReturnType<typeof createJsonlStore>;
  let before: string;
  const app = await start(argv, {
    rows: 32,
    prepare: async (root) => {
      await Bun.write(
        join(root, ".rukie/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
      );
      const fake = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: Infinity });
      fake.setResponses([fauxAssistantMessage("stored answer sentinel")]);
      store = createJsonlStore({ cwd: root, homeDir: root });
      const session = await createSession({
        cwd: root,
        homeDir: root,
        store,
        model: fake.getModel(),
        models: auxiliaryModels(fake.provider.streamSimple),
      });
      try {
        await session.run("stored prompt sentinel");
        id = session.id;
        before = JSON.stringify(
          session.messages.filter((message) =>
            ["user", "assistant", "toolResult"].includes(message.role),
          ),
        );
        argv.push("--resume", id);
      } finally {
        await session.close();
      }
    },
  });
  try {
    await app.waitFor(
      () =>
        screen(app).includes("stored answer sentinel") &&
        app.screen().some((line) => line.startsWith("╭")),
    );
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("❯ srv · 已连接"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("❯ 查看工具"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("srv 的工具（1）"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("输入参数 JSON Schema"));
    expect(screen(app)).toContain("panel_schema_sentinel");
    app.stdin.write("\x04");
    expect(await app.exit).toBe(0);
    await app.flush();
    expect(app.stdin.isRaw).toBe(false);
    expect(app.terminal.buffer.active.type).toBe("normal");
    for (const mode of ["\x1b[?1002l", "\x1b[?1003l", "\x1b[?1006l", "\x1b[?2004l", "\x1b[?25h"])
      expect(app.output()).toContain(mode);
    const resumed = await createSession({
      cwd: app.root,
      homeDir: app.root,
      model: app.model,
      models: app.models,
      resumeId: id,
    });
    try {
      expect(
        JSON.stringify(
          resumed.messages.filter((message) =>
            ["user", "assistant", "toolResult"].includes(message.role),
          ),
        ),
      ).toBe(before!);
      expect(resumed.messages.findLast((message) => message.role === "user")).toMatchObject({
        content: [{ type: "text", text: "stored prompt sentinel" }],
      });
    } finally {
      await resumed.close();
    }
    const replay = await start(["--resume", id], {
      session: { cwd: app.root, homeDir: app.root },
      rows: 32,
    });
    try {
      await replay.waitFor(
        () =>
          screen(replay).includes("stored answer sentinel") &&
          replay.screen().some((line) => line.startsWith("╭")),
      );
      expect(screen(replay)).not.toContain("管理 MCP 服务器");
      expect(screen(replay)).not.toContain("输入参数 JSON Schema");
      replay.stdin.write("after Resume\r");
      await replay.waitFor(() => replay.calls.length === 1);
      expect(
        replay.calls[0]!.context.messages.filter(
          (message) => message.role === "user" && JSON.stringify(message.content).includes("/mcp"),
        ),
      ).toEqual([]);
      replay.calls[0]!.delta("resumed complete sentinel");
      replay.calls[0]!.finish();
      await replay.waitFor(
        () => idle(replay) && screen(replay).includes("resumed complete sentinel"),
      );
    } finally {
      await replay.cleanup();
    }
  } finally {
    await app.cleanup();
    await server.stop();
  }
});
