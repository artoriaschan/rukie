import { expect, test } from "bun:test";
import { isolateProxyEnvironment } from "../helpers/proxy-env.ts";
import { join } from "node:path";
import { createSession, type SessionOptions } from "@neant/agent";
import { controlledModel } from "../helpers/model";
import { start } from "../helpers/app";

isolateProxyEnvironment();

const assistant = process.platform === "darwin" ? "⏺" : "●";

test.each([
  [40, 12],
  [80, 24],
])("web domain approval remains usable at %sx%s", async (columns, rows) => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("Public documentation"),
  });
  const url = `http://site.test:${server.port}/docs`;
  const app = await start(["read docs"], {
    columns,
    rows,
    session: {
      webFetch: {
        resolve: async () => [{ address: "127.0.0.1", family: 4 }],
        allowAddresses: ["127.0.0.1"],
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("web_fetch", { url });
    await app.waitFor(() => app.screen().join("\n").includes("2. 本 session 允许此域名"));
    expect(app.screen().join("\n")).toContain("3. 拒绝");
    app.stdin.write("2\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({ isError: false });
    app.calls[1]!.tool("web_fetch", { url: url.replace("/docs", "/next") });
    await app.waitFor(() => app.calls.length === 3);
    expect(app.calls[2]!.context.messages.at(-1)).toMatchObject({ isError: false });
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
    server.stop(true);
  }
});

test.each([
  ["ask", "询问"],
  ["auto-review", "自动评审"],
] as const)(
  "mode switches leave settings and reminders unchanged and resume restores %s",
  async (defaultMode, label) => {
    let root = "";
    let id = "";
    const argv: string[] = ["first"];
    const settings = { permissionMode: defaultMode };
    const sessionOptions: Partial<SessionOptions> = { settings };
    const userSettings = JSON.stringify(settings) + "\n";
    const projectSettings = '{"permissions":{"allow":["read"]}}\n';
    const app = await start(argv, {
      session: sessionOptions,
      prepare: async (directory) => {
        root = directory;
        sessionOptions.homeDir = join(root, "home");
        await Bun.write(join(root, "home/.neant/settings.json"), userSettings);
        await Bun.write(join(root, ".neant/settings.json"), projectSettings);
        const seed = await createSession({
          cwd: root,
          homeDir: sessionOptions.homeDir,
          ...controlledModel(),
        });
        id = seed.id;
        argv.push("--resume", id);
      },
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      expect(app.screen().at(-2)).toStartWith(` ${label} ·`);
      const firstContext = app.calls[0]!.context;
      app.calls[0]!.finish();
      await app.waitFor(() => !app.isWorking());
      app.stdin.write(defaultMode === "ask" ? "\x1b[Z\x1b[Z" : "\x1b[Z");
      await app.waitFor(() => app.screen().at(-2)!.startsWith(" 完全访问 ·"));
      app.stdin.write("second\r");
      await app.waitFor(() => app.calls.length === 2);
      const secondContext = app.calls[1]!.context;
      expect(secondContext.messages.slice(0, firstContext.messages.length)).toEqual(
        firstContext.messages,
      );
      expect(secondContext.messages.slice(firstContext.messages.length)).toMatchObject([
        { role: "assistant" },
        { role: "user", content: [{ type: "text", text: "second" }] },
      ]);
      expect(secondContext.messages).toHaveLength(firstContext.messages.length + 2);
      app.calls[1]!.tool("bash", { command: "printf session-only-mode" });
      await app.waitFor(() => app.calls.length === 3);
      expect(app.calls[2]!.context.messages.at(-1)).toMatchObject({ isError: false });
      app.calls[2]!.finish();
      await app.waitFor(() => !app.isWorking());
      expect(settings.permissionMode).toBe(defaultMode);
      expect(await Bun.file(join(root, "home/.neant/settings.json")).text()).toBe(userSettings);
      expect(await Bun.file(join(root, ".neant/settings.json")).text()).toBe(projectSettings);
      const replay = await start(["--resume", id], {
        session: { cwd: root, homeDir: join(root, "home"), settings },
      });
      try {
        await replay.waitFor(() => replay.screen().at(-2)!.startsWith(` ${label} ·`));
        replay.stdin.write("resumed\r");
        await replay.waitFor(() => replay.calls.length === 1);
        replay.calls[0]!.tool("bash", { command: "printf must-ask-after-resume" });
        await replay.waitFor(() =>
          replay.screen().some((line) => line.includes("1. 允许（仅本次）")),
        );
        expect(replay.calls).toHaveLength(1);
        expect(await Bun.file(join(root, "home/.neant/settings.json")).text()).toBe(userSettings);
      } finally {
        await replay.cleanup();
      }
    } finally {
      await app.cleanup();
    }
  },
);

test("shift+tab cycles modes during a Run and changes the next tool permission immediately", async () => {
  const app = await start(["switch during run"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    expect(app.screen().at(-2)).toStartWith(" 询问 ·");
    app.stdin.write("next draft\x1b[Z");
    await app.waitFor(() => app.screen().at(-2)!.startsWith(" 自动评审 ·"));
    expect(app.screen()).toContain("❯ next draft");
    app.stdin.write("\x1b[Z");
    await app.waitFor(() => app.screen().at(-2)!.startsWith(" 完全访问 ·"));
    app.calls[0]!.tool("bash", { command: "printf switched-permission" });
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      role: "toolResult",
      isError: false,
      content: [{ type: "text", text: "switched-permission" }],
    });
    expect(app.screen().join("\n")).not.toContain("等待审批");
    app.stdin.write("\x1b[Z");
    await app.waitFor(() => app.screen().at(-2)!.startsWith(" 询问 ·"));
    app.calls[1]!.tool("bash", { command: "printf ask-again" });
    await app.waitFor(() => app.screen().join("\n").includes("等待审批"));
    const dialog = app.screen().slice(app.screen().findIndex((line) => line.includes("等待审批")));
    app.stdin.write("\x1b[Z\x1b[Z");
    await Bun.sleep(30);
    await app.flush();
    expect(app.screen().slice(app.screen().findIndex((line) => line.includes("等待审批")))).toEqual(
      dialog,
    );
    expect(app.calls).toHaveLength(2);
    app.stdin.write("3\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(app.calls[2]!.context.messages.at(-1)).toMatchObject({ isError: true });
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen()).toContain("❯ next draft");
    // Back-to-back key events must read the current Session mode synchronously.
    app.stdin.write("\x1b[Z\x1b[Z\x1b[Z");
    await Bun.sleep(30);
    await app.flush();
    expect(app.screen().at(-2)).toStartWith(" 询问 ·");
  } finally {
    await app.cleanup();
  }
});

test.each(["default", "ask"])(
  "%s: allow once executes the tool and asks again for its next call",
  async (mode) => {
    const app = await start(
      mode === "default" ? ["use bash"] : ["--permission-mode", mode, "use bash"],
      mode === "default" ? {} : { session: { settings: { permissionMode: "full-access" } } },
    );
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("bash", { command: "printf first-permitted" });
      await app.waitFor(() => app.screen().some((line) => line.includes("等待审批")));
      const dialog = app.screen().join("\n");
      expect(dialog).toContain('bash {"command":"printf first-permitted"}');
      expect(dialog).toContain("1. 允许（仅本次）");
      expect(dialog).toContain("2. 本 session 允许此命令");
      expect(dialog).toContain("3. 拒绝");
      app.stdin.write("1");
      await Bun.sleep(30);
      expect(app.calls).toHaveLength(1);
      app.stdin.write("\r");
      await app.waitFor(() => app.calls.length === 2);
      expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
        role: "toolResult",
        isError: false,
        content: [{ type: "text", text: "first-permitted" }],
      });
      app.calls[1]!.tool("bash", { command: "printf second-permitted" });
      await app.waitFor(() => app.screen().join("\n").includes("second-permitted"));
      expect(app.screen().join("\n")).toContain("等待审批");
      expect(app.calls).toHaveLength(2);
      app.stdin.write("1\r");
      await app.waitFor(() => app.calls.length === 3);
      app.calls[2]!.delta("finished");
      app.calls[2]!.finish();
      await app.waitFor(() => !app.isWorking());
      expect(app.screen().join("\n")).not.toContain("等待审批");
      expect(app.allLines().join("\n")).not.toContain("等待审批");
    } finally {
      await app.cleanup();
    }
  },
);

test.each(["2\r", "\x1b[A\r", "\x1b[B\r", "\x1b"])(
  "auto-review shows the reason, allows once, then rejects via %j",
  async (reject) => {
    const app = await start(["--permission-mode", "auto-review", "use bash"]);
    const reason = "Test review requires consent";
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("bash", { command: "printf reviewed-once" });
      await app.waitFor(() => app.screen().join("\n").includes(reason));
      expect(app.screen().join("\n")).toContain("⏳ 等待审批 · bash");
      expect(app.screen().join("\n")).toContain(reason);
      expect(app.screen().join("\n")).toContain("2. 拒绝");
      expect(app.screen().join("\n")).not.toContain("本 session");
      expect(app.screen().join("\n")).not.toContain("3.");
      app.stdin.write("1\r");
      await app.waitFor(() => app.calls.length === 2);
      expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
        isError: false,
        content: [{ type: "text", text: "reviewed-once" }],
      });
      app.calls[1]!.tool("bash", { command: "printf must-be-refused" });
      await app.waitFor(() =>
        app.screen().some((line) => line.trim() === "printf must-be-refused"),
      );
      // Invalid digits do not select a hidden option; Shift+Tab cannot change the request.
      app.stdin.write("3\x1b[Z");
      await Bun.sleep(30);
      await app.flush();
      expect(app.screen().map((line) => line.trimStart())).toContain("❯ 1. 允许（仅本次）");
      app.stdin.write(reject);
      await app.waitFor(() => app.calls.length === 3);
      expect(app.calls[2]!.context.messages.at(-1)).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "User denied this tool call: bash" }],
      });
      app.calls[2]!.finish();
      await app.waitFor(() => !app.isWorking());
      expect(app.screen().join("\n")).not.toContain(reason);
    } finally {
      await app.cleanup();
    }
  },
);

test("auto-review asks for a different command after a session command grant", async () => {
  const app = await start(["allow in ask"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "printf ask-allowed" });
    await app.waitFor(() => app.screen().some((line) => line.includes("3. 拒绝")));
    app.stdin.write("2\r");
    await app.waitFor(() => app.calls.length === 2);
    app.stdin.write("\x1b[Z");
    await app.waitFor(() => app.screen().at(-2)!.startsWith(" 自动评审 ·"));
    app.calls[1]!.tool("bash", { command: "printf review-must-ask" });
    await app.waitFor(() => app.screen().join("\n").includes("Test review requires consent"));
    expect(app.screen().join("\n")).toContain("Test review requires consent");
    expect(app.calls).toHaveLength(2);
    app.stdin.write("2\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(app.calls[2]!.context.messages.at(-1)).toMatchObject({ isError: true });
    app.calls[2]!.finish();
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["number", "3\r"],
  ["arrows", "\x1b[A\r"],
  ["Esc", "\x1b"],
])("%s rejects the call, returns 未获授权 to the model and continues the Run", async (_, key) => {
  const app = await start(["try bash"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "printf must-not-run" });
    await app.waitFor(() => app.screen().join("\n").includes("等待审批"));
    app.stdin.write(key!);
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.signal!.aborted).toBe(false);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      role: "toolResult",
      isError: true,
      content: [{ type: "text", text: "Tool not authorized: bash" }],
    });
    app.calls[1]!.delta("continuing after refusal");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.allLines()).toContain(`${assistant} continuing after refusal`);
    expect(app.screen().join("\n")).not.toContain("等待审批");
  } finally {
    await app.cleanup();
  }
});

test("Ctrl+C closes the question, cancels the Run and preserves the draft without granting", async () => {
  const app = await start(["cancel bash"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("next draft");
    await app.waitFor(() => app.screen().includes("❯ next draft"));
    app.calls[0]!.tool("bash", { command: "printf cancelled" });
    await app.waitFor(() => app.screen().join("\n").includes("等待审批"));
    app.stdin.write("2");
    await app.waitFor(() => app.screen().some((line) => line.trimStart().startsWith("❯ 2.")));
    app.stdin.write("\x03");
    await app.waitFor(() => !app.isWorking());
    expect(app.screen()).toContain("❯ next draft");
    expect(app.screen().join("\n")).not.toContain("等待审批");
    expect(app.calls.every((call) => call.signal!.aborted)).toBe(true);
    const nextCall = app.calls.length;
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === nextCall + 1);
    expect(app.calls[nextCall]!.context.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "next draft" }],
    });
    app.calls[nextCall]!.tool("bash", { command: "printf still-needs-permission" });
    await app.waitFor(() => app.screen().join("\n").includes("等待审批"));
    expect(app.screen().join("\n")).toContain("still-needs-permission");
  } finally {
    await app.cleanup();
  }
});

test.each(["flag", "settings", "yolo", "readonly"])(
  "%s permits tools without a question",
  async (mode) => {
    const app = await start(
      [
        "use tool",
        ...(mode === "flag" ? ["--allow-tools", "ba*"] : mode === "yolo" ? ["--yolo"] : []),
      ],
      {
        prepare: async (root) => {
          if (mode === "settings") {
            await Bun.write(
              join(root, ".neant/settings.json"),
              '{"permissions":{"allow":["ba*"]}}',
            );
          }
        },
      },
    );
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool(
        mode === "readonly" ? "glob" : "bash",
        mode === "readonly" ? { pattern: "*" } : { command: "printf pre-approved" },
      );
      await app.waitFor(() => app.calls.length === 2);
      expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({ isError: false });
      expect(app.screen().join("\n")).not.toContain("等待审批");
      app.calls[1]!.finish();
      await app.waitFor(() => !app.isWorking());
      expect(app.allLines().join("\n")).not.toContain("等待审批");
    } finally {
      await app.cleanup();
    }
  },
);

test("session allow remembers only this command across Runs and leaves settings unchanged", async () => {
  let root = "";
  const settings = '{"permissions":{"allow":["read"]}}\n';
  const app = await start(["use bash"], {
    prepare: async (directory) => {
      root = directory;
      await Bun.write(join(root, ".neant/settings.json"), settings);
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "printf first-allowed" });
    await app.waitFor(() => app.screen().join("\n").includes("等待审批"));
    app.stdin.write("\x1b[B\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({ isError: false });
    app.calls[1]!.delta("first done");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("again\r");
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.tool("bash", { command: "printf first-allowed" });
    await app.waitFor(() => app.calls.length === 4);
    expect(app.calls[3]!.context.messages.at(-1)).toMatchObject({
      isError: false,
      content: [{ type: "text", text: "first-allowed" }],
    });
    expect(app.screen().join("\n")).not.toContain("等待审批");
    app.calls[3]!.tool("write", { path: "other.txt", content: "other tool" });
    await app.waitFor(() => app.screen().join("\n").includes("等待审批"));
    expect(app.screen().join("\n")).toContain("write ");
    app.stdin.write("\x1b");
    await app.waitFor(() => app.calls.length === 5);
    app.calls[4]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(await Bun.file(join(root, ".neant/settings.json")).text()).toBe(settings);
  } finally {
    await app.cleanup();
  }

  const next = await start(["new Session"]);
  try {
    await next.waitFor(() => next.calls.length === 1);
    next.calls[0]!.tool("bash", { command: "printf needs-permission" });
    await next.waitFor(() => next.screen().join("\n").includes("等待审批"));
  } finally {
    await next.cleanup();
  }
});

test("concurrent questions are answered individually and dialog keys do not edit the draft", async () => {
  const app = await start(["two calls"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("next draft");
    await app.waitFor(() => app.screen().includes("❯ next draft"));
    app.calls[0]!.tools([
      { name: "bash", args: { command: "printf allowed-parallel" } },
      { name: "write", args: { path: "refused.txt", content: "refused" } },
    ]);
    await app.waitFor(() => app.screen().join("\n").includes("等待审批"));
    expect(app.screen().join("\n")).toContain("allowed-parallel");
    app.stdin.write("ignored\x1b[200~pasted\x1b[201~1\r");
    await app.waitFor(() => app.screen().join("\n").includes("refused.txt"));
    expect(app.screen().join("\n")).toContain("等待审批");
    app.stdin.write("3\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(
      app.calls[1]!.context.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([
      { toolName: "bash", isError: false, content: [{ type: "text", text: "allowed-parallel" }] },
      {
        toolName: "write",
        isError: true,
        content: [{ type: "text", text: "Tool not authorized: write" }],
      },
    ]);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen()).toContain("❯ next draft");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(app.calls[2]!.context.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "next draft" }],
    });
  } finally {
    await app.cleanup();
  }
});

test("the question stays visible above a multiline draft and restores the draft after cancellation", async () => {
  const app = await start(["ask while drafting"]);
  const draft = Array.from({ length: 10 }, (_, index) => `draft-line-${index}`).join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write(`\x1b[200~${draft}\x1b[201~`);
    await app.waitFor(() => app.screen().some((line) => line.trim() === "draft-line-9"));
    app.calls[0]!.tool("bash", { command: "printf visible-request" });
    await app.waitFor(() => app.screen().join("\n").includes("等待审批"));
    const dialog = app.screen().join("\n");
    expect(dialog).toContain('bash {"command":"printf visible-request"}');
    expect(dialog).toContain("1. 允许（仅本次）");
    expect(dialog).toContain("2. 本 session 允许此命令");
    expect(dialog).toContain("3. 拒绝");
    app.stdin.write("\x03");
    await app.waitFor(() => !app.screen().join("\n").includes("等待审批"));
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().some((line) => line.trim() === "draft-line-9")).toBe(true);
    const nextCall = app.calls.length;
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === nextCall + 1);
    expect(app.calls[nextCall]!.context.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: draft }],
    });
  } finally {
    await app.cleanup();
  }
});

test("session command grant permits subsequent matching calls", async () => {
  const app = await start(["two bash calls"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools([
      { name: "bash", args: { command: "printf first-parallel" } },
      { name: "bash", args: { command: "printf first-parallel" } },
    ]);
    await app.waitFor(() => app.screen().join("\n").includes("等待审批"));
    app.stdin.write("2\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(
      app.calls[1]!.context.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([
      { isError: false, content: [{ type: "text", text: "first-parallel" }] },
      { isError: false, content: [{ type: "text", text: "first-parallel" }] },
    ]);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).not.toContain("等待审批");
  } finally {
    await app.cleanup();
  }
});

test("session command grant permits matching calls while another tool keeps waiting", async () => {
  const app = await start(["mixed concurrent calls"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools([
      { name: "bash", args: { command: "printf first-matching" } },
      { name: "write", args: { path: "must-wait.txt", content: "requires a decision" } },
      { name: "bash", args: { command: "printf first-matching" } },
    ]);
    await app.waitFor(() => app.screen().some((line) => line.trim() === "printf first-matching"));
    app.stdin.write("2\r");
    await app.waitFor(() => app.screen().some((line) => line.includes("⏳ 等待审批 · write")));
    expect(app.calls).toHaveLength(1);
    app.stdin.write("3\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(
      app.calls[1]!.context.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([
      { toolName: "bash", isError: false, content: [{ type: "text", text: "first-matching" }] },
      { toolName: "write", isError: true },
      { toolName: "bash", isError: false, content: [{ type: "text", text: "first-matching" }] },
    ]);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).not.toContain("等待审批");
  } finally {
    await app.cleanup();
  }
});
