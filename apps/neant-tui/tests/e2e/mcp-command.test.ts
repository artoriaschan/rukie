import { expect, test } from "bun:test";
import { start } from "../helpers/app";
import { dark } from "@neant/tui";
import { join } from "node:path";
import { createSession } from "@neant/agent";
import { createFauxCore } from "@earendil-works/pi-ai";

// Runtime fixture API belongs to Agent Core's separate test project.
const {
  mcpOAuthServer,
}: {
  mcpOAuthServer(options?: { authentication?: boolean; beforeInitialize?: () => Promise<void> }): {
    url: string;
    stop(): Promise<void>;
  };
} = await import(
  new URL("../../../../packages/agent/tests/helpers/mcp-oauth-server.ts", import.meta.url).href
);

const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");

test("/mcp probes without a model and renders a local empty report in dsh style", async () => {
  const app = await start([], { rows: 32 });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("正在读取 MCP 状态"));
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("没有配置 MCP 服务器"));
    expect(screen(app)).toContain("~/.neant/mcp.json");
    expect(screen(app)).toContain(".mcp.json");
    expect(app.calls).toHaveLength(0);
    const heading = app.screen().findLastIndex((line) => line.includes("! /mcp"));
    expect(app.terminal.buffer.active.getLine(heading)!.getCell(0)!.getFgColor()).toBe(
      parseInt(dark.bashBorder.slice(1), 16),
    );
    expect(app.screen()[heading + 1]).toBe("  没有配置 MCP 服务器");
    expect(
      app.terminal.buffer.active
        .getLine(heading + 1)!
        .getCell(2)!
        .isDim(),
    ).toBeTruthy();
    app.stdin.write("normal prompt\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(JSON.stringify(app.calls[0]!.context.messages)).not.toContain("没有配置 MCP 服务器");
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("the first frontend report uses an already recorded Run snapshot without loading", async () => {
  const app = await start(["work"], { rows: 32 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("没有配置 MCP 服务器"));
    expect(screen(app)).not.toContain("正在读取 MCP 状态");
    expect(app.calls).toHaveLength(1);
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("a late status probe cannot write a report or error into a replaced Session", async () => {
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
        JSON.stringify({ mcpServers: { public: { url: server.url } } }),
      ).then(() => {}),
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/mcp\r");
    await app.waitFor(() => probing && screen(app).includes("正在读取 MCP 状态"));
    app.stdin.write("/clear\r");
    await app.waitFor(() => !screen(app).includes("! /mcp"));
    gate.resolve();
    await gate.promise;
    await app.flush();
    expect(screen(app)).not.toContain("mcp 失败");
    expect(screen(app)).not.toContain("! /mcp");
    expect(app.calls).toHaveLength(0);
  } finally {
    gate.resolve();
    await app.cleanup();
    await server.stop();
  }
});

test("the first report after model authentication reads the current Run snapshot", async () => {
  const server = mcpOAuthServer();
  let url = "";
  const app = await start([], {
    rows: 48,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { notion: { url: server.url } } }),
      ).then(() => {}),
    host: {
      openExternal: async (target) => {
        url = target;
      },
    },
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("正在读取 MCP 状态"));
    app.stdin.write("/mcp login ");
    await app.waitFor(() => screen(app).includes("❯ notion"));
    app.stdin.write("\x03/mcp\r");
    await app.waitFor(() => screen(app).includes("notion · needs-auth"));
    app.stdin.write("work\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("mcp__notion__authenticate", {});
    await app.waitFor(() => url !== "" && screen(app).includes("复制授权链接"));
    await fetch(url);
    await app.waitFor(() => app.calls.length === 2 && screen(app).includes("已登录 MCP"));
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("notion · connected · 1 个工具"));
    expect(app.calls).toHaveLength(2);
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test.each(["zh_CN.UTF-8", "en_US.UTF-8"])(
  "/mcp usage and busy controls stay local while reports work during a Run (%s)",
  async (lang) => {
    const app = await start(["work"], { rows: 40, env: { LANG: lang } });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.stdin.write("/mcp\r");
      await app.waitFor(() =>
        screen(app).includes(lang.startsWith("zh") ? "没有配置 MCP" : "No MCP servers configured"),
      );
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
    await app.waitFor(() => screen(app).includes("Reading MCP status"));
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

test("/mcp keeps pending probes local and reports connected, needs-auth and failed servers", async () => {
  const gate = Promise.withResolvers<void>();
  let probing = false;
  const connected = mcpOAuthServer({
    authentication: false,
    beforeInitialize: async () => {
      probing = true;
      await gate.promise;
    },
  });
  const auth = mcpOAuthServer();
  const app = await start([], {
    rows: 40,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({
          mcpServers: {
            public: { url: connected.url },
            notion: { url: auth.url },
            broken: { url: "http://127.0.0.1:1/mcp" },
          },
        }),
      ).then(() => {}),
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/mcp\r");
    await app.waitFor(() => probing && screen(app).includes("正在读取 MCP 状态"));
    app.stdin.write("/mcp\r");
    expect(app.calls).toHaveLength(0);
    gate.resolve();
    app.stdin.write("/mcp login no");
    await app.waitFor(() => screen(app).includes("❯ notion"));
    app.stdin.write("\x03/mcp\r");
    await app.waitFor(() => screen(app).includes("notion · needs-auth"));
    expect(screen(app)).toContain("MCP 服务器（3）");
    expect(screen(app)).toContain("public · connected · 1 个工具");
    expect(screen(app)).toContain("broken · failed · 0 个工具");
    expect(screen(app)).toContain("需要授权的服务器请运行 /mcp login <服务器>");
    expect(app.calls).toHaveLength(0);
  } finally {
    gate.resolve();
    await app.cleanup();
    await connected.stop();
    await auth.stop();
  }
});

test.each(["zh_CN.UTF-8", "en_US.UTF-8"])(
  "local MCP reports wrap at 40×12, survive resize and are absent after resume (%s)",
  async (lang) => {
    const argv: string[] = [];
    let id = "";
    const app = await start(argv, {
      columns: 40,
      rows: 12,
      env: { LANG: lang },
      prepare: async (root) => {
        const faux = createFauxCore({ api: "faux", provider: "faux" });
        const seed = await createSession({
          cwd: root,
          homeDir: root,
          model: faux.getModel(),
          streamFn: faux.streamSimple,
        });
        id = seed.id;
        argv.push("--resume", id);
        await seed.dispose();
      },
    });
    try {
      await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
      app.stdin.write("/mcp\r");
      await app.waitFor(() => screen(app).includes("! /mcp"));
      app.stdin.write("/mcp\r");
      await app.waitFor(() =>
        screen(app).includes(lang.startsWith("zh") ? "没有配置 MCP" : "No MCP servers"),
      );
      expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
      app.resize(80, 32);
      await app.waitFor(() => screen(app).includes("~/.neant/mcp.json"));
      const replay = await start(["--resume", id], {
        session: { cwd: app.root, homeDir: app.root },
        env: { LANG: lang },
      });
      try {
        await replay.waitFor(() => replay.screen().some((line) => line.startsWith("╭")));
        expect(screen(replay)).not.toContain("! /mcp");
        expect(replay.calls).toHaveLength(0);
      } finally {
        await replay.cleanup();
      }
    } finally {
      await app.cleanup();
    }
  },
);

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

test("idle MCP commands authorize in the shared panel, then logout and reconnect refresh reports", async () => {
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
    await app.waitFor(() => screen(app).includes("notion · connected · 1 个工具"));
    app.stdin.write("/mcp logout notion\r");
    await app.waitFor(() => screen(app).includes("已登出 MCP 服务器 notion"));
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("notion · needs-auth · 0 个工具"));
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
    await app.waitFor(() => screen(app).includes("正在读取 MCP 状态"));
    app.stdin.write("/mcp\r");
    await app.waitFor(() => screen(app).includes("MCP 配置文件"));
    expect(screen(app)).not.toContain("没有配置 MCP 服务器");
    expect(screen(app)).toContain("MCP 配置文件");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});
