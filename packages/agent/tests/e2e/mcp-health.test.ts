import { ownMcpFixture } from "../helpers/owned-mcp.ts";
import { expect, test, jest } from "bun:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { fakeModel } from "../helpers/fake-model.ts";
import { createMcpHost, createSession } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { mcpOAuthServer } from "../helpers/mcp-oauth-server.ts";

test("Host snapshots expose pending without waiting for initialization and Run cancellation only cancels its wait", async () => {
  const owner = ownMcpFixture();
  const dirs = await owner.acquire(tempDirs, (dirs) => dirs.cleanup());
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  owner.unblock(() => release.resolve());
  const server = owner.own(
    mcpOAuthServer({
      authentication: false,
      beforeInitialize: async () => {
        entered.resolve();
        await release.promise;
      },
    }),
    (resource) => resource.stop(),
  );
  const host = owner.own(createMcpHost(), (resource) => resource.close());
  const view = owner.own(
    host.acquire({
      connectOptions: () => ({ ...dirs, settings: {} }),
      getRunning: () => false,
      onChange: () => {},
      onEvent: () => {},
    }),
    (resource) => resource.close(),
  );
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    const reading = view.snapshot();
    await entered.promise;
    // Public state reads must settle while the protocol initialize remains blocked.
    expect((await reading).servers).toMatchObject([{ status: "pending", tools: [], toolCount: 0 }]);
    const controller = new AbortController();
    const waiting = view.prepareRun({ signal: controller.signal });
    controller.abort(new Error("cancel this Run"));
    await expect(waiting).rejects.toThrow("cancel this Run");
    expect(server.requests.some((request) => request.method === "DELETE")).toBe(false);
    release.resolve();
    await owner.prepareRun(view);
    expect((await view.snapshot()).servers).toMatchObject([{ status: "connected", toolCount: 1 }]);
  } finally {
    await owner.close();
  }
}, 1000);

test("unexpected stdio close exposes pending, retries at virtual deadlines and stops after five early disconnects", async () => {
  const owner = ownMcpFixture();
  const dirs = await owner.acquire(tempDirs, (dirs) => dirs.cleanup());
  const manifest = join(dirs.homeDir, "manifest");
  await Bun.write(manifest, JSON.stringify({ tools: ["crash"] }));
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({
      mcpServers: {
        srv: {
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
  const host = owner.own(createMcpHost(), (resource) => resource.close());
  let changed = Promise.withResolvers<void>();
  const view = owner.own(
    host.acquire({
      connectOptions: () => ({ ...dirs, settings: {} }),
      getRunning: () => false,
      onChange: () => changed.resolve(),
      onEvent: () => {},
    }),
    (resource) => resource.close(),
  );
  // The child really exits; only the supervisor's parent-process deadlines use virtual time.
  try {
    await owner.prepareRun(view);
    owner.fakeTimers();
    for (let attempt = 0; attempt < 6; attempt++) {
      changed = Promise.withResolvers<void>();
      await expect(
        view.callHookTool("srv", "crash", {}, new AbortController().signal),
      ).rejects.toThrow();
      await changed.promise;
      expect((await view.snapshot()).servers[0]).toMatchObject({
        status: attempt === 5 ? "failed" : "pending",
        toolCount: 0,
        tools: [],
      });
      if (attempt === 5) break;
      jest.advanceTimersByTime([1000, 2000, 4000, 8000, 16000][attempt]! - 1);
      expect((await view.snapshot()).servers[0]?.status).toBe("pending");
      jest.advanceTimersByTime(1);
      await owner.prepareRun(view);
      expect((await view.snapshot()).servers[0]?.status).toBe("connected");
    }
    jest.advanceTimersByTime(30_000);
    expect((await view.snapshot()).servers[0]?.status).toBe("failed");
  } finally {
    await owner.close();
  }
});

test.each([false, true])(
  "same-name MCP description and schema changes reach the next Turn (child: %s)",
  async (child) => {
    const owner = ownMcpFixture();
    const dirs = await owner.acquire(tempDirs, (dirs) => dirs.cleanup());
    const manifest = join(dirs.homeDir, "manifest");
    const write = (description: string) =>
      Bun.write(
        manifest,
        JSON.stringify({
          tools: ["echo", "notify"],
          toolDescriptions: { echo: description },
          toolSchemas: {
            echo: { type: "object", properties: { [description]: { type: "string" } } },
          },
        }),
      );
    await write("old");
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({
        mcpServers: {
          srv: {
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
    const host = owner.own(createMcpHost(), (resource) => resource.close());
    let changed = Promise.withResolvers<void>();
    const view = owner.own(
      host.acquire({
        connectOptions: () => ({ ...dirs, settings: {} }),
        getRunning: () => false,
        onChange: (snapshot) => {
          if (
            snapshot.servers[0]?.tools.find((tool) => tool.name === "echo")?.description === "new"
          )
            changed.resolve();
        },
        onEvent: () => {},
      }),
      (resource) => resource.close(),
    );
    let session: Awaited<ReturnType<typeof createSession>> | undefined;
    try {
      await owner.prepareRun(view);
      const update = async () => {
        await write("new");
        await view.callHookTool("srv", "notify", {}, new AbortController().signal);
        await changed.promise;
        return fauxAssistantMessage(fauxToolCall("mcp__srv__echo", { new: "input" }), {
          stopReason: "toolUse",
        });
      };
      const fake = fakeModel([
        ...(child
          ? [
              fauxAssistantMessage(
                fauxToolCall("subagent", {
                  description: "MCP child",
                  prompt: "update MCP",
                  run_in_background: false,
                }),
                { stopReason: "toolUse" },
              ),
            ]
          : []),
        update,
        fauxAssistantMessage("updated"),
        ...(child ? [fauxAssistantMessage("parent done")] : []),
      ]);
      session = await owner.open({
        ...dirs,
        ...fake,
        mcpHost: host,
        permissionMode: "full-access",
        settings: { toolSearch: "off" },
      });
      expect((await session.run("update MCP")).success).toBe(true);
      expect(
        getCurrentTools(fake.contexts[child ? 2 : 1]!.messages).find(
          (tool) => tool.name === "mcp__srv__echo",
        ),
      ).toMatchObject({
        description: "new",
        parameters: { properties: { new: { type: "string" } } },
      });
    } finally {
      await owner.close();
    }
  },
);

test("failed list_changed preserves the previous tools and warns, then a later notification atomically replaces them", async () => {
  const owner = ownMcpFixture();
  const dirs = await owner.acquire(tempDirs, (dirs) => dirs.cleanup());
  const manifest = join(dirs.homeDir, "manifest");
  await Bun.write(manifest, JSON.stringify({ tools: ["notify", "echo"] }));
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({
      mcpServers: {
        srv: {
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
  const warned = Promise.withResolvers<string>();
  const updated = Promise.withResolvers<void>();
  const host = owner.own(createMcpHost(), (resource) => resource.close());
  const view = owner.own(
    host.acquire({
      connectOptions: () => ({
        ...dirs,
        settings: {},
        onWarning: (message) => warned.resolve(message),
      }),
      getRunning: () => false,
      onChange: (snapshot) => {
        if (snapshot.servers[0]?.tools.some((tool) => tool.name === "new")) updated.resolve();
      },
      onEvent: () => {},
    }),
    (resource) => resource.close(),
  );
  try {
    await owner.prepareRun(view);
    const original = await view.snapshot();
    await Bun.write(manifest, JSON.stringify({ tools: ["notify", "new"], failList: true }));
    await view.callHookTool("srv", "notify", {}, new AbortController().signal);
    expect(await warned.promise).toContain("Discovery failed");
    expect(await view.snapshot()).toEqual(original);
    await Bun.write(manifest, JSON.stringify({ tools: ["notify", "new"] }));
    await view.callHookTool("srv", "notify", {}, new AbortController().signal);
    await updated.promise;
    expect((await view.snapshot()).servers[0]).toMatchObject({
      status: "connected",
      toolCount: 2,
      tools: [{ name: "notify" }, { name: "new" }],
    });
  } finally {
    await owner.close();
  }
});

test("thirty continuous healthy seconds reset recovery and cancelling a Run during backoff leaves recovery shared", async () => {
  const owner = ownMcpFixture();
  const dirs = await owner.acquire(tempDirs, (dirs) => dirs.cleanup());
  const manifest = join(dirs.homeDir, "manifest");
  await Bun.write(manifest, JSON.stringify({ tools: ["crash"] }));
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({
      mcpServers: {
        srv: {
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
  const host = owner.own(createMcpHost(), (resource) => resource.close());
  let changed = Promise.withResolvers<void>();
  const view = owner.own(
    host.acquire({
      connectOptions: () => ({ ...dirs, settings: {} }),
      getRunning: () => false,
      onChange: () => changed.resolve(),
      onEvent: () => {},
    }),
    (resource) => resource.close(),
  );
  try {
    await owner.prepareRun(view);
    owner.fakeTimers();
    const crash = async () => {
      changed = Promise.withResolvers<void>();
      await expect(
        view.callHookTool("srv", "crash", {}, new AbortController().signal),
      ).rejects.toThrow();
      await changed.promise;
    };
    await crash();
    const controller = new AbortController();
    const waiting = view.prepareRun({ signal: controller.signal });
    controller.abort(new Error("cancel backoff wait"));
    await expect(waiting).rejects.toThrow("cancel backoff wait");
    jest.advanceTimersByTime(1000);
    await owner.prepareRun(view);
    jest.advanceTimersByTime(29_999);
    await crash();
    jest.advanceTimersByTime(1000);
    expect((await view.snapshot()).servers[0]?.status).toBe("pending");
    jest.advanceTimersByTime(999);
    expect((await view.snapshot()).servers[0]?.status).toBe("pending");
    jest.advanceTimersByTime(1);
    await owner.prepareRun(view);
    jest.advanceTimersByTime(29_999);
    expect((await view.snapshot()).servers[0]?.status).toBe("connected");
    jest.advanceTimersByTime(1);
    await crash();
    jest.advanceTimersByTime(999);
    expect((await view.snapshot()).servers[0]?.status).toBe("pending");
    jest.advanceTimersByTime(1);
    await owner.prepareRun(view);
    expect((await view.snapshot()).servers[0]?.status).toBe("connected");
  } finally {
    await owner.close();
  }
});

test("list_changed notifications serialize whole paginated discovery and publish no partial generation", async () => {
  const owner = ownMcpFixture();
  const dirs = await owner.acquire(tempDirs, (dirs) => dirs.cleanup());
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  owner.unblock(() => release.resolve());
  const updated = Promise.withResolvers<void>();
  let requests = 0;
  let listing = false;
  let maximum = 0;
  let active = 0;
  const old = { name: "old", description: "old", inputSchema: { type: "object" } };
  const latest = { name: "new", description: "new", inputSchema: { type: "object" } };
  const server = owner.own(
    mcpOAuthServer({
      authentication: false,
      notifyToolsChanged: 2,
      listTools: async (cursor) => {
        requests++;
        active++;
        maximum = Math.max(maximum, active);
        try {
          if (!listing) return { tools: [old] };
          if (requests === 2) {
            entered.resolve();
            await release.promise;
            return { tools: [latest], nextCursor: "second" };
          }
          if (cursor === "second")
            return { tools: [{ name: "last", inputSchema: { type: "object" } }] };
          return { tools: [latest, { name: "last", inputSchema: { type: "object" } }] };
        } finally {
          active--;
        }
      },
    }),
    (resource) => resource.stop(),
  );
  const host = owner.own(createMcpHost(), (resource) => resource.close());
  const changes: string[][] = [];
  const view = owner.own(
    host.acquire({
      connectOptions: () => ({ ...dirs, settings: {} }),
      getRunning: () => false,
      onChange: (snapshot) => {
        const names = snapshot.servers[0]?.tools.map((tool) => tool.name) ?? [];
        changes.push(names);
        if (names.includes("last")) updated.resolve();
      },
      onEvent: () => {},
    }),
    (resource) => resource.close(),
  );
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    await owner.prepareRun(view);
    listing = true;
    await view.callHookTool("srv", "notify", {}, new AbortController().signal);
    await entered.promise;
    expect(requests).toBe(2);
    expect((await view.snapshot()).servers[0]?.tools).toMatchObject([{ name: "old" }]);
    release.resolve();
    await updated.promise;
    await view.prepareTurn();
    expect(maximum).toBe(1);
    expect(requests).toBe(4);
    expect(changes.filter((names) => names.includes("new"))).toEqual([["new", "last"]]);
  } finally {
    await owner.close();
  }
});

test("reconnect awaits the original transport shutdown before initializing a replacement", async () => {
  const owner = ownMcpFixture();
  const dirs = await owner.acquire(tempDirs, (dirs) => dirs.cleanup());
  const deleting = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  owner.unblock(() => release.resolve());
  let initializations = 0;
  const server = owner.own(
    mcpOAuthServer({
      authentication: false,
      beforeInitialize: async () => {
        initializations++;
      },
      onDelete: async () => {
        deleting.resolve();
        await release.promise;
      },
    }),
    (resource) => resource.stop(),
  );
  const host = owner.own(createMcpHost(), (resource) => resource.close());
  const view = owner.own(
    host.acquire({
      connectOptions: () => ({ ...dirs, settings: {} }),
      getRunning: () => false,
      onChange: () => {},
      onEvent: () => {},
    }),
    (resource) => resource.close(),
  );
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    await owner.prepareRun(view);
    const reconnect = view.reconnect("srv");
    await deleting.promise;
    expect(initializations).toBe(1);
    expect(server.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
    release.resolve();
    await reconnect;
    expect(initializations).toBe(2);
  } finally {
    await owner.close();
  }
});

test("late tool discovery from a retired generation cannot replace current tools", async () => {
  const owner = ownMcpFixture();
  const dirs = await owner.acquire(tempDirs, (dirs) => dirs.cleanup());
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  owner.unblock(() => release.resolve());
  let listings = 0;
  const server = owner.own(
    mcpOAuthServer({
      authentication: false,
      notifyToolsChanged: 1,
      listTools: async () => {
        const generation = ++listings;
        if (generation === 2) {
          entered.resolve();
          await release.promise;
        }
        return {
          tools: [
            {
              name: generation === 2 ? "stale" : generation === 1 ? "old" : "current",
              inputSchema: { type: "object" },
            },
          ],
        };
      },
    }),
    (resource) => resource.stop(),
  );
  const host = owner.own(createMcpHost(), (resource) => resource.close());
  const warnings: string[] = [];
  const view = owner.own(
    host.acquire({
      connectOptions: () => ({
        ...dirs,
        settings: {},
        onWarning: (message) => warnings.push(message),
      }),
      getRunning: () => false,
      onChange: () => {},
      onEvent: () => {},
    }),
    (resource) => resource.close(),
  );
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    await owner.prepareRun(view);
    await view.callHookTool("srv", "notify", {}, new AbortController().signal);
    await entered.promise;
    await view.reconnect("srv");
    release.resolve();
    await view.prepareTurn();
    expect((await view.snapshot()).servers[0]?.tools).toMatchObject([{ name: "current" }]);
    expect(warnings).toEqual([]);
  } finally {
    await owner.close();
  }
});

test("needs-auth and intentional retirement never start recovery", async () => {
  const owner = ownMcpFixture();
  const dirs = await owner.acquire(tempDirs, (dirs) => dirs.cleanup());
  const server = owner.own(mcpOAuthServer(), (resource) => resource.stop());
  const host = owner.own(createMcpHost(), (resource) => resource.close());
  const view = owner.own(
    host.acquire({
      connectOptions: () => ({ ...dirs, settings: {} }),
      getRunning: () => false,
      onChange: () => {},
      onEvent: () => {},
    }),
    (resource) => resource.close(),
  );
  try {
    await Bun.write(
      join(dirs.homeDir, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    await owner.prepareRun(view);
    const requests = server.requests.length;
    owner.fakeTimers();
    jest.advanceTimersByTime(120_000);
    await owner.prepareRun(view);
    expect((await view.snapshot()).servers[0]?.status).toBe("needs-auth");
    expect(server.requests).toHaveLength(requests);
    await host.close();
    jest.advanceTimersByTime(120_000);
    expect(server.requests).toHaveLength(requests);
  } finally {
    await owner.close();
  }
});

test("a model response holding a disconnected MCP tool receives an error without waiting for recovery", async () => {
  const owner = ownMcpFixture();
  const dirs = await owner.acquire(tempDirs, (dirs) => dirs.cleanup());
  const manifest = join(dirs.homeDir, "manifest");
  await Bun.write(manifest, JSON.stringify({ tools: ["crash", "echo"] }));
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({
      mcpServers: {
        srv: {
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
  const host = owner.own(createMcpHost(), (resource) => resource.close());
  let changed = Promise.withResolvers<void>();
  const view = owner.own(
    host.acquire({
      connectOptions: () => ({ ...dirs, settings: {} }),
      getRunning: () => false,
      onChange: () => changed.resolve(),
      onEvent: () => {},
    }),
    (resource) => resource.close(),
  );
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  try {
    await owner.prepareRun(view);
    const fake = fakeModel([
      async () => {
        owner.fakeTimers();
        changed = Promise.withResolvers<void>();
        await expect(
          view.callHookTool("srv", "crash", {}, new AbortController().signal),
        ).rejects.toThrow();
        await changed.promise;
        return fauxAssistantMessage(fauxToolCall("mcp__srv__echo", { text: "old request" }), {
          stopReason: "toolUse",
        });
      },
      fauxAssistantMessage("handled disconnect"),
    ]);
    session = await owner.open({
      ...dirs,
      ...fake,
      mcpHost: host,
      permissionMode: "full-access",
    });
    expect((await session.run("disconnect while generating")).success).toBe(true);
    expect(
      fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({ isError: true });
    expect((await Bun.file(join(dirs.homeDir, "calls")).text()).trim().split("\n")).toEqual([
      "crash",
    ]);
    expect((await view.snapshot()).servers[0]?.status).toBe("pending");
  } finally {
    await owner.close();
  }
});

test("Run preparation also waits for a replacement configuration discovered after initial connection", async () => {
  const owner = ownMcpFixture();
  const dirs = await owner.acquire(tempDirs, (dirs) => dirs.cleanup());
  const firstEntered = Promise.withResolvers<void>();
  const firstRelease = Promise.withResolvers<void>();
  owner.unblock(() => firstRelease.resolve());
  const latestEntered = Promise.withResolvers<void>();
  const latestRelease = Promise.withResolvers<void>();
  owner.unblock(() => latestRelease.resolve());
  const first = owner.own(
    mcpOAuthServer({
      authentication: false,
      beforeInitialize: async () => {
        firstEntered.resolve();
        await firstRelease.promise;
      },
    }),
    (resource) => resource.stop(),
  );
  const latest = owner.own(
    mcpOAuthServer({
      authentication: false,
      beforeInitialize: async () => {
        latestEntered.resolve();
        await latestRelease.promise;
      },
    }),
    (resource) => resource.stop(),
  );
  const path = join(dirs.homeDir, ".rukie/mcp.json");
  const configure = (url: string) =>
    Bun.write(path, JSON.stringify({ mcpServers: { srv: { url } } }));
  const host = owner.own(createMcpHost(), (resource) => resource.close());
  const view = owner.own(
    host.acquire({
      connectOptions: () => ({ ...dirs, settings: {} }),
      getRunning: () => false,
      onChange: () => {},
      onEvent: () => {},
    }),
    (resource) => resource.close(),
  );
  let preparing: Promise<void> | undefined;
  try {
    await configure(first.url);
    let complete = false;
    preparing = owner.prepareRun(view).then(() => {
      complete = true;
    });
    await firstEntered.promise;
    await configure(latest.url);
    firstRelease.resolve();
    await latestEntered.promise;
    expect(complete).toBe(false);
    expect((await view.snapshot()).servers[0]?.status).toBe("pending");
    latestRelease.resolve();
    await preparing;
    expect((await view.snapshot()).servers[0]).toMatchObject({
      url: latest.url,
      status: "connected",
    });
  } finally {
    await owner.close();
  }
});
