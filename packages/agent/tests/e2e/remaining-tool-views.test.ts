import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

test("read, grep and glob expose structured facts live and after Session Resume", async () => {
  const dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "source.ts"), "one\nneedle first\nneedle second");
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("read", { path: "source.ts", offset: 2, limit: 1 }),
        fauxToolCall("grep", { pattern: "needle", path: "source.ts" }),
        fauxToolCall("glob", { pattern: "*.ts" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  let resumed: Awaited<ReturnType<typeof createSession>> | undefined;
  try {
    const events: SessionEvent[] = [];
    await session.run("inspect sources", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const ends = events.filter((event) => event.type === "tool_execution_end");
    expect(ends.find((event) => event.toolName === "read")?.view).toMatchObject({
      card: "read",
      kind: "read",
      displayKey: "tool.read",
      path: "source.ts",
      offset: 2,
      content: expect.stringContaining("needle first"),
    });
    expect(ends.find((event) => event.toolName === "grep")?.view).toEqual({
      card: "search",
      kind: "search",
      displayKey: "tool.grep",
      shape: "matches",
      matches: [
        { path: "source.ts", line: 2, text: "needle first" },
        { path: "source.ts", line: 3, text: "needle second" },
      ],
      total: 2,
    });
    expect(ends.find((event) => event.toolName === "glob")?.view).toEqual({
      card: "search",
      kind: "search",
      displayKey: "tool.glob",
      shape: "paths",
      paths: ["source.ts"],
      total: 1,
    });
    await session.close();
    resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    const results = resumed.messages.filter((message) => message.role === "toolResult");
    for (const message of results)
      expect(message.view).toEqual(
        ends.find((event) => event.toolCallId === message.toolCallId)?.view,
      );
  } finally {
    await resumed?.close();
    await session.close();
    await dirs.cleanup();
  }
});

test("web results preserve Markdown separately from model notices and HTTP metadata", async () => {
  const dirs = await tempDirs();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response("<h1>Docs</h1><p><strong>Read me</strong></p>", {
        headers: { "content-type": "text/html" },
      }),
  });
  const url = `http://site.test:${server.port}/docs`;
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("web_fetch", { url }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    webFetch: {
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
      allowAddresses: ["127.0.0.1"],
    },
  });
  try {
    const events: SessionEvent[] = [];
    await session.run("read docs", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(events.find((event) => event.type === "tool_execution_start")).toMatchObject({
      view: { card: "generic", kind: "fetch", displayKey: "tool.web_fetch", title: url },
    });
    expect(events.find((event) => event.type === "tool_execution_end")).toMatchObject({
      view: {
        card: "web",
        kind: "fetch",
        displayKey: "tool.web_fetch",
        url,
        markdown: "# Docs\n\n**Read me**",
      },
    });
  } finally {
    await session.close();
    server.stop(true);
    await dirs.cleanup();
  }
});

test("goal and job controls expose compact generic summaries", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("create_goal", { objective: "Verify release" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("update_goal", { action: "pause" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("job_list", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    const events: SessionEvent[] = [];
    await session.run("create and immediately pause goal", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const ends = events.filter((event) => event.type === "tool_execution_end");
    expect(ends.find((event) => event.toolName === "create_goal")).toMatchObject({
      view: {
        card: "generic",
        kind: "task",
        displayKey: "tool.create_goal",
        text: "Verify release",
      },
    });
    expect(ends.find((event) => event.toolName === "update_goal")).toMatchObject({
      view: {
        card: "generic",
        kind: "task",
        displayKey: "tool.update_goal",
        text: "Verify release",
      },
    });
    expect(ends.find((event) => event.toolName === "job_list")).toMatchObject({
      view: {
        card: "generic",
        kind: "execute",
        displayKey: "tool.job_list",
        text: "(no background jobs)",
      },
    });
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

test("MCP views carry server and tool facts and disappear safely when resumed offline", async () => {
  const dirs = await tempDirs();
  const manifest = join(dirs.homeDir, "manifest.json");
  await Bun.write(manifest, JSON.stringify({ tools: ["echo"] }));
  await Bun.write(
    join(dirs.homeDir, ".rukie", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        local: {
          command: process.execPath,
          args: [fileURLToPath(new URL("../helpers/mcp-server.ts", import.meta.url))],
          env: {
            MCP_MANIFEST: manifest,
            MCP_PIDS: join(dirs.homeDir, "pids"),
            MCP_CALLS: join(dirs.homeDir, "calls"),
          },
        },
      },
    }),
  );
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("mcp__local__echo", { text: "hello" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  let resumed: Awaited<ReturnType<typeof createSession>> | undefined;
  try {
    const events: SessionEvent[] = [];
    await session.run("echo", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(events.find((event) => event.type === "tool_execution_start")).toMatchObject({
      view: {
        card: "generic",
        kind: "other",
        server: "local",
        tool: "echo",
        rawInput: { text: "hello" },
      },
    });
    expect(events.find((event) => event.type === "tool_execution_end")).toMatchObject({
      view: { card: "generic", kind: "other", text: "MCP: hello" },
    });
    await session.close();
    await Bun.write(join(dirs.homeDir, ".rukie", "mcp.json"), "{}");
    resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    const result = resumed.messages.find((message) => message.role === "toolResult");
    expect(result?.view).toBeUndefined();
    expect(JSON.stringify(result)).toContain("MCP: hello");
  } finally {
    await resumed?.close();
    await session.close();
    await dirs.cleanup();
  }
});

test("truncated search views retain the total without replaying the filesystem", async () => {
  const dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "many.txt"), "needle\n".repeat(2100));
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("grep", { pattern: "needle", path: "many.txt" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    await session.run("search");
    const result = session.messages.find((message) => message.role === "toolResult");
    expect(result?.view).toMatchObject({ card: "search", shape: "matches", total: 2100 });
    if (result?.view?.card !== "search" || result.view.shape !== "matches")
      throw new Error("Expected matches");
    expect(result.view.matches.length).toBeLessThan(2100);
    await Bun.write(join(dirs.cwd, "many.txt"), "changed");
    expect(session.messages.find((message) => message.role === "toolResult")?.view).toEqual(
      result.view,
    );
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

test("background bash and job output and cancellation retain generic views", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: "printf ready",
        description: "Print background output",
        run_in_background: true,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("job_output", { job_id: "bash-1", wait: true }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("job_kill", { job_id: "bash-1" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  try {
    const events: SessionEvent[] = [];
    await session.run("start and inspect job", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const ends = events.filter((event) => event.type === "tool_execution_end");
    expect(ends.find((event) => event.toolName === "bash")).toMatchObject({
      view: { card: "generic", kind: "execute", displayKey: "tool.bash" },
    });
    expect(ends.find((event) => event.toolName === "job_output")).toMatchObject({
      result: { isError: false },
      view: {
        card: "generic",
        kind: "execute",
        displayKey: "tool.job_output",
        text: expect.stringContaining("ready"),
      },
    });
    expect(ends.find((event) => event.toolName === "job_kill")).toMatchObject({
      result: { isError: false },
      view: { card: "generic", kind: "execute", displayKey: "tool.job_kill" },
    });
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

test("grep keeps colon-containing file paths separate from match line numbers", async () => {
  const dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "part:12:name.ts"), "needle");
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("grep", { pattern: "needle", path: "part:12:name.ts" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    await session.run("search");
    expect(session.messages.find((message) => message.role === "toolResult")?.view).toMatchObject({
      card: "search",
      shape: "matches",
      matches: [{ path: "part:12:name.ts", line: 1, text: "needle" }],
    });
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});
