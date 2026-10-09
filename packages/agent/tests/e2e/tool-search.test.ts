import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { mcpOAuthServer } from "../helpers/mcp-oauth-server.ts";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createSession, loadSettings } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Awaited<ReturnType<typeof createSession>>[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await dirs?.cleanup();
});
async function fixture(tools = ["echo"], mode = "on") {
  dirs = await tempDirs();
  await Bun.write(join(dirs.homeDir, ".rukie/settings.json"), JSON.stringify({ toolSearch: mode }));
  await update(tools);
}
async function update(tools: string[], descriptions = {}) {
  await Bun.write(
    join(dirs.homeDir, "manifest.json"),
    JSON.stringify({ tools, toolDescriptions: descriptions }),
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
function model(
  responses: Parameters<typeof fakeModel>[0],
  supported = true,
  contextWindow = 100000,
) {
  return fakeModel(responses, {
    model: { contextWindow, compat: { supportsMidConvoToolChanges: supported } },
  });
}
function names(messages: Parameters<typeof getCurrentTools>[0]) {
  return getCurrentTools(messages).map((tool) => tool.name);
}
function call(query: string, max_results?: number) {
  return fauxAssistantMessage(
    fauxToolCall("ToolSearch", { query, ...(max_results === undefined ? {} : { max_results }) }),
    { stopReason: "toolUse" },
  );
}
async function open(
  fake: ReturnType<typeof fakeModel>,
  extra: Partial<Parameters<typeof createSession>[0]> = {},
) {
  const { settings } = await loadSettings(dirs);
  const session = await createSession({ ...dirs, ...fake, settings, ...extra });
  sessions.push(session);
  return session;
}
test("Headless ToolSearch loads one MCP declaration through an append-only native change", async () => {
  await fixture();
  const fake = model([call("select:mcp__local__echo"), fauxAssistantMessage("done")]);
  const session = await open(fake);
  await session.run("search");
  expect(names(fake.contexts[0]!.messages)).toContain("ToolSearch");
  expect(names(fake.contexts[0]!.messages)).not.toContain("mcp__local__echo");
  expect(names(fake.contexts[1]!.messages)).toEqual([
    ...names(fake.contexts[0]!.messages),
    "mcp__local__echo",
  ]);
  const changes = fake.contexts[1]!.messages.slice(fake.contexts[0]!.messages.length).filter(
    (message) => message.role === "system" && (message.toolsAdded || message.toolsRemoved),
  );
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ toolsAdded: [{ name: "mcp__local__echo" }] });
  expect(changes[0]).not.toHaveProperty("toolsRemoved");
  const root = join(dirs.homeDir, ".rukie/durable-sessions");
  const files = (await readdir(root, { recursive: true })).filter((path) =>
    path.endsWith("/main.jsonl"),
  );
  const commits: unknown[] = (await Bun.file(join(root, files[0]!)).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;
  const deltas = commits
    .flatMap((commit) => (record(commit) && Array.isArray(commit.writes) ? commit.writes : []))
    .flatMap((write: unknown) =>
      record(write) &&
      write.type === "entry" &&
      record(write.value) &&
      Array.isArray(write.value.model)
        ? write.value.model
        : [],
    )
    .filter(
      (message: unknown) =>
        record(message) &&
        Array.isArray(message.toolsAdded) &&
        message.toolsAdded.some(
          (tool: unknown) => record(tool) && tool.name === "mcp__local__echo",
        ),
    );
  expect(deltas).toHaveLength(1);
  expect(deltas[0]).toMatchObject({ toolsAdded: [{ name: "mcp__local__echo" }] });
  expect(deltas[0]).not.toHaveProperty("toolsRemoved");
});

test.each([
  ["on", true, 100000, true],
  ["off", true, 100000, false],
  ["on", false, 100000, true],
  ["auto", true, 100000, false],
  ["auto", true, 100000, true],
  ["auto", false, 100000, true],
] as const)(
  "%s with compat %s and window %s enables search %s",
  async (mode, supported, window, enabled) => {
    await fixture(["echo"], mode);
    if (enabled && mode === "auto") await update(["echo"], { echo: "x".repeat(50000) });
    const fake = model([fauxAssistantMessage("done")], supported, window);
    const session = await open(fake);
    await session.run("check");
    expect(names(fake.contexts[0]!.messages).includes("ToolSearch")).toBe(enabled);
    expect(names(fake.contexts[0]!.messages).includes("mcp__local__echo")).toBe(!enabled);
  },
);
test("settings reject invalid ToolSearch and project overrides user without trust", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.homeDir, ".rukie/settings.json"),
    JSON.stringify({ toolSearch: "invalid" }),
  );
  await expect(loadSettings(dirs)).rejects.toThrow("toolSearch");
  await Bun.write(
    join(dirs.homeDir, ".rukie/settings.json"),
    JSON.stringify({ toolSearch: "off" }),
  );
  await Bun.write(join(dirs.cwd, ".rukie/settings.json"), JSON.stringify({ toolSearch: "on" }));
  expect((await loadSettings(dirs)).settings.toolSearch).toBe("on");
  await Bun.write(join(dirs.cwd, ".rukie/settings.json"), JSON.stringify({ toolSearch: false }));
  await expect(loadSettings(dirs)).rejects.toThrow("toolSearch");
});
test.each([
  ["+calendar events", undefined, ["calendar_events"]],
  ["calendar events", undefined, ["calendar_events", "description_match"]],
  ["needle", undefined, ["needle0", "needle1", "needle2", "needle3", "needle4"]],
  ["needle", 20, Array.from({ length: 20 }, (_, index) => `needle${index}`)],
  ["absent", undefined, []],
] as const)("query %s selects matching names with max %s", async (query, max, expected) => {
  await fixture([
    "description_match",
    "calendar_events",
    ...Array.from({ length: 21 }, (_, index) => `needle${index}`),
  ]);
  await update(
    [
      "description_match",
      "calendar_events",
      ...Array.from({ length: 21 }, (_, index) => `needle${index}`),
    ],
    { description_match: "calendar events" },
  );
  const fake = model([call(query, max), fauxAssistantMessage("done")]);
  const session = await open(fake);
  await session.run("find");
  expect(names(fake.contexts[1]!.messages).filter((name) => name.startsWith("mcp__"))).toEqual(
    expected.map((name) => `mcp__local__${name}`),
  );
  if (!expected.length)
    expect(
      JSON.stringify(
        fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
      ),
    ).toContain("select:");
});
test("select ignores result limit, reports unknown names and marks already available", async () => {
  await fixture(["echo", "keep"]);
  const fake = model([
    call("select:mcp__local__echo,mcp__local__keep,unknown", 1),
    call("select:mcp__local__echo"),
    fauxAssistantMessage("done"),
  ]);
  const session = await open(fake);
  await session.run("select");
  expect(names(fake.contexts[1]!.messages)).toEqual([
    ...names(fake.contexts[0]!.messages),
    "mcp__local__echo",
    "mcp__local__keep",
  ]);
  expect(
    JSON.stringify(fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult")),
  ).toContain("Unknown tool names: unknown");
  expect(names(fake.contexts[2]!.messages)).toEqual(names(fake.contexts[1]!.messages));
  expect(
    JSON.stringify(fake.contexts[2]!.messages.findLast((message) => message.role === "toolResult")),
  ).toContain("already available");
  const reminders = session.messages.filter(
    (message) => message.role === "system-reminder" && message.source === "deferred-tools",
  );
  expect(reminders.map((message) => ("content" in message ? message.content : ""))).toEqual([
    "Deferred MCP tools (use ToolSearch to load their definitions):\n- mcp__local__echo\n- mcp__local__keep",
    "Deferred MCP tools changed:\nRemoved:\n- mcp__local__echo\n- mcp__local__keep",
  ]);
});
test("loaded MCP still obeys deny rules while ToolSearch is read-only", async () => {
  await fixture();
  const fake = model([
    call("select:mcp__local__echo"),
    fauxAssistantMessage(fauxToolCall("mcp__local__echo", { text: "denied" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const session = await open(fake, {
    settings: { toolSearch: "on", permissions: { deny: ["mcp__local__echo"] } },
  });
  await session.run("load and invoke");
  expect(
    fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({ role: "toolResult", toolName: "ToolSearch", isError: false });
  expect(
    fake.contexts[2]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({ role: "toolResult", toolName: "mcp__local__echo", isError: true });
  expect(await Bun.file(join(dirs.homeDir, "calls")).exists()).toBe(false);
});

test("OpenAI tool search compat also enables deferred tools", async () => {
  await fixture();
  const fake = fakeModel([fauxAssistantMessage("done")], {
    model: { compat: { supportsToolSearch: true } },
  });
  const session = await open(fake);
  await session.run("openai");
  expect(names(fake.contexts[0]!.messages)).toContain("ToolSearch");
});
test("late auto enable preserves visible MCP positions and defers only arrivals", async () => {
  await fixture(["echo"], "auto");
  const fake = model([
    fauxAssistantMessage("first"),
    fauxAssistantMessage("late"),
    fauxAssistantMessage("off"),
    fauxAssistantMessage("off arrival"),
  ]);
  const session = await open(fake);
  await session.run("small");
  await update(["echo", "large"], { large: "x".repeat(50000) });
  await session.reconnectMcp("local");
  await session.run("large arrival");
  expect(names(fake.contexts[1]!.messages)).toEqual([
    ...names(fake.contexts[0]!.messages),
    "ToolSearch",
  ]);
  expect(names(fake.contexts[1]!.messages)).not.toContain("mcp__local__large");
  await update(["echo", "large"], { large: "small again" });
  await session.reconnectMcp("local");
  await session.run("small again");
  expect(names(fake.contexts[2]!.messages)).toEqual([
    ...names(fake.contexts[1]!.messages),
    "mcp__local__large",
  ]);
  await update(["echo", "large", "new"], { large: "small again" });
  await session.reconnectMcp("local");
  await session.run("off arrival");
  expect(names(fake.contexts[3]!.messages)).toEqual([
    ...names(fake.contexts[2]!.messages),
    "mcp__local__new",
  ]);
});
test("late MCP after an empty first request becomes deferred", async () => {
  await fixture([]);
  const fake = model([fauxAssistantMessage("none"), fauxAssistantMessage("arrived")]);
  const session = await open(fake);
  await session.run("none");
  expect(names(fake.contexts[0]!.messages)).not.toContain("ToolSearch");
  await update(["echo"]);
  await session.reconnectMcp("local");
  await session.run("arrival");
  expect(names(fake.contexts[1]!.messages)).toEqual([
    ...names(fake.contexts[0]!.messages),
    "ToolSearch",
  ]);
});
test("remove discovered MCP and reappearance returns to deferred with repeated inverse deltas", async () => {
  await fixture();
  const fake = model([
    call("select:mcp__local__echo"),
    fauxAssistantMessage("loaded"),
    fauxAssistantMessage("removed"),
    fauxAssistantMessage("returned"),
    call("select:mcp__local__echo"),
    fauxAssistantMessage("loaded again"),
  ]);
  const session = await open(fake);
  await session.run("load");
  await update([]);
  await session.reconnectMcp("local");
  await session.run("remove");
  expect(names(fake.contexts[2]!.messages)).not.toContain("mcp__local__echo");
  await update(["echo"]);
  await session.reconnectMcp("local");
  await session.run("return");
  expect(names(fake.contexts[3]!.messages)).not.toContain("mcp__local__echo");
  await session.run("load again");
  expect(names(fake.contexts[5]!.messages)).toContain("mcp__local__echo");
  const deferred = session.messages.flatMap((message) =>
    message.role === "system-reminder" && message.source === "deferred-tools"
      ? [message.content]
      : [],
  );
  expect(deferred).toEqual([
    "Deferred MCP tools (use ToolSearch to load their definitions):\n- mcp__local__echo",
    "Deferred MCP tools changed:\nRemoved:\n- mcp__local__echo",
    "Deferred MCP tools changed:\nAdded:\n- mcp__local__echo",
    "Deferred MCP tools changed:\nRemoved:\n- mcp__local__echo",
  ]);
});
test("resume retains discovery and rewind restores the pre-discovery branch", async () => {
  await fixture();
  const fake = model([
    fauxAssistantMessage("before"),
    call("select:mcp__local__echo"),
    fauxAssistantMessage("loaded"),
  ]);
  const session = await open(fake);
  await session.run("before");
  await session.run("load");
  const checkpoint = session.checkpoints()[1]!;
  await session.close();
  const next = model([fauxAssistantMessage("resumed"), fauxAssistantMessage("rewound")]);
  const resumed = await open(next, { resumeId: session.id });
  await resumed.run("resume");
  expect(names(next.contexts[0]!.messages)).toContain("mcp__local__echo");
  await resumed.rewind(checkpoint.promptEntryId, { code: false, conversation: true });
  await resumed.run("rewind");
  expect(names(next.contexts[1]!.messages)).not.toContain("mcp__local__echo");
});
test("ToolSearch runs normal PreToolUse and PostToolUse hooks without asking permission", async () => {
  await fixture();
  await Bun.write(join(dirs.cwd, "pre.sh"), "cat > pre.input\nprintf '{}'\n");
  await Bun.write(join(dirs.cwd, "post.sh"), "cat > post.input\nprintf '{}'\n");
  let asks = 0;
  const fake = model([call("select:mcp__local__echo"), fauxAssistantMessage("done")]);
  const session = await open(fake, {
    onPermissionAsk: async () => {
      asks++;
      return "deny";
    },
    settings: {
      toolSearch: "on",
      hooks: {
        PreToolUse: [{ matcher: "ToolSearch", hooks: [{ type: "command", command: "sh pre.sh" }] }],
        PostToolUse: [
          { matcher: "ToolSearch", hooks: [{ type: "command", command: "sh post.sh" }] },
        ],
      },
    },
  });
  await session.run("hooks");
  expect(asks).toBe(0);
  expect(await Bun.file(join(dirs.cwd, "pre.input")).json()).toMatchObject({
    tool_name: "ToolSearch",
  });
  expect(await Bun.file(join(dirs.cwd, "post.input")).json()).toMatchObject({
    tool_name: "ToolSearch",
  });
});

test("max_results rejects values above 20 without loading any tool", async () => {
  await fixture();
  const fake = model([call("echo", 21), fauxAssistantMessage("done")]);
  const session = await open(fake);
  await session.run("invalid limit");
  expect(
    fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({ isError: true, toolName: "ToolSearch" });
  expect(names(fake.contexts[1]!.messages)).not.toContain("mcp__local__echo");
});
test("OAuth authenticate is always offered and authorized tools arrive as deferred", async () => {
  dirs = await tempDirs();
  const server = mcpOAuthServer();
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    const fake = model([
      fauxAssistantMessage(fauxToolCall("mcp__srv__authenticate", {}), { stopReason: "toolUse" }),
      call("select:mcp__srv__echo"),
      fauxAssistantMessage(fauxToolCall("mcp__srv__echo", { text: "ok" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const session = await open(fake, {
      settings: { toolSearch: "on" },
      permissionMode: "full-access",
      onMcpAuth: async ({ authorizationUrl }) => {
        const response = await fetch(authorizationUrl, { redirect: "manual" });
        const url = response.headers.get("location");
        if (!url) throw new Error("Missing OAuth callback");
        return { type: "callback-url", url };
      },
    });
    await session.run("authenticate then search");
    expect(names(fake.contexts[0]!.messages)).toContain("mcp__srv__authenticate");
    expect(names(fake.contexts[0]!.messages)).not.toContain("ToolSearch");
    expect(names(fake.contexts[1]!.messages)).toContain("ToolSearch");
    expect(names(fake.contexts[1]!.messages)).not.toContain("mcp__srv__echo");
    expect(names(fake.contexts[2]!.messages)).toContain("mcp__srv__echo");
    expect(
      fake.contexts[3]!.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({ isError: false, toolName: "mcp__srv__echo" });
    await session.close();
  } finally {
    server.stop();
  }
});

test("aborting ToolSearch during preflight leaves its candidate deferred", async () => {
  await fixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const hookServer = Bun.serve({
    port: 0,
    fetch: async () => {
      entered.resolve();
      await release.promise;
      return Response.json({});
    },
  });
  try {
    const fake = model([call("select:mcp__local__echo"), fauxAssistantMessage("after abort")]);
    const session = await open(fake, {
      settings: {
        toolSearch: "on",
        hooks: {
          PreToolUse: [
            {
              matcher: "ToolSearch",
              hooks: [{ type: "http", url: `http://127.0.0.1:${hookServer.port}` }],
            },
          ],
        },
      },
    });
    const running = session.run("cancel search").then(
      () => undefined,
      (error: unknown) => error,
    );
    await entered.promise;
    session.abort();
    release.resolve();
    expect(await running).toBeInstanceOf(Error);
    await session.run("continue");
    expect(names(fake.contexts.at(-1)!.messages)).not.toContain("mcp__local__echo");
  } finally {
    release.resolve();
    await hookServer.stop(true);
  }
});
