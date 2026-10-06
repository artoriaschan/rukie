import { expect, test } from "bun:test";
import { join } from "node:path";
import { start } from "../helpers/app";
const { mcpOAuthServer }: { mcpOAuthServer(): { url: string; stop(): Promise<void> } } =
  await import(
    new URL("../../../../packages/agent/tests/helpers/mcp-oauth-server.ts", import.meta.url).href
  );
const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");
test("MCP completion lists controls and the most recent server names, keeping command selection semantics", async () => {
  const server = mcpOAuthServer();
  const app = await start([], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { notion: { url: server.url } } }),
      ).then(() => {}),
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/mcp ");
    await app.waitFor(() => screen(app).includes("❯ login"));
    expect(screen(app)).toContain("Sign in to an MCP server");
    expect(screen(app)).toContain("logout");
    expect(screen(app)).toContain("reconnect");
    app.stdin.write("\t");
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ /mcp login")));
    expect(app.calls).toHaveLength(0);
    app.stdin.write("\x03/mcp\r");
    await app.waitFor(() => screen(app).includes("❯ notion · needs auth"));
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen(app).includes("Manage MCP servers"));
    app.stdin.write("/mcp login ");
    await app.waitFor(() => screen(app).includes("❯ notion") && screen(app).includes("MCP server"));
    app.stdin.write("\t");
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ /mcp login notion")));
    expect(app.calls).toHaveLength(0);
    app.stdin.write("\x03/help\r");
    await app.waitFor(() => screen(app).includes("/mcp [login|logout|reconnect <server>]"));
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test("idle login cancellation and callback errors show result notices without a model", async () => {
  const server = mcpOAuthServer();
  const app = await start([], {
    rows: 32,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { notion: { url: server.url } } }),
      ).then(() => {}),
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/mcp login notion\r");
    await app.waitFor(() => screen(app).includes("复制授权链接"));
    app.stdin.write("\x1b");
    await app.waitFor(() => screen(app).includes("已取消 MCP 授权"));
    app.stdin.write("/mcp login notion\r");
    await app.waitFor(() => screen(app).includes("复制授权链接"));
    app.stdin.write("\x1b[200~http://localhost/callback?code=bad&state=wrong\x1b[201~\r");
    await app.waitFor(() => screen(app).includes("mcp 失败"));
    expect(screen(app)).not.toContain("复制授权链接");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test("idle MCP commands authorize, logout and reconnect with current panel snapshots", async () => {
  const server = mcpOAuthServer();
  let authorizationUrl = "";
  const app = await start([], {
    rows: 40,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { notion: { url: server.url } } }),
      ).then(() => {}),
    host: {
      openExternal: async (url) => {
        authorizationUrl = url;
      },
    },
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/mcp login notion\r");
    await app.waitFor(() => authorizationUrl !== "" && screen(app).includes("复制授权链接"));
    expect(app.calls).toHaveLength(0);
    await fetch(authorizationUrl);
    await app.waitFor(() => screen(app).includes("已登录 MCP 服务器 notion"));
    expect(screen(app)).not.toContain("复制授权链接");
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("notion · 已连接 · 1 个工具"));
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen(app).includes("管理 MCP 服务器"));
    app.stdin.write("/mcp logout notion\r");
    await app.waitFor(() => screen(app).includes("已登出 MCP 服务器 notion"));
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("notion · 需要授权 · 0 个工具"));
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen(app).includes("管理 MCP 服务器"));
    app.stdin.write("/mcp reconnect notion\r");
    await app.waitFor(() => screen(app).includes("已重新连接 MCP 服务器 notion"));
    app.stdin.write("/mcp login missing\r");
    await app.waitFor(() => screen(app).includes("mcp 失败") && screen(app).includes("missing"));
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test.each(["zh_CN.UTF-8", "en_US.UTF-8"])(
  "known MCP probe failures are localized in Run and management notices (%s)",
  async (lang) => {
    const zh = lang.startsWith("zh");
    const reason = zh
      ? "MCP 配置中的 OAuth 授权元数据必须使用有效的 HTTPS URL。"
      : "Invalid MCP configuration: /oauth/authServerMetadataUrl must be an HTTPS URL.";
    const app = await start(["work"], {
      columns: 160,
      rows: 40,
      env: { LANG: lang },
      prepare: (root) =>
        Bun.write(
          join(root, ".neant/mcp.json"),
          JSON.stringify({
            mcpServers: {
              notion: {
                url: "http://127.0.0.1:1/mcp",
                oauth: { authServerMetadataUrl: "http://127.0.0.1:1/metadata" },
              },
            },
          }),
        ).then(() => {}),
    });
    try {
      await app.waitFor(() => app.calls.length === 1 && screen(app).includes(reason));
      if (zh) expect(screen(app)).not.toContain("Invalid MCP configuration:");
      app.calls[0]!.finish();
      await app.waitFor(() => !app.isWorking());
      app.stdin.write("/mcp login notion\r");
      await app.waitFor(() => screen(app).includes(zh ? "mcp 失败" : "mcp failed"));
      expect(screen(app)).toContain(reason);
      expect(app.calls).toHaveLength(1);
    } finally {
      await app.cleanup();
    }
  },
);

test("/mcp exposes malformed file diagnostics instead of reporting an empty configuration", async () => {
  const app = await start([], {
    rows: 32,
    prepare: (root) => Bun.write(join(root, ".neant/mcp.json"), '{"other":{}}').then(() => {}),
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/mcp\r");

    await app.waitFor(() => screen(app).includes("MCP 配置文件"));
    expect(screen(app)).not.toContain("没有配置 MCP 服务器");
    expect(screen(app)).toContain("MCP 配置文件");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test.each(["zh_CN.UTF-8", "en_US.UTF-8"])(
  "parameter command usage and Run busy remain local (%s)",
  async (lang) => {
    const app = await start(["work"], { rows: 40, env: { LANG: lang } });
    try {
      await app.waitFor(() => app.calls.length === 1);
      for (const action of ["login", "logout", "reconnect"]) {
        app.stdin.write(`/mcp ${action} unknown\r`);
        await app.waitFor(() =>
          screen(app).includes(
            lang.startsWith("zh") ? "run 结束后再用 /mcp" : "Use /mcp after the run finishes",
          ),
        );
      }
      expect(app.calls).toHaveLength(1);
      expect(app.calls[0]!.signal!.aborted).toBe(false);
      app.calls[0]!.finish();
      await app.waitFor(() => !app.isWorking());
      app.stdin.write("/mcp login\r");
      await app.waitFor(() =>
        screen(app).includes(lang.startsWith("zh") ? "用法：/mcp" : "Usage: /mcp"),
      );
      expect(app.calls).toHaveLength(1);
    } finally {
      await app.cleanup();
    }
  },
);
