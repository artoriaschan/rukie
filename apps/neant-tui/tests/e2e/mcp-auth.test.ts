import { startWithClock } from "../helpers/clock-app";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { start } from "../helpers/app";

// The fixture belongs to Agent Core's test project; load its owned runtime API across project roots.
const {
  mcpOAuthServer,
}: {
  mcpOAuthServer: (options?: { authorizationError?: string }) => {
    url: string;
    stop(): Promise<void>;
  };
} = await import(
  new URL("../../../../packages/agent/tests/helpers/mcp-oauth-server.ts", import.meta.url).href
);

test("model authentication opens the shared question panel and copy/reopen keep it active", async () => {
  const server = mcpOAuthServer();
  const opened: string[] = [];
  const copied: string[] = [];
  const app = await start(["login"], {
    rows: 40,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
      ).then(() => {}),
    host: {
      openExternal: async (url) => {
        opened.push(url);
      },
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("mcp__srv__authenticate", {});
    await app.waitFor(() => app.screen().some((line) => line.includes("复制授权链接")));
    expect(app.screen().join("\n")).toContain("◈ srv");
    expect(app.screen().join("\n")).toContain("MCP 服务器 srv 需要授权");
    expect(opened).toHaveLength(1);
    app.stdin.write("\r");
    await app.waitFor(() => app.screen().some((line) => line.includes("已复制")));
    expect(copied).toEqual(opened);
    expect(app.calls).toHaveLength(1);
    app.stdin.write("\x1b[B\r");
    await app.waitFor(
      () =>
        opened.length === 2 && app.screen().some((line) => line.includes("已在浏览器重新打开。")),
    );
    expect(opened[1]).toBe(opened[0]);
    expect(app.calls).toHaveLength(1);
    await fetch(opened[0]!);
    await app.waitFor(
      () =>
        app.calls.length === 2 &&
        app.screen().some((line) => line.includes("已登录 MCP 服务器 srv")),
    );
    expect(app.screen().join("\n")).not.toContain("复制授权链接");
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test.each(["zh_CN.UTF-8", "en_US.UTF-8"])(
  "OAuth URLs wrap and remain accessible at 40×12 and after resize (%s)",
  async (lang) => {
    const server = mcpOAuthServer();
    const opened: string[] = [];
    const app = await start(["login"], {
      columns: 40,
      rows: 12,
      env: { LANG: lang },
      prepare: (root) =>
        Bun.write(
          join(root, ".neant/mcp.json"),
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
      app.calls[0]!.tool("mcp__srv__authenticate", {});
      await app.waitFor(
        () => opened.length === 1 && app.screen().some((line) => line.includes("◈ srv")),
      );
      expect(app.screen().join("\n")).not.toMatch(/[🌑🌒🌓🌔🌕🌖🌗🌘]/u);
      for (let page = 0; page < 15 && !app.screen().join("\n").includes("client_id"); page++) {
        const before = app.screen().join("\n");
        app.stdin.write("\x1b[6~");
        await app.waitFor(() => app.screen().join("\n") !== before);
      }
      expect(app.screen().join("\n")).toContain("client_id");
      expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
      app.resize(80, 32);
      app.stdin.write("\x1b[5~".repeat(15));
      await app.waitFor(() =>
        app
          .screen()
          .join("\n")
          .includes(lang.startsWith("zh") ? "授权页面已在浏览器" : "Authorization page opened"),
      );
      app.stdin.write("\x1b");
      await app.waitFor(
        () =>
          app.calls.length === 2 &&
          app
            .screen()
            .join("\n")
            .includes(lang.startsWith("zh") ? "已取消 MCP 授权" : "MCP authorization cancelled"),
      );
      app.calls[1]!.finish();
    } finally {
      await app.cleanup();
      await server.stop();
    }
  },
);

test("failed browser/clipboard helpers keep manual authorization and callback paste usable", async () => {
  const server = mcpOAuthServer();
  const opened: string[] = [];
  const copied: string[] = [];
  const app = await start(["login"], {
    rows: 40,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
      ).then(() => {}),
    host: {
      openExternal: async (url) => {
        opened.push(url);
        throw new Error("browser unavailable");
      },
      writeClipboard: async (text) => {
        copied.push(text);
        return false;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("mcp__srv__authenticate", {});
    await app.waitFor(() => app.screen().join("\n").includes("打开以下 URL 完成授权"));
    expect(app.screen().join("\n")).toContain("链接较长");
    app.stdin.write("\r");
    await app.waitFor(() => app.screen().join("\n").includes("复制失败"));
    expect(copied).toEqual([opened[0]!]);
    app.stdin.write("\x1b[B\r");
    await app.waitFor(() => app.screen().join("\n").includes("无法打开浏览器"));
    expect(opened).toHaveLength(2);
    const response = await fetch(opened[0]!, { redirect: "manual" });
    const callback = response.headers.get("location")!;
    app.stdin.write(`\x1b[200~${callback}\x1b[201~\r`);
    await app.waitFor(
      () => app.calls.length === 2 && app.screen().join("\n").includes("已登录 MCP 服务器 srv"),
    );
    expect(
      app.calls[1]!.context.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({ isError: false, details: { type: "authenticated", server: "srv" } });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test.each(["cancel", "state"])(
  "auth %s shows an outcome notice and the Run continues",
  async (mode) => {
    const server = mcpOAuthServer();
    const app = await start(["login"], {
      rows: 32,
      prepare: (root) =>
        Bun.write(
          join(root, ".neant/mcp.json"),
          JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
        ).then(() => {}),
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("mcp__srv__authenticate", {});
      await app.waitFor(() => app.screen().join("\n").includes("取消登录"));
      app.stdin.write(
        mode === "cancel"
          ? "\x1b[B\x1b[B\r"
          : "\x1b[200~http://localhost/callback?code=bad&state=wrong\x1b[201~\r",
      );
      await app.waitFor(
        () =>
          app.calls.length === 2 &&
          app
            .screen()
            .join("\n")
            .includes(mode === "cancel" ? "已取消 MCP 授权" : "OAuth 登录失败"),
      );
      expect(app.calls[1]!.signal!.aborted).toBe(false);
      expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({ isError: mode !== "cancel" });
      app.calls[1]!.finish();
    } finally {
      await app.cleanup();
      await server.stop();
    }
  },
);

test("needs-auth notice appears once per Session even after another Run and callback cancellation", async () => {
  const server = mcpOAuthServer();
  const app = await start(["first"], {
    rows: 32,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
      ).then(() => {}),
  });
  try {
    await app.waitFor(
      () => app.calls.length === 1 && app.screen().join("\n").includes("/mcp login srv"),
    );
    app.calls[0]!.tool("mcp__srv__authenticate", {});
    await app.waitFor(() => app.screen().join("\n").includes("取消登录"));
    app.stdin.write("\x1b");
    await app.waitFor(
      () => app.calls.length === 2 && app.screen().join("\n").includes("已取消 MCP 授权"),
    );
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("second\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(app.screen().join("\n")).not.toContain("/mcp login srv");
    app.calls[2]!.finish();
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test("OAuth and permission approvals share the FIFO without overlapping panels", async () => {
  const server = mcpOAuthServer();
  const opened: string[] = [];
  const app = await start(["mixed"], {
    rows: 32,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
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
    app.calls[0]!.tools([
      {
        name: "bash",
        args: { command: "printf approval-first", description: "Print after user approval" },
      },
      { name: "mcp__srv__authenticate", args: {} },
    ]);
    await app.waitFor(() => app.screen().some((line) => line.trim() === "printf approval-first"));
    expect(opened).toEqual([]);
    expect(app.screen().join("\n")).not.toContain("复制授权链接");
    app.stdin.write("3\r");
    await app.waitFor(
      () => app.screen().join("\n").includes("复制授权链接") && opened.length === 1,
    );
    expect(app.screen().join("\n")).not.toContain("等待审批");
    app.stdin.write("\x1b");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
    await server.stop();
  }
});

test("a clipboard reply after cancellation cannot update the next question", async () => {
  const server = mcpOAuthServer();
  const copy = Promise.withResolvers<boolean>();
  let copying = false;
  const app = await start(["login"], {
    rows: 32,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
      ).then(() => {}),
    host: {
      writeClipboard: async () => {
        copying = true;
        return copy.promise;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("mcp__srv__authenticate", {});
    await app.waitFor(() => app.screen().join("\n").includes("复制授权链接"));
    app.stdin.write("\r");
    await app.waitFor(() => copying);
    app.stdin.write("\x1b");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.tool("ask_user_question", {
      questions: [
        {
          question: "Next question?",
          header: "Next",
          options: [
            { label: "Yes", description: "" },
            { label: "No", description: "" },
          ],
        },
      ],
    });
    await app.waitFor(() => app.screen().join("\n").includes("Next question?"));
    copy.resolve(true);
    await copy.promise;
    await app.flush();
    expect(app.screen().join("\n")).not.toContain("已复制");
    expect(app.screen().join("\n")).toContain("Next question?");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.finish();
  } finally {
    copy.resolve(false);
    await app.cleanup();
    await server.stop();
  }
});

test("Run abort closes an authorization panel and ignores a late opener result", async () => {
  const server = mcpOAuthServer();
  const opener = Promise.withResolvers<void>();
  let opening = false;
  const app = await start(["login"], {
    rows: 32,
    prepare: (root) =>
      Bun.write(
        join(root, ".neant/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
      ).then(() => {}),
    host: {
      openExternal: async () => {
        opening = true;
        return opener.promise;
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("mcp__srv__authenticate", {});
    await app.waitFor(() => opening && app.screen().join("\n").includes("复制授权链接"));
    // First Ctrl+C declines this Interaction; the second interrupts the Run.
    app.stdin.write("\x03\x03");
    await app.waitFor(() => !app.isWorking() && !app.screen().join("\n").includes("复制授权链接"));
    opener.resolve();
    await opener.promise;
    await app.flush();
    expect(app.screen().join("\n")).not.toContain("授权页面已在浏览器");
  } finally {
    opener.resolve();
    await app.cleanup();
    await server.stop();
  }
});

test.each([
  { mode: "success", duration: 4000 },
  { mode: "failure", duration: 8000 },
])(
  "OAuth $mode notice expires after $duration ms",
  async ({ mode, duration }) => {
    const server = mcpOAuthServer();
    let authorizationUrl = "";
    const app = await startWithClock(["login"], {
      rows: 32,
      prepare: (root) =>
        Bun.write(
          join(root, ".neant/mcp.json"),
          JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
        ).then(() => {}),
      host: {
        openExternal: async (url) => {
          authorizationUrl = url;
        },
      },
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("mcp__srv__authenticate", {});
      await app.waitFor(
        () => authorizationUrl !== "" && app.screen().join("\n").includes("复制授权链接"),
      );
      const startedAt = performance.now();
      if (mode === "success") await fetch(authorizationUrl);
      else app.stdin.write("\x1b[200~http://localhost/callback?code=bad&state=wrong\x1b[201~\r");
      const notice = mode === "success" ? "已登录 MCP 服务器 srv" : "OAuth 登录失败";
      await app.waitFor(() => app.calls.length === 2 && app.screen().join("\n").includes(notice));
      await app.waitFor(() => !app.screen().join("\n").includes(notice), duration + 2000);
      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(duration - 100);
      app.calls[1]!.finish();
    } finally {
      try {
        await app.cleanup();
      } finally {
        await server.stop();
      }
    }
  },
  12000,
);

test.each(["copy", "reopen", "cancel"])(
  "a callback draft respects selected OAuth action %s",
  async (action) => {
    const server = mcpOAuthServer();
    const opened: string[] = [];
    const copied: string[] = [];
    const app = await start(["login"], {
      rows: 40,
      prepare: (root) =>
        Bun.write(
          join(root, ".neant/mcp.json"),
          JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
        ).then(() => {}),
      host: {
        openExternal: async (url) => {
          opened.push(url);
        },
        writeClipboard: async (text) => {
          copied.push(text);
          return true;
        },
      },
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("mcp__srv__authenticate", {});
      await app.waitFor(
        () => opened.length === 1 && app.screen().join("\n").includes("复制授权链接"),
      );
      const response = await fetch(opened[0]!, { redirect: "manual" });
      const callback = response.headers.get("location")!;
      app.stdin.write(`\x1b[200~${callback}\x1b[201~\t`);
      await app.flush();
      app.stdin.write(
        action === "cancel" ? "\x1b[A\r" : action === "copy" ? "\x1b[B\r" : "\x1b[B\x1b[B\r",
      );
      if (action === "cancel") {
        await app.waitFor(
          () => app.calls.length === 2 && app.screen().join("\n").includes("已取消 MCP 授权"),
        );
        expect(
          app.calls[1]!.context.messages.findLast((message) => message.role === "toolResult"),
        ).toMatchObject({ isError: false, details: { type: "cancelled", server: "srv" } });
        expect(app.screen().join("\n")).toContain("已取消 MCP 授权");
        app.calls[1]!.finish();
      } else {
        await app.waitFor(() => (action === "copy" ? copied.length === 1 : opened.length === 2));
        expect(app.calls).toHaveLength(1);
        expect(app.screen().join("\n")).toContain("复制授权链接");
        expect(copied).toEqual(action === "copy" ? [opened[0]!] : []);
        app.stdin.write("\t\r");
        await app.waitFor(() => app.calls.length === 2);
        expect(
          app.calls[1]!.context.messages.findLast((message) => message.role === "toolResult"),
        ).toMatchObject({ isError: false, details: { type: "authenticated", server: "srv" } });
        app.calls[1]!.finish();
      }
    } finally {
      await app.cleanup();
      await server.stop();
    }
  },
);

test.each([
  { lang: "zh_CN.UTF-8", entry: "model", reason: "OAuth 回调的 state 不匹配。" },
  { lang: "en_US.UTF-8", entry: "model", reason: "OAuth callback state does not match." },
  { lang: "zh_CN.UTF-8", entry: "idle", reason: "OAuth 回调的 state 不匹配。" },
  { lang: "en_US.UTF-8", entry: "idle", reason: "OAuth callback state does not match." },
])(
  "$entry OAuth errors localize the $lang notice while preserving English model results",
  async ({ lang, entry, reason }) => {
    const server = mcpOAuthServer();
    const app = await start(entry === "model" ? ["login"] : [], {
      rows: 40,
      env: { LANG: lang },
      prepare: (root) =>
        Bun.write(
          join(root, ".neant/mcp.json"),
          JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
        ).then(() => {}),
    });
    try {
      if (entry === "model") {
        await app.waitFor(() => app.calls.length === 1);
        app.calls[0]!.tool("mcp__srv__authenticate", {});
      } else {
        await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
        app.stdin.write("/mcp login srv\r");
      }
      await app.waitFor(() =>
        app
          .screen()
          .join("\n")
          .includes(lang.startsWith("zh") ? "复制授权链接" : "Copy authorization link"),
      );
      app.stdin.write("\x1b[200~http://localhost/callback?code=bad&state=wrong\x1b[201~\r");
      await app.waitFor(() =>
        app
          .screen()
          .join("\n")
          .includes(
            lang.startsWith("zh")
              ? entry === "model"
                ? "OAuth 登录失败"
                : "mcp 失败"
              : entry === "model"
                ? "OAuth sign-in failed"
                : "mcp failed",
          ),
      );
      expect(app.screen().join("\n")).toContain(reason);
      if (entry === "model") {
        await app.waitFor(() => app.calls.length === 2);
        expect(
          app.calls[1]!.context.messages.findLast((message) => message.role === "toolResult"),
        ).toMatchObject({
          isError: true,
          content: [{ type: "text", text: "OAuth callback state does not match." }],
          details: { code: "mcp-auth-state-mismatch", params: {} },
        });
        app.calls[1]!.finish();
      } else expect(app.calls).toHaveLength(0);
    } finally {
      await app.cleanup();
      await server.stop();
    }
  },
);
