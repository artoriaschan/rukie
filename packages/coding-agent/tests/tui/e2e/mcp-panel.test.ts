import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dark } from "../../../src/ink/index.ts";
import { start } from "../helpers/app";

const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");

test("/mcp opens automatically and locks every main input path until closed", async () => {
  const app = await start([], { rows: 32 });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/mcp\r");
    await app.waitFor(
      () => screen(app).includes("管理 MCP 服务器（0）") && screen(app).includes("没有配置 MCP"),
    );
    app.stdin.write("blocked\r\x1b[200~pasted\x1b[201~\x1b[A\t\x16");
    await app.flush();
    expect(app.calls).toHaveLength(0);
    expect(screen(app)).not.toContain("blocked");
    expect(screen(app)).not.toContain("pasted");
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen(app).includes("管理 MCP 服务器"));
    app.stdin.write("normal prompt\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(JSON.stringify(app.calls[0]!.context.messages)).not.toContain("MCP 服务器");
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

// Agent Core owns this real protocol fixture; the TUI consumes its external API.
const {
  mcpOAuthServer,
}: {
  mcpOAuthServer(options?: {
    authentication?: boolean;
    tools?: { name: string; description?: string; inputSchema: Record<string, unknown> }[];
    beforeInitialize?: () => Promise<void>;
  }): {
    url: string;
    requests: { body: unknown }[];
    stop(): Promise<void>;
  };
} = await import(
  new URL("../../../../agent/tests/helpers/mcp-oauth-server.ts", import.meta.url).href
);
const down = "\x1b[B";
const up = "\x1b[A";
const esc = "\x1b";
const pageDown = "\x1b[6~";
const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;
const ready = (app: Awaited<ReturnType<typeof start>>) =>
  app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));

test("four levels preserve raw delimiter names, selections and schema reading position", async () => {
  const server = mcpOAuthServer({
    authentication: false,
    tools: [
      {
        name: "a:tool__one",
        description: "Full first tool description",
        inputSchema: {
          type: "object",
          properties: Object.fromEntries(
            Array.from({ length: 18 }, (_, i) => [
              `field${i}`,
              { type: "string", description: `Schema field ${i}` },
            ]),
          ),
        },
      },
      { name: "z:tool__two", description: "Second tool", inputSchema: { type: "object" } },
    ],
  });
  const app = await start([], {
    rows: 32,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { "server:raw__name": { url: server.url } } }),
      ).then(() => {}),
  });
  try {
    await ready(app);
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("❯ server:raw__name · 已连接"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("❯ 查看工具"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("server:raw__name 的工具（2）"));
    expect(screen(app)).toContain("❯ a:tool__one");
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("输入参数 JSON Schema"));
    expect(screen(app)).toContain("Full first tool description");
    app.stdin.write(pageDown.repeat(3));
    await app.waitFor(() => screen(app).includes('"field4"'));
    const reading = screen(app);
    expect(reading).not.toContain("Full first tool description");
    app.stdin.write(esc);
    await app.waitFor(() => screen(app).includes("❯ a:tool__one"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes('"field4"'));
    expect(screen(app)).not.toContain("Full first tool description");
    app.stdin.write(esc);
    await app.waitFor(() => screen(app).includes("的工具（2）"));
    app.stdin.write(down);
    await app.waitFor(() => screen(app).includes("❯ z:tool__two"));
    app.stdin.write("\r");
    await app.waitFor(
      () => screen(app).includes("Second tool") && screen(app).includes("输入参数"),
    );
    app.stdin.write(esc);
    await app.waitFor(() => screen(app).includes("❯ z:tool__two"));
    app.stdin.write(esc);
    await app.waitFor(() => screen(app).includes("❯ 查看工具"));
    app.stdin.write(esc);
    await app.waitFor(() => screen(app).includes("❯ server:raw__name · 已连接"));
    expect(app.calls).toHaveLength(0);
    expect(
      server.requests.filter((r) => JSON.stringify(r.body)?.includes('"tools/list"')),
    ).toHaveLength(1);
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test("idle management yields to OAuth, blocks duplicate login and restores detail on cancellation", async () => {
  const server = mcpOAuthServer();
  let opened = 0;
  const app = await start([], {
    rows: 32,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { notion: { url: server.url } } }),
      ).then(() => {}),
    host: {
      openExternal: async () => {
        opened++;
      },
    },
  });
  try {
    await ready(app);
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("❯ notion · 需要授权"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("❯ 登录"));
    app.stdin.write("\r");
    await app.waitFor(() => opened === 1 && screen(app).includes("复制授权链接"));
    expect(screen(app)).not.toContain("操作 · ↑↓ Enter");
    app.stdin.write(esc);
    await app.waitFor(
      () => screen(app).includes("已取消 MCP 授权") && screen(app).includes("❯ 登录"),
    );
    expect(opened).toBe(1);
    expect(screen(app)).toContain("notion");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test("configuration retry rereads corrected files and stays open while loading or empty", async () => {
  const app = await start([], {
    rows: 32,
    prepare: (root) => Bun.write(join(root, ".neant/mcp.json"), '{"other":{}}').then(() => {}),
  });
  try {
    await ready(app);
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("配置读取失败"));
    app.stdin.write("blocked" + paste("ignored"));
    await app.flush();
    expect(app.calls).toHaveLength(0);
    await Bun.write(join(app.root, ".neant/mcp.json"), JSON.stringify({ mcpServers: {} }));
    app.stdin.write("\r");
    await app.waitFor(
      () => screen(app).includes("已刷新 MCP 状态") && screen(app).includes("没有配置 MCP"),
    );
    expect(screen(app)).not.toContain("配置读取失败");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("Run browsing is local, management reports busy, and FIFO questions restore the exact tool page", async () => {
  const server = mcpOAuthServer({ authentication: false });
  const app = await start(["work"], {
    rows: 32,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
      ).then(() => {}),
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("❯ srv · 已连接"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("❯ 查看工具"));
    app.stdin.write(down + "\r");
    await app.waitFor(() => screen(app).includes("run 结束后再用 /mcp"));
    expect(app.calls).toHaveLength(1);
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    app.stdin.write(up + "\r");
    await app.waitFor(() => screen(app).includes("srv 的工具（1）"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("输入参数 JSON Schema"));
    app.calls[0]!.tools([
      {
        name: "ask_user_question",
        args: {
          questions: [
            {
              header: "First",
              question: "First queued question?",
              options: [
                { label: "Alpha", description: "First" },
                { label: "Beta", description: "Second" },
              ],
              multiSelect: false,
            },
            {
              header: "Second",
              question: "Second queued question?",
              options: [
                { label: "Gamma", description: "Third" },
                { label: "Delta", description: "Fourth" },
              ],
              multiSelect: false,
            },
          ],
        },
      },
    ]);
    await app.waitFor(() => screen(app).includes("First queued question?"));
    expect(screen(app)).not.toContain("输入参数 JSON Schema");
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("Second queued question?"));
    expect(screen(app)).not.toContain("输入参数 JSON Schema");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 2 && screen(app).includes("输入参数 JSON Schema"));
    expect(screen(app)).toContain("Echo an authorized message");
    app.stdin.write("main-blocked\r" + paste("ignored"));
    await app.flush();
    expect(app.calls).toHaveLength(2);
    expect(screen(app)).not.toContain("main-blocked");
    app.stdin.write("\x03");
    await app.waitFor(
      () => app.calls[1]!.signal!.aborted && !screen(app).includes("输入参数 JSON Schema"),
    );
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test("pending clipboard text and images cannot write into the cleared draft after MCP opens and closes", async () => {
  for (const image of [false, true]) {
    const pending = Promise.withResolvers<import("../../../src/tui/host").ClipboardContent>();
    const read = Promise.withResolvers<void>();
    let path = "";
    const app = await start([], {
      rows: 32,
      prepare: async (root) => {
        path = join(root, "late.png");
        await Bun.write(
          path,
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSf8AAAAASUVORK5CYII=",
            "base64",
          ),
        );
      },
      host: {
        readClipboard: () => {
          read.resolve();
          return pending.promise;
        },
      },
    });
    try {
      await ready(app);
      app.stdin.write("\x16");
      await read.promise;
      app.stdin.write("/mcp\r");
      await app.waitFor(() => screen(app).includes("没有配置 MCP"));
      app.stdin.write(esc);
      await app.waitFor(() => !screen(app).includes("管理 MCP 服务器"));
      pending.resolve(image ? { image: { path } } : { text: "late clipboard" });
      await pending.promise;
      await app.flush();
      app.stdin.write("new draft\r");
      await app.waitFor(() => app.calls.length === 1);
      expect(app.calls[0]!.context.messages.findLast((m) => m.role === "user")).toMatchObject({
        content: [{ type: "text", text: "new draft" }],
      });
      expect(screen(app)).not.toContain("[Image #1]");
      app.calls[0]!.finish();
    } finally {
      pending.resolve({ empty: true });
      await app.cleanup();
    }
  }
});

const mouse = (app: Awaited<ReturnType<typeof start>>, text: string, button: number) => {
  const y = app.screen().findIndex((line) => line.includes(text));
  expect(y).toBeGreaterThanOrEqual(0);
  app.stdin.write(`\x1b[<${button};5;${y + 1}M${button === 0 ? `\x1b[<0;5;${y + 1}m` : ""}`);
};

test("mouse hover does not select, wheel selects, click enters and mouse Back returns one level", async () => {
  const server = mcpOAuthServer({ authentication: false });
  const app = await start([], {
    rows: 32,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { alpha: { url: server.url }, beta: { url: server.url } } }),
      ).then(() => {}),
  });
  try {
    await ready(app);
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("❯ alpha · 已连接"));
    const betaRow = app.screen().findIndex((line) => line.includes("beta · 已连接"));
    mouse(app, "beta · 已连接", 35);
    await app.waitFor(
      () =>
        app.terminal.buffer.active.getLine(betaRow)!.getCell(4)!.getBgColor() ===
        Number.parseInt(dark.badgeHoverBackground.slice(1), 16),
    );
    expect(screen(app)).toContain("❯ alpha · 已连接");
    mouse(app, "beta · 已连接", 65);
    await app.waitFor(() => screen(app).includes("❯ beta · 已连接"));
    const pointerRow = app.screen().findIndex((line) => line.includes("❯ beta · 已连接"));
    expect(app.terminal.buffer.active.getLine(pointerRow)!.getCell(2)!.getFgColor()).toBe(
      Number.parseInt(dark.suggestion.slice(1), 16),
    );
    mouse(app, "alpha · 已连接", 0);
    await app.waitFor(() => screen(app).includes("❯ 查看工具"));
    mouse(app, "查看工具", 0);
    await app.waitFor(() => screen(app).includes("alpha 的工具（1）"));
    mouse(app, "echo", 0);
    await app.waitFor(() => screen(app).includes("输入参数 JSON Schema"));
    mouse(app, "返回", 0);
    await app.waitFor(() => screen(app).includes("alpha 的工具（1）"));
    mouse(app, "返回", 0);
    await app.waitFor(() => screen(app).includes("❯ 查看工具"));
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test.each(["zh_CN.UTF-8", "en_US.UTF-8"])(
  "40x12 keeps meaningful server and action rows; undersize pauses then restores (%s)",
  async (lang) => {
    const server = mcpOAuthServer({ authentication: false });
    const zh = lang.startsWith("zh");
    const app = await start([], {
      columns: 40,
      rows: 12,
      env: { LANG: lang },
      prepare: (root) =>
        Bun.write(
          join(root, ".neant/mcp.json"),
          JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
        ).then(() => {}),
    });
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write("/mcp\r");
      await app.waitFor(() => screen(app).includes(zh ? "❯ srv · 已连接" : "❯ srv · connected"));
      expect(screen(app)).toContain(zh ? "↑↓选择" : "↑↓ Select");
      app.stdin.write("\r");
      await app.waitFor(() => screen(app).includes(zh ? "❯ 查看工具" : "❯ View tools"));
      expect(screen(app)).toContain(zh ? "状态: 已连接" : "Status: connected");
      app.resize(39, 11);
      await app.waitFor(() => !screen(app).includes(zh ? "查看工具" : "View tools"));
      app.stdin.write(down + "\r" + "blocked" + paste("ignored"));
      await app.flush();
      expect(app.calls).toHaveLength(0);
      app.resize(40, 12);
      await app.waitFor(() => screen(app).includes(zh ? "❯ 查看工具" : "❯ View tools"));
      expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
      app.stdin.write("\r");
      await app.waitFor(() => screen(app).includes(zh ? "srv 的工具（1）" : "Tools for srv (1)"));
    } finally {
      await app.cleanup();
      await server.stop();
    }
  },
);

test("a changed snapshot at a microtask boundary preserves valid identities and retreats from a removed tool", async () => {
  const gate = Promise.withResolvers<void>();
  let blocking = false;
  let probing = false;
  const tools = [
    { name: "a:tool", description: "Original first", inputSchema: { type: "object" } },
    { name: "b:tool", description: "Stable second", inputSchema: { type: "object" } },
  ];
  const server = mcpOAuthServer({
    authentication: false,
    tools,
    beforeInitialize: async () => {
      if (blocking) {
        probing = true;
        await gate.promise;
      }
    },
  });
  const app = await start([], {
    rows: 32,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
      ).then(() => {}),
  });
  try {
    await ready(app);
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("❯ srv · 已连接"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("❯ 查看工具"));
    blocking = true;
    app.stdin.write(down + "\r");
    await app.waitFor(() => probing && screen(app).includes("正在处理"));
    app.stdin.write("\r\r"); // Repeated management activation stays a single operation.
    app.stdin.write(up + "\r");
    await app.waitFor(() => screen(app).includes("srv 的工具（2）"));
    app.stdin.write("\r");
    await app.waitFor(
      () => screen(app).includes("Original first") && screen(app).includes("输入参数"),
    );
    tools.splice(0, 1);
    queueMicrotask(() => gate.resolve());
    await app.waitFor(
      () => screen(app).includes("srv 的工具（1）") && screen(app).includes("已返回有效页面"),
    );
    expect(screen(app)).not.toContain("输入参数 JSON Schema");
    expect(screen(app)).not.toContain("❯ b:tool");
    expect(screen(app)).toContain("Stable second");
    expect(
      server.requests.filter((r) => JSON.stringify(r.body)?.includes('"initialize"')),
    ).toHaveLength(2);
    expect(app.calls).toHaveLength(0);
  } finally {
    gate.resolve();
    await app.cleanup();
    await server.stop();
  }
});

test("closing a loading panel and replacing its Session rejects a late probe without reopening", async () => {
  const gate = Promise.withResolvers<void>();
  let probing = false;
  const server = mcpOAuthServer({
    authentication: false,
    beforeInitialize: async () => {
      probing = true;
      await gate.promise;
    },
  });
  const app = await start([], {
    rows: 32,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
      ).then(() => {}),
  });
  try {
    await ready(app);
    app.stdin.write("/help\r");
    await app.waitFor(() => screen(app).includes("/mcp [login|logout|reconnect <server>]"));
    app.stdin.write("/mcp\r");
    await app.waitFor(() => probing && screen(app).includes("正在读取 MCP 状态"));
    app.stdin.write("blocked" + paste("ignored"));
    await app.flush();
    expect(app.calls).toHaveLength(0);
    app.stdin.write(esc);
    await app.waitFor(() => !screen(app).includes("管理 MCP 服务器"));
    app.stdin.write("/clear\r");
    await app.waitFor(
      () =>
        screen(app).includes("❯") &&
        !screen(app).includes("/mcp [login|logout|reconnect <server>]"),
    );
    gate.resolve();
    await gate.promise;
    await app.flush();
    app.stdin.write("fresh owner\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(screen(app)).not.toContain("管理 MCP 服务器");
    expect(app.calls[0]!.context.messages.findLast((m) => m.role === "user")).toMatchObject({
      content: [{ type: "text", text: "fresh owner" }],
    });
    app.calls[0]!.finish();
  } finally {
    gate.resolve();
    await app.cleanup();
    await server.stop();
  }
});

test("40x12 keeps the active MCP operable alongside real Goal, Todo and Subagent previews", async () => {
  const server = mcpOAuthServer({ authentication: false });
  const app = await start([], {
    columns: 40,
    rows: 12,
    env: { LANG: "en_US.UTF-8" },
    session: { permissionMode: "full-access" },
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
      ).then(() => {}),
  });
  try {
    await ready(app);
    app.stdin.write("/goal migrate widgets\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("todo_write", { todos: [{ content: "work item", status: "in_progress" }] });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.tool("subagent", { description: "Live child", prompt: "child task" });
    await app.waitFor(() => app.calls.length === 4);
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("❯ srv · connected"));
    expect(screen(app)).toContain("🎯");
    expect(screen(app)).toContain("✓ 0/1");
    expect(screen(app)).toContain("Subagents 1/1");
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("❯ View tools"));
    expect(screen(app)).toContain("Status: connected");
    expect(screen(app)).toContain("Tab Body");
    app.stdin.write(down + "\r");
    await app.waitFor(() => screen(app).includes("Use /mcp after"));
    expect(screen(app)).toContain("❯ Reconnect");
    for (const preview of ["🎯", "✓ 0/1", "Subagents 1/1"]) expect(screen(app)).toContain(preview);
    app.stdin.write(up);
    await app.waitFor(() => screen(app).includes("❯ View tools"));
    expect(screen(app)).toContain("Use /mcp after");
    mouse(app, "View tools", 0);
    await app.waitFor(() => screen(app).includes("Tools for srv (1)"));
    expect(screen(app)).toContain("❯ echo");
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("↑↓/PgUp/PgDn Read"));
    expect(screen(app)).toContain("Echo an authorized message");
    mouse(app, "Back", 0);
    await app.waitFor(() => screen(app).includes("Tools for srv (1)"));
    app.stdin.write(esc);
    await app.waitFor(() => screen(app).includes("❯ View tools"));
    expect(screen(app)).toContain("Use /mcp after");
    app.resize(60, 20);
    await app.waitFor(() => screen(app).includes("Status: connected"));
    app.stdin.write("\t" + down);
    await app.waitFor(() => screen(app).includes("Transport: http"));
    expect(screen(app)).not.toContain("❯ View tools");
    app.resize(40, 12);
    await app.waitFor(() => screen(app).includes("Tab Actions"));
    app.stdin.write("\t");
    await app.waitFor(() => screen(app).includes("❯ View tools"));
    app.stdin.write(up);
    await app.waitFor(() => screen(app).includes("❯ Back"));
    mouse(app, "Back", 0);
    await app.waitFor(() => screen(app).includes("❯ srv · connected"));
    expect(app.calls).toHaveLength(4);
    expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test.skipIf(process.platform === "win32")(
  "an actual delayed image file read is invalidated on MCP open, even after close",
  async () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSf8AAAAASUVORK5CYII=";
    const app = await start([], {
      rows: 32,
      prepare: async (root) => {
        const fifo = Bun.spawn(["mkfifo", join(root, "pending.png")], {
          stdout: "ignore",
          stderr: "ignore",
        });
        if (await fifo.exited) throw new Error("Could not create image pipe");
        await Bun.write(join(root, "shot.png"), Buffer.from(png, "base64"));
      },
    });
    let released = false;
    const release = async () => {
      if (!released) {
        released = true;
        await writeFile(join(app.root, "pending.png"), Buffer.from(png, "base64"));
      }
    };
    try {
      await ready(app);
      app.stdin.write(paste(join(app.root, "pending.png")) + "/mcp\r");
      await app.waitFor(() => screen(app).includes("没有配置 MCP"));
      app.stdin.write(esc);
      await app.waitFor(() => !screen(app).includes("管理 MCP 服务器"));
      await release();
      app.stdin.write(paste(join(app.root, "shot.png")));
      await app.waitFor(() => screen(app).includes("❯ [Image #1]"));
      app.stdin.write("\r");
      await app.waitFor(() => app.calls.length === 1);
      expect(app.calls[0]!.context.messages.findLast((m) => m.role === "user")).toMatchObject({
        content: [
          { type: "text", text: "[Image #1] " },
          { type: "image", data: png },
        ],
      });
      expect(screen(app)).not.toContain("[Image #2]");
      app.calls[0]!.finish();
    } finally {
      await release();
      await app.cleanup();
    }
  },
);

test("opening and closing MCP preserves the Transcript reading anchor", async () => {
  const app = await start(["history"], { rows: 32 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(
      Array.from(
        { length: 100 },
        (_, i) => `Transcript line ${i.toString().padStart(3, "0")}`,
      ).join("\n"),
    );
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking() && screen(app).includes("Transcript line 099"));
    app.stdin.write("\x1b[5~".repeat(2));
    await app.waitFor(() => screen(app).includes("Transcript line 040"));
    const anchor = app.screen().find((line) => line.includes("Transcript line"))!;
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("没有配置 MCP"));
    expect(app.screen().find((line) => line.includes("Transcript line"))).toBe(anchor);
    app.stdin.write(esc);
    await app.waitFor(() => !screen(app).includes("管理 MCP 服务器"));
    expect(app.screen().find((line) => line.includes("Transcript line"))).toBe(anchor);
    expect(app.calls).toHaveLength(1);
  } finally {
    await app.cleanup();
  }
});

test("OAuth callback paste belongs to the Interaction and successful login returns to the server detail", async () => {
  const server = mcpOAuthServer();
  let authorization = "";
  const app = await start([], {
    rows: 32,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { notion: { url: server.url } } }),
      ).then(() => {}),
    host: {
      openExternal: async (url) => {
        authorization = url;
        throw new Error("browser unavailable");
      },
    },
  });
  try {
    await ready(app);
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("❯ notion · 需要授权"));
    app.stdin.write("\r");
    await app.waitFor(() => screen(app).includes("❯ 登录"));
    app.stdin.write("\r");
    await app.waitFor(() => !!authorization && screen(app).includes("复制授权链接"));
    app.stdin.write("\x01");
    await app.flush();
    expect(screen(app)).toContain("复制授权链接");
    const response = await fetch(authorization, { redirect: "manual" });
    const callback = response.headers.get("location")!;
    app.stdin.write(paste(callback) + "\r");
    await app.waitFor(
      () => screen(app).includes("已登录 MCP 服务器 notion") && screen(app).includes("查看工具"),
    );
    expect(screen(app)).not.toContain("复制授权链接");
    expect(screen(app)).not.toContain("管理 MCP 服务器");
    expect(app.calls).toHaveLength(0);
    app.stdin.write(down + "\r");
    await app.waitFor(() => screen(app).includes("notion 的工具（1）"));
    app.stdin.write(esc);
    await app.waitFor(() => screen(app).includes("已登录 MCP 服务器 notion"));
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test("same-batch opening and Ctrl+C closes MCP and permanently invalidates pending clipboard input", async () => {
  const pending = Promise.withResolvers<import("../../../src/tui/host").ClipboardContent>();
  const reading = Promise.withResolvers<void>();
  const app = await start([], {
    rows: 32,
    host: {
      readClipboard: () => {
        reading.resolve();
        return pending.promise;
      },
    },
  });
  try {
    await ready(app);
    app.stdin.write("\x16");
    await reading.promise;
    app.stdin.write("/mcp\r\x03");
    await app.waitFor(() => app.screen().includes("❯") && !screen(app).includes("管理 MCP 服务器"));
    pending.resolve({ text: "late input" });
    await pending.promise;
    app.stdin.write("accepted\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(app.calls[0]!.context.messages.findLast((m) => m.role === "user")).toMatchObject({
      content: [{ type: "text", text: "accepted" }],
    });
    expect(screen(app)).not.toContain("管理 MCP 服务器");
    app.calls[0]!.finish();
  } finally {
    pending.resolve({ empty: true });
    await app.cleanup();
  }
});
