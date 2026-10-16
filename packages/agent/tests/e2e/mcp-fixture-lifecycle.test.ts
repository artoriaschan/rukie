import { expect, jest, test } from "bun:test";
import { join } from "node:path";
import { ownMcpFixture } from "../helpers/owned-mcp.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

test("runner timeout releases a pending MCP fixture before the next case owns the clock", async () => {
  const owner = ownMcpFixture();
  const dirs = await owner.acquire(tempDirs, (value) => value.cleanup());
  const path = join(dirs.cwd, "timeout.test.ts");
  const helper = new URL("../helpers/owned-mcp.ts", import.meta.url).pathname;
  const temp = new URL("../helpers/temp-dirs.ts", import.meta.url).pathname;
  const http = new URL("../helpers/mcp-oauth-server.ts", import.meta.url).pathname;
  const core = new URL("../../src/index.ts", import.meta.url).pathname;
  await Bun.write(
    path,
    `import { beforeEach, expect, jest, test } from "bun:test";
import { join } from "node:path";
import { ownMcpFixture } from ${JSON.stringify(helper)};
import { tempDirs } from ${JSON.stringify(temp)};
import { mcpOAuthServer } from ${JSON.stringify(http)};
import { createMcpHost } from ${JSON.stringify(core)};
let owner, host, view, server, pending;
let prepared = false;
let expiredBodyResumed = false;
beforeEach(async () => {
  if (prepared) return;
  prepared = true;
  owner = ownMcpFixture();
  const dirs = await owner.acquire(tempDirs, value => value.cleanup());
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  owner.unblock(() => release.resolve());
  server = owner.own(mcpOAuthServer({ authentication: false, beforeInitialize: async () => {
    entered.resolve();
    await release.promise;
  } }), value => value.stop());
  host = owner.own(createMcpHost(), value => value.close());
  view = host.acquire({ connectOptions: () => ({ ...dirs, settings: {} }),
    getRunning: () => false, onChange: () => {}, onEvent: () => {} });
  await Bun.write(join(dirs.homeDir, ".rukie/mcp.json"), JSON.stringify({ mcpServers: { srv: { url: server.url } } }));
  pending = owner.acquire(() => view.prepareRun(), () => {});
  await entered.promise;
  owner.fakeTimers();
  jest.setSystemTime(0);
});
test("expired owner", async () => {
  // Initialization is already suspended before Bun starts this body deadline.
  try { await pending; } finally { expiredBodyResumed = true; }
}, 50);
test("next owner", async () => {
  expect(expiredBodyResumed).toBe(false);
  expect(Date.now()).toBeGreaterThan(1_000_000_000_000);
  expect(server.requests.filter(request => request.method === "DELETE")).toHaveLength(1);
  await expect(view.prepareRun()).rejects.toThrow("MCP view has been closed");
  await owner.close();
});
`,
  );
  try {
    // A real Bun child owns the timeout; a parent virtual clock cannot expire its runner.
    let output: Promise<string[]> | undefined;
    const child = owner.own(
      Bun.spawn([process.execPath, "test", path], {
        cwd: dirs.cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NO_COLOR: "1" },
      }),
      async (child) => {
        child.kill();
        await child.exited;
        await output;
      },
    );
    output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(await child.exited).toBe(1);
    const log = (await output).join("\n");
    expect(log).toContain("this test timed out after 50ms");
    expect(log).toContain("1 pass");
    expect(log).toContain("1 fail");
    expect(log).not.toContain("Unhandled error between tests");
  } finally {
    await owner.close();
  }
});

test("MCP cleanup owns a resource initialized after closure and restores its clock only once", async () => {
  const owner = ownMcpFixture();
  const later = ownMcpFixture();
  const initializing = Promise.withResolvers<string>();
  const released: string[] = [];
  owner.fakeTimers();
  jest.setSystemTime(0);
  void owner.acquire(
    () => initializing.promise,
    (resource) => {
      expect(Date.now()).toBe(0);
      released.push(resource);
    },
  );
  try {
    const closing = owner.close();
    expect(released).toEqual([]);
    initializing.resolve("late MCP owner");
    await closing;
    expect(released).toEqual(["late MCP owner"]);
    expect(Date.now()).toBeGreaterThan(1_000_000_000_000);
    // A late finally shares this Promise and cannot restore a subsequent owner's clock.
    later.fakeTimers();
    jest.setSystemTime(42);
    await owner.close();
    expect(Date.now()).toBe(42);
  } finally {
    await owner.close();
    await later.close();
  }
});
