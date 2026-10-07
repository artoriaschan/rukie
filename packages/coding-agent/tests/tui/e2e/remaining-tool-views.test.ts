import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { start } from "../helpers/app";

test("read paths, grouped search matches, and web Markdown render through Tool Views", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        "<h1>Docs</h1><p><strong>Read me</strong></p><p>two</p><p>three</p><p>hidden</p>",
        { headers: { "content-type": "text/html" } },
      ),
  });
  const url = `http://site.test:${server.port}/docs`;
  const app = await start(["--yolo", "inspect"], {
    rows: 50,
    prepare: async (root) => {
      await Bun.write(join(root, "source.ts"), "needle first\nneedle second");
    },
    session: {
      webFetch: {
        resolve: async () => [{ address: "127.0.0.1", family: 4 }],
        allowAddresses: ["127.0.0.1"],
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path: "source.ts" });
    await app.waitFor(() => app.calls.length === 2);
    await app.waitFor(() => app.allLines().join("\n").includes("⎿ needle first"));
    expect(app.allLines().join("\n")).toContain("读取 source.ts");
    expect(app.allLines().join("\n")).toContain("⎿ needle first");
    app.calls[1]!.tool("grep", { pattern: "needle", path: "source.ts" });
    await app.waitFor(() => app.calls.length === 3);
    await app.waitFor(() => app.allLines().join("\n").includes("1: needle first"));
    expect(app.allLines().join("\n")).toContain("⎿ source.ts");
    expect(app.allLines().join("\n")).toContain("1: needle first");
    expect(app.allLines().join("\n")).toContain("2: needle second");
    app.calls[2]!.tool("web_fetch", { url });
    await app.waitFor(() => app.calls.length === 4);
    app.calls[3]!.finish();
    await app.waitFor(() => !app.isWorking() && app.allLines().join("\n").includes("Read me"));
    const text = app.allLines().join("\n");
    expect(text).toContain(url);
    expect(text).toContain("Docs");
    expect(text).toContain("Read me");
    expect(text).not.toContain("# Docs");
    expect(text).not.toContain("**Read me**");
    expect(text).not.toContain("hidden");
    expect(text).toContain("ctrl+o");
  } finally {
    await app.cleanup();
    server.stop(true);
  }
});

test("MCP identity, path lists and goal summaries render as their declared views", async () => {
  const app = await start(["--yolo", "inspect"], {
    rows: 60,
    prepare: async (root) => {
      await Bun.write(join(root, "source.ts"), "hello");
      const manifest = join(root, "manifest.json");
      await Bun.write(manifest, JSON.stringify({ tools: ["echo"] }));
      await Bun.write(
        join(root, ".rukie", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            local: {
              command: process.execPath,
              args: [
                fileURLToPath(
                  new URL("../../../../agent/tests/helpers/mcp-server.ts", import.meta.url),
                ),
              ],
              env: {
                MCP_MANIFEST: manifest,
                MCP_PIDS: join(root, "pids"),
                MCP_CALLS: join(root, "calls"),
              },
            },
          },
        }),
      );
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("mcp__local__echo", { text: "hello" });
    await app.waitFor(
      () => app.calls.length === 2 && app.allLines().join("\n").includes("MCP: hello"),
    );
    expect(app.allLines().join("\n")).toContain("local › echo");
    app.calls[1]!.tool("glob", { pattern: "*.ts" });
    await app.waitFor(
      () => app.calls.length === 3 && app.allLines().join("\n").includes("⎿ source.ts"),
    );
    app.calls[2]!.tool("create_goal", { objective: "Verify release" });
    await app.waitFor(
      () => app.calls.length === 4 && app.allLines().join("\n").includes("⎿ Verify release"),
    );
    expect(app.allLines().join("\n")).not.toContain('"roundsStarted"');
    app.calls[3]!.tool("update_goal", { action: "pause" });
    await app.waitFor(() => app.calls.length === 5);
    app.calls[4]!.tool("job_list", {});
    await app.waitFor(
      () => app.calls.length === 6 && app.allLines().join("\n").includes("no background jobs"),
    );
    app.calls[5]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.allLines().join("\n")).toContain("任务列表");
  } finally {
    await app.cleanup();
  }
});
