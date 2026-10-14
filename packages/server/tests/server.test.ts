import { ownResources } from "./helpers/owned-resources.ts";
import FakeTimers from "@sinonjs/fake-timers";
import { expect, test, spyOn } from "bun:test";
import * as filesystem from "node:fs/promises";
import { mkdtemp, rm, realpath, mkdir, writeFile, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { waitForPidFile } from "../../agent/tests/helpers/wait-for-file.ts";
import { join } from "node:path";
import {
  createSession,
  createSessionStore,
  listSessions,
  readSessionSnapshot,
  openBunSqliteDatabase,
} from "@rukie/agent";
import { crashUnsafeEffect } from "../../agent/tests/helpers/native-recovery.ts";
import { startServer as startServerImpl, AppDatabase, type ServerOptions } from "../src/index.ts";

const startServer = (options: Omit<ServerOptions, "dataRoot">) =>
  startServerImpl({ ...options, dataRoot: join(options.homeDir, "desktop-data") });

test("conversation workspaces are independent and deletion removes their files", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-conversation-workspace-")),
      (path) => rm(path, { recursive: true, force: true }),
    );
    const server = await owner.acquire(
      () =>
        startServer({
          homeDir,
          sessionOptions: fakeModel([fauxAssistantMessage("done")]),
          onHandshake: () => {},
        }),
      (server) => server.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    const first = (await client.command("session.create", { project: null, text: "first" }))
      .result as { sessionId: string };
    await client.next(
      (message) => message.type === "result" && message.sessionId === first.sessionId,
    );
    const second = (await client.command("session.create", { project: null, text: "second" }))
      .result as { sessionId: string };
    await client.next(
      (message) => message.type === "result" && message.sessionId === second.sessionId,
    );
    const summaries = (await client.command("sessions.list")).result as {
      id: string;
      cwd: string;
    }[];
    const firstCwd = summaries.find((session) => session.id === first.sessionId)!.cwd;
    const secondCwd = summaries.find((session) => session.id === second.sessionId)!.cwd;
    expect(firstCwd).not.toBe(secondCwd);
    for (const cwd of [firstCwd, secondCwd]) {
      expect(cwd.slice(0, cwd.lastIndexOf("/"))).toBe(join(homeDir, "desktop-data", "workspace"));
      expect((await stat(cwd)).isDirectory()).toBe(true);
    }
    await writeFile(join(firstCwd, "owned.txt"), "owned");
    expect(
      (await client.command("session.delete", { sessionId: first.sessionId })).error,
    ).toBeUndefined();
    expect(await Bun.file(join(firstCwd, "owned.txt")).exists()).toBe(false);
    expect(
      await filesystem.access(firstCwd).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect((await stat(secondCwd)).isDirectory()).toBe(true);
  } finally {
    await owner.close();
  }
});

test.each(["project", "root", "symlink", "outside", "ancestor-symlink"] as const)(
  "conversation deletion preserves %s directories",
  async (kind) => {
    const owner = ownResources();
    try {
      const homeDir = await owner.acquire(
        () => mkdtemp(join(tmpdir(), "rukie-workspace-delete-boundary-")),
        (path) => rm(path, { recursive: true, force: true }),
      );
      const workspace = join(homeDir, "desktop-data", "workspace");
      await mkdir(workspace, { recursive: true });
      const outside = join(homeDir, "project");
      await mkdir(outside);
      const link = join(workspace, "link");
      if (kind === "symlink") await symlink(outside, link);
      const cwd =
        kind === "root"
          ? workspace
          : kind === "symlink"
            ? link
            : kind === "ancestor-symlink"
              ? join(workspace, "child")
              : outside;
      await mkdir(cwd, { recursive: true });
      await writeFile(join(cwd, "keep.txt"), "keep");
      const history = await owner.acquire(
        () =>
          createSession({
            homeDir,
            dataRoot: join(homeDir, "desktop-data"),
            cwd,
            ...fakeModel([fauxAssistantMessage("done")]),
          }),
        (session) => session.close(),
      );
      await history.run("history");
      await history.close();
      if (kind === "ancestor-symlink") {
        const actual = join(homeDir, "actual-workspace");
        await filesystem.rename(workspace, actual);
        await symlink(actual, workspace);
      }
      if (kind === "project") {
        const database = await owner.acquire(
          () => AppDatabase.open(join(homeDir, "desktop-data")),
          (database) => database.close(),
        );
        await database.saveRegistry({
          ...(await database.registry()),
          projects: [
            {
              id: "project",
              name: "Project",
              directories: [outside],
              primary: outside,
              trusted: true,
            },
          ],
          pinned: [],
          archived: [],
        });
        await database.close();
      }
      const server = await owner.acquire(
        () => startServer({ homeDir, onHandshake: () => {} }),
        (server) => server.close(),
      );
      const client = await connect(server, "app://rukie", owner);
      expect(
        (await client.command("session.delete", { sessionId: history.id })).error,
      ).toBeUndefined();
      expect((await client.command("sessions.list")).result).toEqual([]);
      expect(await Bun.file(join(cwd, "keep.txt")).text()).toBe("keep");
      if (kind === "symlink" || kind === "ancestor-symlink")
        expect(
          (await filesystem.lstat(kind === "symlink" ? link : workspace)).isSymbolicLink(),
        ).toBe(true);
    } finally {
      await owner.close();
    }
  },
);

test("conversation workspace cleanup failure warns without undoing Session deletion", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-workspace-cleanup-warning-")),
      (path) => rm(path, { recursive: true, force: true }),
    );
    const warnings: string[] = [];
    const server = await owner.acquire(
      () =>
        startServer({
          homeDir,
          sessionOptions: fakeModel([fauxAssistantMessage("done")]),
          onHandshake: () => {},
          onWarning: (warning) => warnings.push(warning),
        }),
      (server) => server.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    const { sessionId } = (await client.command("session.create", { project: null, text: "hello" }))
      .result as { sessionId: string };
    await client.next((message) => message.type === "result");
    const cwd = (
      (await client.command("sessions.list")).result as { id: string; cwd: string }[]
    ).find((session) => session.id === sessionId)!.cwd;
    const original = filesystem.rm;
    const remove = spyOn(filesystem, "rm").mockImplementation(async (path, options) => {
      if (path === cwd) throw new Error("workspace removal denied");
      return original(path, options);
    });
    try {
      expect((await client.command("session.delete", { sessionId })).error).toBeUndefined();
    } finally {
      remove.mockRestore();
    }
    expect((await client.command("sessions.list")).result).toEqual([]);
    expect((await stat(cwd)).isDirectory()).toBe(true);
    expect(warnings).toEqual([expect.stringContaining("workspace removal denied")]);
  } finally {
    await owner.close();
  }
});

test("initial and reconnect registry metadata present the canonical configured home", async () => {
  const owner = ownResources();
  try {
    const root = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-home-presentation-")),
      (directory) => rm(directory, { recursive: true, force: true }),
    );
    const canonical = join(root, "actual-home");
    const homeDir = join(root, "configured-home");
    await mkdir(canonical);
    await symlink(canonical, homeDir);
    const server = await owner.acquire(
      () => startServer({ homeDir, onHandshake: () => {} }),
      (resource) => resource.close(),
    );
    const first = await connect(server, "app://rukie", owner);
    expect(await first.next((message) => message.type === "sessions_changed")).toMatchObject({
      homeDir: await realpath(canonical),
    });
    const second = await connect(server, "app://rukie", owner);
    expect(await second.next((message) => message.type === "sessions_changed")).toMatchObject({
      homeDir: await realpath(canonical),
    });
  } finally {
    await owner.close();
  }
});

test("startup catalog and history never unlock encrypted execution configuration", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-startup-keychain-")),
      (directory) => rm(directory, { recursive: true, force: true }),
    );
    const history = await owner.acquire(
      () =>
        createSession({
          homeDir,
          dataRoot: join(homeDir, "desktop-data"),
          cwd: join(homeDir, "desktop-data", "workspace"),
          ...fakeModel([fauxAssistantMessage("stored history")], { model: { reasoning: true } }),
          settings: { thinking: "high" },
        }),
      (resource) => resource.close(),
    );
    await history.run("history");
    await history.close();
    // Hold execution ownership through Core's public API while history is viewed.
    const writer = await owner.acquire(
      () =>
        createSession({
          homeDir,
          dataRoot: join(homeDir, "desktop-data"),
          cwd: join(homeDir, "desktop-data", "workspace"),
          resumeId: history.id,
          ...fakeModel([], { model: { reasoning: true } }),
          settings: { thinking: "high" },
        }),
      (resource) => resource.close(),
    );
    const database = await owner.acquire(
      () => AppDatabase.open(join(homeDir, "desktop-data")),
      (resource) => resource.close(),
    );
    await database.saveSettings({ permissionMode: "full-access" });
    for (const identity of [
      "configuration:hooks",
      "configuration:mcp",
      "oauth:fixture",
      "provider:fixture",
    ])
      await database.saveCredential(identity, { type: "replace", ciphertext: "opaque" });
    await database.close();
    let decryptions = 0;
    let authorized = false;
    const server = await owner.acquire(
      () =>
        startServer({
          homeDir,
          sessionOptions: fakeModel([fauxAssistantMessage("continued history")], {
            model: { reasoning: true },
          }),
          encryption: {
            async encrypt() {
              throw new Error("unexpected encryption");
            },
            async decrypt() {
              decryptions++;
              if (!authorized) throw new Error("system authorization required");
              return "{}";
            },
          },
          onHandshake: () => {},
        }),
      (resource) => resource.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    expect((await client.command("models.list")).error).toBeUndefined();
    expect((await client.command("sessions.list")).result).toEqual([
      expect.objectContaining({ id: history.id }),
    ]);
    expect((await client.command("session.subscribe", { sessionId: history.id })).error).toEqual({
      code: "session_busy",
    });
    const snapshot = await client.next((message) => message.type === "snapshot");
    expect(JSON.stringify(snapshot)).toContain("stored history");
    expect(snapshot).toMatchObject({
      permissionMode: "full-access",
      agent: { thinkingLevel: "high" },
    });
    expect(decryptions).toBe(0);
    await expect(
      createSession({
        homeDir,
        dataRoot: join(homeDir, "desktop-data"),
        cwd: join(homeDir, "desktop-data", "workspace"),
        resumeId: history.id,
        ...fakeModel([]),
      }),
    ).rejects.toMatchObject({ code: "session-busy" });
    await writer.close();
    // Starting execution still requires the encrypted configuration and fails closed on denial.
    expect((await client.command("session.create", { project: null, text: "run" })).error).toEqual({
      code: "internal",
    });
    expect(decryptions).toBe(1);
    expect(await filesystem.readdir(join(homeDir, "desktop-data", "workspace"))).toEqual([]);
    authorized = true;
    client.messages.length = 0;
    expect(
      (await client.command("prompt", { sessionId: history.id, text: "continue" })).error,
    ).toBeUndefined();
    await client.next((message) => message.type === "result");
    expect(JSON.stringify(client.messages)).toContain("continued history");
    expect(client.messages.some((message) => message.type === "session_state")).toBe(true);
    expect(decryptions).toBeGreaterThan(1);
  } finally {
    await owner.close();
  }
});
test("closed persisted history without a current writer coordinator remains read-only", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-closed-history-")),
      (directory) => rm(directory, { recursive: true, force: true }),
    );
    const dataRoot = join(homeDir, "desktop-data");
    const history = await owner.acquire(
      () =>
        createSession({
          homeDir,
          dataRoot,
          cwd: join(dataRoot, "workspace"),
          ...fakeModel([fauxAssistantMessage("closed persisted history")]),
        }),
      (session) => session.close(),
    );
    await history.run("history");
    await history.close();
    // A closed pre-protocol fixture has Session storage but no external coordinator.
    // Active old hosts must be closed before upgrading, as required by ADR-0035.
    const coordinators = join(dataRoot, ".session-leases");
    await rm(coordinators, { recursive: true, force: true });
    const storage = Bun.file(join(dataRoot, "sessions", history.id, "session.sqlite"));
    const originalBytes = await storage.bytes();
    const execution = fakeModel([fauxAssistantMessage("unexpected execution")]);
    let decryptions = 0;
    const server = await owner.acquire(
      () =>
        startServer({
          homeDir,
          sessionOptions: execution,
          encryption: {
            async encrypt() {
              throw new Error("unexpected encryption");
            },
            async decrypt() {
              decryptions++;
              throw new Error("unexpected decryption");
            },
          },
          onHandshake: () => {},
        }),
      (resource) => resource.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    expect((await client.command("sessions.list")).result).toEqual([
      expect.objectContaining({ id: history.id }),
    ]);
    expect(await client.command("session.subscribe", { sessionId: history.id })).toMatchObject({
      result: { sessionId: history.id, readonly: true },
    });
    const snapshot = await client.next((message) => message.type === "snapshot");
    expect(JSON.stringify(snapshot)).toContain("closed persisted history");
    expect(execution.contexts).toEqual([]);
    expect(decryptions).toBe(0);
    expect(await storage.bytes()).toEqual(originalBytes);
    expect(
      await stat(coordinators).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  } finally {
    await owner.close();
  }
});
test("failed server startup closes its acquired listener and application database", async () => {
  const owner = ownResources();
  const homeDir = await owner.acquire(
    () => mkdtemp(join(tmpdir(), "rukie-startup-failure-")),
    (directory) => rm(directory, { recursive: true, force: true }),
  );
  let port = 0;
  try {
    await expect(
      startServer({
        homeDir,
        onHandshake(connection) {
          port = connection.port;
          throw new Error("handshake failed");
        },
      }),
    ).rejects.toThrow("handshake failed");
    await expect(fetch(`http://127.0.0.1:${port}/private/model-services`)).rejects.toThrow();
    const database = await owner.acquire(
      () => AppDatabase.open(join(homeDir, "desktop-data")),
      (resource) => resource.close(),
    );
    try {
      expect(await database.registry()).toEqual({
        projects: [],
        pinned: [],
        archived: [],
        preferences: {},
      });
    } finally {
      await database.close();
    }
  } finally {
    await owner.close();
  }
});

test("committed orphan Session metadata rebuilds the application index without recovery", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-orphan-index-"));
  const dataRoot = join(homeDir, "desktop-data");
  const cwd = join(homeDir, "unregistered-project");
  await Bun.write(join(cwd, "seed"), "project");
  const fake = fakeModel([fauxAssistantMessage("committed orphan")]);
  const orphan = await createSession({ homeDir, dataRoot, cwd, ...fake });
  await orphan.run("history");
  await orphan.close();
  const server = await startServer({ homeDir, onHandshake: () => {} });
  const client = await connect(server);
  let database: AppDatabase | undefined;
  try {
    const response = await client.command("sessions.list");
    expect(response.result).toEqual([expect.objectContaining({ id: orphan.id, cwd })]);
    expect((await client.command("projects.list")).result).toEqual([]);
    client.socket.close();
    await server.close();
    database = await AppDatabase.open(dataRoot);
    expect(await database.sessions()).toEqual([expect.objectContaining({ id: orphan.id, cwd })]);
  } finally {
    client.socket.close();
    await server.close();
    await database?.close();
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("private provider management persists a redacted catalog without reading terminal authentication", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-services-wire-"));
  const managementToken = "main-only-management-token";
  let server = await startServer({ homeDir, managementToken, onHandshake: () => {} });
  let client = await connect(server);
  const manage = (input: unknown, token = managementToken, origin?: string) =>
    fetch(`http://127.0.0.1:${server.port}/private/model-services`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, ...(origin ? { origin } : {}) },
      body: JSON.stringify(input),
    });
  try {
    expect((await manage({ type: "list" }, server.token)).status).toBe(403);
    expect((await manage({ type: "list" }, managementToken, "app://rukie")).status).toBe(403);
    expect(
      (
        await manage({
          type: "save",
          provider: {
            id: "local",
            name: "Local",
            icon: "deepseek",
            api: "openai-completions",
            baseUrl: "http://localhost/v1",
            models: [{ id: "m", name: "Independent label" }],
          },
          credential: { type: "replace", ciphertext: "opaque-ciphertext" },
        })
      ).status,
    ).toBe(200);
    expect((await client.command("models.list")).result).toEqual([
      expect.objectContaining({
        providerId: "local",
        providerIcon: "deepseek",
        id: "m",
        name: "Independent label",
        authenticated: true,
      }),
    ]);
    expect(JSON.stringify(client.messages)).not.toContain("opaque-ciphertext");
    client.socket.close();
    await server.close();
    server = await startServer({ homeDir, managementToken, onHandshake: () => {} });
    client = await connect(server);
    expect((await client.command("models.list")).result).toEqual([
      expect.objectContaining({
        providerId: "local",
        providerIcon: "deepseek",
        id: "m",
        name: "Independent label",
        authenticated: true,
      }),
    ]);
    expect((await manage({ type: "delete", id: "local" })).status).toBe(200);
    expect((await client.command("models.list")).result).toEqual([]);
  } finally {
    client.socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("encrypted desktop model requests use selected configuration and deletion preserves read-only history", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-services-execution-"));
  const captured: { authorization: string | null; model: unknown }[] = [];
  const efforts: unknown[] = [];
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body: unknown = await request.json();
      if (typeof body !== "object" || body === null || !("model" in body))
        throw new Error("Missing request model");
      captured.push({ authorization: request.headers.get("authorization"), model: body.model });
      efforts.push("reasoning_effort" in body ? body.reasoning_effort : undefined);
      return new Response(
        'data: {"id":"test","choices":[{"index":0,"delta":{"role":"assistant","content":"desktop answer"},"finish_reason":null}]}\n\ndata: {"id":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  let decryptions = 0;
  const managementToken = "main-only-test-token";
  const encryption = {
    async encrypt() {
      return "cipher";
    },
    async decrypt(identity: string, ciphertext: string) {
      expect(identity).toBe("provider:local");
      expect(ciphertext).toBe("opaque");
      decryptions++;
      return "desktop-fixture-key";
    },
  };
  let server = await startServer({ homeDir, managementToken, encryption, onHandshake: () => {} });
  let client = await connect(server);
  const manage = (input: unknown) =>
    fetch(`http://127.0.0.1:${server.port}/private/model-services`, {
      method: "POST",
      headers: { authorization: `Bearer ${managementToken}` },
      body: JSON.stringify(input),
    });
  try {
    expect(
      (
        await manage({
          type: "save",
          provider: {
            id: "local",
            name: "Local",
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${provider.port}/v1`,
            models: [
              {
                id: "desktop-model",
                reasoning: true,
                defaultThinkingLevel: "high",
                thinkingLevelMap: { off: "none", low: "light", high: "deep" },
              },
            ],
          },
          credential: { type: "replace", ciphertext: "opaque" },
        })
      ).status,
    ).toBe(200);
    expect((await client.command("models.list")).result).toEqual([
      expect.objectContaining({ authenticated: true }),
    ]);
    expect(decryptions).toBe(0);
    expect((await manage({ type: "test", id: "local", modelId: "desktop-model" })).status).toBe(
      200,
    );
    expect(captured).toEqual([
      { authorization: "Bearer desktop-fixture-key", model: "desktop-model" },
    ]);
    captured.length = 0;
    const created = await client.command("session.create", {
      project: null,
      text: "hello",
      modelSelection: { provider: "local", modelId: "desktop-model" },
    });
    expect(created.error).toBeUndefined();
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await client.next((message) => message.type === "result");
    // The Session Run and its title generation both use the explicit desktop provider.
    expect(captured).toEqual([
      { authorization: "Bearer desktop-fixture-key", model: "desktop-model" },
      { authorization: "Bearer desktop-fixture-key", model: "desktop-model" },
    ]);
    expect(efforts).toContain("deep");
    expect(
      (
        await client.command("session.set_model", {
          sessionId,
          provider: "local",
          modelId: "desktop-model",
        })
      ).result,
    ).toMatchObject({ thinkingLevel: "high" });
    expect(
      (
        await client.command("session.set_model", {
          sessionId,
          provider: "local",
          modelId: "desktop-model",
          thinkingLevel: "low",
        })
      ).result,
    ).toMatchObject({ thinkingLevel: "low" });
    client.socket.close();
    await server.close();
    server = await startServer({ homeDir, managementToken, encryption, onHandshake: () => {} });
    client = await connect(server);
    expect((await manage({ type: "list" })).status).toBe(200);
    expect(
      (await client.command("prompt", { sessionId, text: "resume saved choice" })).error,
    ).toBeUndefined();
    await client.next((message) => message.type === "result");
    expect(efforts.at(-1)).toBe("light");
    expect(
      (
        await client.command("session.set_model", {
          sessionId,
          provider: "local",
          modelId: "desktop-model",
          thinkingLevel: "automatic",
        })
      ).result,
    ).toMatchObject({ thinkingLevel: "automatic" });
    client.messages.length = 0;
    expect(
      (await client.command("prompt", { sessionId, text: "provider decides" })).error,
    ).toBeUndefined();
    await client.next((message) => message.type === "result");
    expect(efforts.at(-1)).toBeUndefined();
    client.socket.close();
    await server.close();
    server = await startServer({ homeDir, managementToken, encryption, onHandshake: () => {} });
    client = await connect(server);
    expect(
      (await client.command("prompt", { sessionId, text: "resume automatic" })).error,
    ).toBeUndefined();
    await client.next((message) => message.type === "result");
    expect(efforts.at(-1)).toBeUndefined();
    expect(
      (
        await client.command("session.set_model", {
          sessionId,
          provider: "local",
          modelId: "desktop-model",
          thinkingLevel: "off",
        })
      ).result,
    ).toMatchObject({ thinkingLevel: "off" });
    client.messages.length = 0;
    expect(
      (await client.command("prompt", { sessionId, text: "explicitly disabled" })).error,
    ).toBeUndefined();
    await client.next((message) => message.type === "result");
    expect(efforts.at(-1)).toBe("none");
    expect(JSON.stringify(client.messages)).not.toContain("desktop-fixture-key");
    expect((await manage({ type: "delete", id: "local" })).status).toBe(200);
    expect((await client.command("prompt", { sessionId, text: "again" })).error).toEqual({
      code: "model_unavailable",
    });
    client.socket.close();
    await server.close();
    server = await startServer({ homeDir, managementToken, encryption, onHandshake: () => {} });
    client = await connect(server);
    expect((await client.command("session.subscribe", { sessionId })).result).toMatchObject({
      readonly: true,
      modelUnavailable: true,
    });
    expect(
      client.messages.some(
        (message) =>
          message.type === "snapshot" && JSON.stringify(message).includes("desktop answer"),
      ),
    ).toBe(true);
    expect(captured).toHaveLength(6);
    expect(
      (
        await manage({
          type: "save",
          provider: {
            id: "local",
            name: "Local",
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${provider.port}/v1`,
            models: [{ id: "replacement-model" }],
          },
          credential: { type: "replace", ciphertext: "opaque" },
        })
      ).status,
    ).toBe(200);
    const selected = await client.command("session.set_model", {
      sessionId,
      provider: "local",
      modelId: "replacement-model",
      thinkingLevel: "off",
    });
    expect(selected.result).toMatchObject({ model: "local/replacement-model" });
    const before = captured.length;
    expect(
      (await client.command("prompt", { sessionId, text: "continue explicitly" })).error,
    ).toBeUndefined();
    await client.next((message) => message.type === "result");
    // Server close drains the accepted Run before observing the external request count.
    client.socket.close();
    await server.close();
    expect(captured.slice(before)).toEqual([
      expect.objectContaining({ model: "replacement-model" }),
    ]);
  } finally {
    client.socket.close();
    await server.close();
    await provider.stop(true);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("authenticated clients use the public registry over a real WebSocket", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-server-"));
  const server = await startServer({ homeDir, onHandshake: () => {} });
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
    protocols: ["rukie.v1", `rukie.auth.${server.token}`],
    headers: { Origin: "app://rukie" },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = reject;
    });
    expect(socket.protocol).toBe("rukie.v1");
    const response = new Promise<unknown>((resolve) => {
      socket.onmessage = (event) => {
        const message: unknown = JSON.parse(String(event.data));
        if (
          typeof message === "object" &&
          message !== null &&
          "id" in message &&
          message.id === "1"
        )
          resolve(message);
      };
    });
    socket.send(JSON.stringify({ id: "1", type: "projects.list" }));
    expect(await response).toEqual({ type: "response", id: "1", result: [] });
  } finally {
    socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fakeModel } from "../../agent/tests/helpers/fake-model.ts";

async function connect(
  server: { port: number; token: string },
  origin = "app://rukie",
  owner?: ReturnType<typeof ownResources>,
) {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
    protocols: ["rukie.v1", `rukie.auth.${server.token}`],
    headers: { Origin: origin },
  });
  owner?.add(
    () =>
      new Promise<void>((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) return resolve();
        socket.addEventListener("close", () => resolve(), { once: true });
        socket.close();
      }),
  );
  const messages: Record<string, unknown>[] = [];
  const waits = new Set<() => void>();
  socket.addEventListener("message", (event) => {
    messages.push(JSON.parse(String(event.data)));
    for (const wake of waits) wake();
  });
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = reject;
  });
  const next = (predicate: (message: Record<string, unknown>) => boolean) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const signal = AbortSignal.timeout(3000);
      const wake = () => {
        const message = messages.find(predicate);
        if (message) {
          waits.delete(wake);
          signal.removeEventListener("abort", abort);
          resolve(message);
        }
      };
      const abort = () => {
        waits.delete(wake);
        reject(new Error(`Missing message: ${JSON.stringify(messages)}`));
      };
      signal.addEventListener("abort", abort, { once: true });
      waits.add(wake);
      wake();
    });
  return {
    socket,
    messages,
    next,
    command: async (type: string, fields: Record<string, unknown> = {}) => {
      const id = crypto.randomUUID();
      socket.send(JSON.stringify({ id, type, ...fields }));
      return next((message) => message.id === id);
    },
  };
}

test("a new Session streams and can be reopened from the isolated SQLite store", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-stream-"));
  const fake = fakeModel(
    [fauxAssistantMessage("first reply"), fauxAssistantMessage("second reply")],
    { chunkTokens: 1 },
  );
  const server = await startServer({ homeDir, sessionOptions: fake, onHandshake: () => {} });
  const client = await connect(server);
  try {
    const created = await client.command("session.create", { project: null, text: "hello" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await client.next((message) => message.type === "result");
    expect(client.messages.find((message) => message.type === "snapshot")).toBeDefined();
    expect(client.messages.find((message) => message.type === "message_end")).toBeDefined();
    const superseded = new Promise<CloseEvent>((resolve) =>
      client.socket.addEventListener("close", resolve, { once: true }),
    );
    const replacement = await connect(server);
    expect((await superseded).reason).toBe("superseded");
    try {
      await replacement.command("session.subscribe", { sessionId });
      expect(replacement.messages.find((message) => "sessionId" in message)?.type).toBe("snapshot");
      await replacement.command("prompt", { sessionId, text: "again" });
      await replacement.next((message) => message.type === "result");
      const list = await replacement.command("sessions.list");
      expect(list.result).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: sessionId })]),
      );
    } finally {
      replacement.socket.close();
    }
  } finally {
    client.socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

test("upgrade requires exact Host, Origin, token and protocol, with development Origin opt-in", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-auth-"));
  const server = await startServer({ homeDir, onHandshake: () => {} });
  try {
    const headers = {
      Host: `127.0.0.1:${server.port}`,
      Origin: "app://rukie",
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Protocol": `rukie.v1, rukie.auth.${server.token}`,
    };
    for (const override of [
      { Host: "localhost" },
      { Origin: "https://evil.example" },
      { Origin: "http://localhost:5173" },
      { "Sec-WebSocket-Protocol": "rukie.v1, rukie.auth.wrong" },
    ]) {
      const response = await fetch(`http://127.0.0.1:${server.port}/ws`, {
        headers: { ...headers, ...override },
      });
      expect([401, 403]).toContain(response.status);
    }
  } finally {
    await server.close();
  }
  const development = await startServer({ homeDir, development: true, onHandshake: () => {} });
  try {
    const client = await connect(development, "http://localhost:5173");
    client.socket.close();
  } finally {
    await development.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

test("disconnect leaves a Run alive, takeover subscribes to it, and abort settles it", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-disconnect-"));
  const entered = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
  const fake = fakeModel([
    async (_context, options) => {
      options?.signal?.addEventListener(
        "abort",
        () => reply.resolve(fauxAssistantMessage("cancelled")),
        { once: true },
      );
      entered.resolve();
      return reply.promise;
    },
  ]);
  const server = await startServer({ homeDir, sessionOptions: fake, onHandshake: () => {} });
  const first = await connect(server);
  try {
    const created = await first.command("session.create", { project: null, text: "wait" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await entered.promise;
    const closed = new Promise<void>((resolve) =>
      first.socket.addEventListener("close", () => resolve(), { once: true }),
    );
    first.socket.close();
    await closed;
    const second = await connect(server);
    try {
      await second.command("session.subscribe", { sessionId });
      const queued = await second.command("prompt", { sessionId, text: "busy" });
      expect(queued.result).toEqual({ requestId: expect.any(String) });
      expect(
        (
          await second.command("withdraw", {
            sessionId,
            requestId: (queued.result as { requestId: string }).requestId,
          })
        ).result,
      ).toMatchObject({ input: { prompt: "busy" } });
      const image = {
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSf8AAAAASUVORK5CYII=",
        mimeType: "image/png",
        name: "draft.png",
      };
      const one = await second.command("prompt", {
        sessionId,
        text: "first queued",
        images: [image],
      });
      const two = await second.command("prompt", { sessionId, text: "second queued" });
      const oneId = (one.result as { requestId: string }).requestId;
      const twoId = (two.result as { requestId: string }).requestId;
      expect((await second.command("steer_now", { sessionId, requestId: oneId })).result).toEqual({
        status: "steered",
      });
      const result = await second.command("abort", { sessionId });
      expect(result.result).toEqual({
        inputs: [
          { requestId: oneId, prompt: "first queued", images: [image] },
          { requestId: twoId, prompt: "second queued", images: [] },
        ],
      });
      expect((await second.command("withdraw", { sessionId, requestId: oneId })).error).toEqual({
        code: "not_queued",
      });
      await second.next((message) => message.type === "result");
      reply.resolve(fauxAssistantMessage("too late"));
    } finally {
      second.socket.close();
    }
  } finally {
    reply.resolve(fauxAssistantMessage("cleanup"));
    first.socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

test("multi-directory Projects canonicalize, require trust and keep exact ownership", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-project-directories-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const first = await realpath(await mkdtemp(join(homeDir, "first-")));
    const second = await realpath(await mkdtemp(join(homeDir, "second-")));
    const nested = join(first, "nested");
    await mkdir(nested);
    const server = await owner.acquire(
      () => startServer({ homeDir, onHandshake: () => {} }),
      (server) => server.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    expect(
      (
        await client.command("project.create", {
          name: "Project",
          directories: [first, second],
          trusted: false,
        })
      ).error,
    ).toEqual({ code: "invalid_command" });
    const created = await client.command("project.create", {
      name: "  Custom Project  ",
      directories: [first, second],
      trusted: true,
    });
    expect(created.result).toMatchObject({
      name: "Custom Project",
      directories: [first, second],
      primary: first,
      trusted: true,
    });
    const projectResult = created.result;
    if (
      typeof projectResult !== "object" ||
      projectResult === null ||
      !("id" in projectResult) ||
      !("name" in projectResult)
    )
      throw new Error("Missing Project result");
    const id = String(projectResult.id);
    expect(
      (
        await client.command("project.create", {
          name: "Project",
          directories: [first],
          trusted: true,
        })
      ).result,
    ).toEqual(created.result);
    expect(
      (
        await client.command("project.create", {
          name: "Project",
          directories: [second],
          trusted: true,
        })
      ).error,
    ).toMatchObject({ code: "project_conflict", params: { project: projectResult.name } });
    expect(
      (
        await client.command("project.create", {
          name: "Project",
          directories: [nested],
          trusted: true,
        })
      ).error,
    ).toBeUndefined();
    expect(
      (
        await client.command("project.create", {
          name: "Project",
          directories: [join(homeDir, "desktop-data", "workspace")],
          trusted: true,
        })
      ).error,
    ).toEqual({ code: "project_reserved" });
    const alias = join(homeDir, "first-alias");
    await symlink(first, alias);
    expect(
      (
        await client.command("project.create", {
          name: "Project",
          directories: [alias, first],
          trusted: true,
        })
      ).result,
    ).toEqual(created.result);
    const reservedAlias = join(homeDir, "reserved-alias");
    await symlink(join(homeDir, "desktop-data"), reservedAlias);
    expect(
      (
        await client.command("project.create", {
          name: "Project",
          directories: [reservedAlias],
          trusted: true,
        })
      ).error,
    ).toEqual({ code: "project_reserved" });
    expect(
      (await client.command("project.create", { name: "Project", directories: [], trusted: true }))
        .error,
    ).toEqual({ code: "invalid_command" });
    expect(
      (
        await client.command("project.create", {
          name: "Project",
          directories: ["relative"],
          trusted: true,
        })
      ).error,
    ).toEqual({ code: "project_not_found" });
    expect(
      (
        await client.command("project.update", {
          projectId: id,
          name: projectResult.name,
          directories: [first, second],
          primary: second,
        })
      ).result,
    ).toMatchObject({ primary: second, name: projectResult.name });
    expect(
      (
        await client.command("project.update", {
          projectId: id,
          name: projectResult.name,
          directories: [first, second],
          primary: nested,
        })
      ).error,
    ).toEqual({ code: "invalid_command" });
    expect((await client.command("project.trust", { projectId: id })).result).toMatchObject({
      trusted: true,
    });
    expect((await client.command("project.add", { path: first })).error).toEqual({
      code: "invalid_command",
    });
  } finally {
    await owner.close();
  }
});

test("concurrent project.create reuses one canonical Project and persists it once", async () => {
  const owner = ownResources();
  let release = () => {};
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-project-create-race-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const seed = await realpath(await mkdtemp(join(homeDir, "seed-")));
    const primary = await realpath(await mkdtemp(join(homeDir, "primary-")));
    const alias = join(homeDir, "alias");
    await symlink(primary, alias);
    const server = await owner.acquire(
      () => startServer({ homeDir, onHandshake: () => {} }),
      (server) => server.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    await client.command("project.create", { name: "Project", directories: [seed], trusted: true });
    const original = filesystem.realpath;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrivals = 0;
    // Hold the real filesystem boundary until both commands finish candidate validation.
    // Existing seed identities force the ownership snapshot to cross an async realpath boundary.
    // Server realpath calls use string results without encoding options; the fixture preserves that contract.
    const lookup = spyOn(filesystem, "realpath").mockImplementation((async (
      path: Parameters<typeof filesystem.realpath>[0],
    ) => {
      const result = await original(path);
      if (path === join(homeDir, "desktop-data")) {
        if (++arrivals === 2) release();
        await barrier;
      }
      return result;
    }) as typeof filesystem.realpath);
    owner.add(() => {
      release();
      lookup.mockRestore();
    });
    const replies = await Promise.all([
      client.command("project.create", { name: "Project", directories: [primary], trusted: true }),
      client.command("project.create", { name: "Project", directories: [alias], trusted: true }),
    ]);
    lookup.mockRestore();
    expect(replies[0]!.error).toBeUndefined();
    expect(replies[1]!.result).toEqual(replies[0]!.result);
    expect((await client.command("projects.list")).result).toEqual([
      expect.objectContaining({ primary: seed }),
      replies[0]!.result,
    ]);
    await server.close();
    const reopened = await owner.acquire(
      () => startServer({ homeDir, onHandshake: () => {} }),
      (server) => server.close(),
    );
    const restartedClient = await connect(reopened, "app://rukie", owner);
    expect((await restartedClient.command("projects.list")).result).toEqual([
      expect.objectContaining({ primary: seed }),
      replies[0]!.result,
    ]);
  } finally {
    release();
    await owner.close();
  }
});

test("concurrent project.create reports the owner of a shared canonical secondary directory", async () => {
  const owner = ownResources();
  let release = () => {};
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-project-overlap-race-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const seed = await realpath(await mkdtemp(join(homeDir, "seed-")));
    const primary = join(await realpath(homeDir), "first");
    const other = join(await realpath(homeDir), "second");
    const shared = join(await realpath(homeDir), "shared");
    for (const directory of [primary, other, shared]) await mkdir(directory);
    const alias = join(homeDir, "alias");
    await symlink(shared, alias);
    const database = await owner.acquire(
      () => AppDatabase.open(join(homeDir, "desktop-data")),
      (db) => db.close(),
    );
    const seedProject = {
      id: "seed",
      name: "Seed",
      directories: [seed, homeDir],
      primary: seed,
      trusted: false,
    };
    await database.saveRegistry({
      projects: [seedProject],
      pinned: [],
      archived: [],
      preferences: {},
    });
    await database.close();
    const server = await owner.acquire(
      () => startServer({ homeDir, onHandshake: () => {} }),
      (server) => server.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    const original = filesystem.realpath;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrivals = 0;
    // Synchronize candidate validation at the filesystem boundary, leaving registry behavior real.
    // Server realpath calls use string results without encoding options; the fixture preserves that contract.
    const lookup = spyOn(filesystem, "realpath").mockImplementation((async (
      path: Parameters<typeof filesystem.realpath>[0],
    ) => {
      const result = await original(path);
      if (path === join(homeDir, "desktop-data")) {
        if (++arrivals === 2) release();
        await barrier;
      }
      return result;
    }) as typeof filesystem.realpath);
    owner.add(() => {
      release();
      lookup.mockRestore();
    });
    const replies = await Promise.all([
      client.command("project.create", {
        name: "first",
        directories: [primary, shared],
        trusted: true,
      }),
      client.command("project.create", {
        name: "second",
        directories: [other, alias],
        trusted: true,
      }),
      client.command("project.trust", { projectId: "seed" }),
      client.command("project.update", {
        projectId: "seed",
        name: seedProject.name,
        directories: seedProject.directories,
        primary: homeDir,
      }),
    ]);
    lookup.mockRestore();
    const firstWon = replies[0]!.error === undefined;
    const winner = replies[firstWon ? 0 : 1]!;
    const loser = replies[firstWon ? 1 : 0]!;
    expect(winner.result).toMatchObject({
      primary: firstWon ? primary : other,
      directories: [firstWon ? primary : other, shared],
    });
    expect(loser.error).toEqual({
      code: "project_conflict",
      params: { project: firstWon ? "first" : "second" },
    });
    expect(replies[2]!.error).toBeUndefined();
    expect(replies[3]!.error).toBeUndefined();
    // A rejected overlap must release the queue for later Project writes.
    expect(
      (
        await client.command("project.update", {
          projectId: "seed",
          name: seedProject.name,
          directories: seedProject.directories,
          primary: homeDir,
        })
      ).error,
    ).toBeUndefined();
    await server.close();
    const reopened = await owner.acquire(
      () => startServer({ homeDir, onHandshake: () => {} }),
      (server) => server.close(),
    );
    const restartedClient = await connect(reopened, "app://rukie", owner);
    expect((await restartedClient.command("projects.list")).result).toEqual([
      {
        ...seedProject,
        directories: [seed, await realpath(homeDir)],
        trusted: true,
        primary: await realpath(homeDir),
      },
      winner.result,
    ]);
  } finally {
    release();
    await owner.close();
  }
});

test("legacy alias Projects retain Session membership and canonical directory ownership", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-project-alias-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const canonical = await realpath(await mkdtemp(join(homeDir, "repository-")));
    const alias = join(homeDir, "link");
    await symlink(canonical, alias);
    const dataRoot = join(homeDir, "desktop-data");
    const history = await owner.acquire(
      () =>
        createSession({
          homeDir,
          dataRoot,
          cwd: alias,
          ...fakeModel([fauxAssistantMessage("stored")]),
        }),
      (session) => session.close(),
    );
    await history.run("retain original cwd");
    await history.close();
    const app = await owner.acquire(
      () => AppDatabase.open(dataRoot),
      (db) => db.close(),
    );
    const fixture = await owner.acquire(
      () => openBunSqliteDatabase(join(dataRoot, "app.sqlite")),
      (db) => db.close(),
    );
    // Seed the explicit pre-multi-directory registry format; observe migration only through wire.
    await fixture.run(
      "INSERT OR REPLACE INTO documents VALUES (?, ?)",
      "registry",
      JSON.stringify({
        projects: [{ id: "legacy", name: "Original", path: alias }],
        pinned: [],
        preferences: {},
      }),
    );
    await fixture.close();
    await app.close();
    const server = await owner.acquire(
      () => startServer({ homeDir, onHandshake: () => {} }),
      (server) => server.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    const legacy = {
      id: "legacy",
      name: "Original",
      directories: [alias],
      primary: alias,
      trusted: false,
    };
    expect((await client.command("projects.list")).result).toEqual([legacy]);
    expect(
      (
        await client.command("project.create", {
          name: "Project",
          directories: [canonical],
          trusted: true,
        })
      ).result,
    ).toEqual(legacy);
    const other = await realpath(await mkdtemp(join(homeDir, "other-")));
    expect(
      (
        await client.command("project.create", {
          name: "Project",
          directories: [other, canonical],
          trusted: true,
        })
      ).error,
    ).toEqual({ code: "project_conflict", params: { project: "Original" } });
    expect((await client.command("projects.list")).result).toEqual([legacy]);
    expect(
      (await client.command("session.move", { sessionId: history.id, projectId: "legacy" })).error,
    ).toEqual({ code: "invalid_command" });
    expect((await client.command("sessions.list")).result).toEqual([
      expect.objectContaining({ id: history.id, cwd: alias, projectId: "legacy" }),
    ]);
    expect(await client.next((message) => message.type === "sessions_changed")).toMatchObject({
      sessions: [expect.objectContaining({ id: history.id, cwd: alias, projectId: "legacy" })],
    });
    const before = await readSessionSnapshot({ homeDir, dataRoot, cwd: alias, id: history.id });
    expect(
      (
        await client.command("project.update", {
          projectId: "legacy",
          name: "Renamed",
          directories: [alias],
          primary: alias,
        })
      ).result,
    ).toEqual({ ...legacy, name: "Renamed", directories: [canonical], primary: canonical });
    expect(
      await client.next(
        (message) =>
          message.type === "sessions_changed" &&
          Array.isArray(message.projects) &&
          message.projects[0]?.name === "Renamed",
      ),
    ).toMatchObject({
      sessions: [expect.objectContaining({ id: history.id, cwd: alias, projectId: "legacy" })],
    });
    const reconnected = await connect(server, "app://rukie", owner);
    expect(await reconnected.next((message) => message.type === "sessions_changed")).toMatchObject({
      sessions: [expect.objectContaining({ id: history.id, cwd: alias, projectId: "legacy" })],
    });
    const originalRealpath = filesystem.realpath;
    let releaseIdentity = () => {};
    let reachedIdentity = () => {};
    const reached = new Promise<void>((resolve) => {
      reachedIdentity = resolve;
    });
    const identityBarrier = new Promise<void>((resolve) => {
      releaseIdentity = resolve;
    });
    let identityLookups = 0;
    // Hold only the old publication at the filesystem boundary; the competing Project write stays real.
    const lookup = spyOn(filesystem, "realpath").mockImplementation((async (
      path: Parameters<typeof filesystem.realpath>[0],
    ) => {
      const result = await originalRealpath(path);
      if (path === alias && ++identityLookups === 2) {
        reachedIdentity();
        await identityBarrier;
      }
      return result;
    }) as typeof filesystem.realpath);
    owner.add(() => {
      releaseIdentity();
      lookup.mockRestore();
    });
    const pin = reconnected.command("session.pin", { sessionId: history.id });
    await reached;
    expect(
      (
        await reconnected.command("project.update", {
          projectId: "legacy",
          name: "Renamed",
          directories: [other],
          primary: other,
        })
      ).error,
    ).toBeUndefined();
    expect(
      await reconnected.next(
        (message) =>
          message.type === "sessions_changed" &&
          Array.isArray(message.projects) &&
          message.projects[0]?.primary === other,
      ),
    ).toMatchObject({
      sessions: [expect.objectContaining({ id: history.id, cwd: alias, projectId: null })],
      pinned: [history.id],
    });
    const publicationCursor = reconnected.messages.length;
    releaseIdentity();
    expect((await pin).error).toBeUndefined();
    const published = await reconnected.next(
      (message) =>
        reconnected.messages.indexOf(message) >= publicationCursor &&
        message.type === "sessions_changed",
    );
    expect(published.projects).toEqual([expect.objectContaining({ primary: other })]);
    expect(published.sessions).toEqual([
      expect.objectContaining({ id: history.id, cwd: alias, projectId: null }),
    ]);
    lookup.mockRestore();
    await reconnected.command("project.remove", { projectId: "legacy" });
    expect(
      await reconnected.next(
        (message) =>
          message.type === "sessions_changed" &&
          Array.isArray(message.projects) &&
          message.projects.length === 0,
      ),
    ).toMatchObject({
      sessions: [expect.objectContaining({ id: history.id, cwd: alias, projectId: null })],
    });
    expect(await readSessionSnapshot({ homeDir, dataRoot, cwd: alias, id: history.id })).toEqual(
      before,
    );
  } finally {
    await owner.close();
  }
});

test("session.move rejects its owning Project after a primary switch without changing history", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-move-same-project-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const first = await realpath(await mkdtemp(join(homeDir, "first-")));
    const second = await realpath(await mkdtemp(join(homeDir, "second-")));
    const dataRoot = join(homeDir, "desktop-data");
    const history = await owner.acquire(
      () =>
        createSession({
          homeDir,
          dataRoot,
          cwd: first,
          ...fakeModel([fauxAssistantMessage("unchanged")]),
        }),
      (session) => session.close(),
    );
    await history.run("original Transcript");
    await history.close();
    const before = await readSessionSnapshot({ homeDir, dataRoot, cwd: first, id: history.id });
    const db = await owner.acquire(
      () => AppDatabase.open(dataRoot),
      (db) => db.close(),
    );
    await db.saveRegistry({
      projects: [
        { id: "p", name: "Project", directories: [first, second], primary: first, trusted: true },
      ],
      pinned: [],
      archived: [],
      preferences: {},
    });
    const server = await owner.acquire(
      () => startServer({ homeDir, onHandshake: () => {} }),
      (server) => server.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    expect(
      (
        await client.command("project.update", {
          projectId: "p",
          name: "Project",
          directories: [first, second],
          primary: second,
        })
      ).error,
    ).toBeUndefined();
    expect(
      (await client.command("session.move", { sessionId: history.id, projectId: "p" })).error,
    ).toEqual({ code: "invalid_command" });
    expect((await client.command("sessions.list")).result).toEqual([
      expect.objectContaining({ id: history.id, cwd: first }),
    ]);
    expect(await readSessionSnapshot({ homeDir, dataRoot, cwd: first, id: history.id })).toEqual(
      before,
    );
  } finally {
    await owner.close();
  }
});

test("Project trust enables only registered cwd hooks and primary changes preserve existing Session cwd", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-project-trust-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const first = await realpath(await mkdtemp(join(homeDir, "first-")));
    const second = await realpath(await mkdtemp(join(homeDir, "second-")));
    const nested = join(first, "nested");
    await mkdir(nested);
    for (const [dir, marker] of [
      [first, "FIRST_PROJECT_HOOK"],
      [second, "SECOND_PROJECT_HOOK"],
      [nested, "UNREGISTERED_NESTED_HOOK"],
    ]) {
      await mkdir(join(dir!, ".rukie"));
      await writeFile(
        join(dir!, ".rukie", "settings.json"),
        JSON.stringify({
          hooks: { SessionStart: [{ hooks: [{ type: "command", command: `printf ${marker}` }] }] },
        }),
      );
    }
    await writeFile(join(first, "AGENTS.md"), "FIRST_DIRECTORY_INSTRUCTIONS");
    await writeFile(join(second, "AGENTS.md"), "SECOND_DIRECTORY_INSTRUCTIONS");
    const db = await owner.acquire(
      () => AppDatabase.open(join(homeDir, "desktop-data")),
      (db) => db.close(),
    );
    await db.saveRegistry({
      projects: [
        { id: "p", name: "Original", directories: [first, second], primary: first, trusted: false },
        { id: "nested", name: "Nested", directories: [nested], primary: nested, trusted: false },
      ],
      pinned: [],
      archived: [],
      preferences: {},
    });
    const fake = fakeModel(Array.from({ length: 5 }, () => fauxAssistantMessage("done")));
    const server = await owner.acquire(
      () =>
        startServer({ homeDir, onHandshake: () => {}, onWarning: () => {}, sessionOptions: fake }),
      (server) => server.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    const create = async (project: string, index: number) => {
      const response = await client.command("session.create", { project, text: `prompt ${index}` });
      expect(response.error).toBeUndefined();
      if (
        typeof response.result !== "object" ||
        response.result === null ||
        !("sessionId" in response.result)
      )
        throw new Error("Missing Session");
      const sessionId = response.result.sessionId;
      await client.next((message) => message.type === "result" && message.sessionId === sessionId);
      return sessionId;
    };
    const original = await create("p", 0);
    expect(JSON.stringify(fake.contexts[0])).not.toContain("FIRST_PROJECT_HOOK");
    expect(JSON.stringify(fake.contexts[0])).toContain("SECOND_DIRECTORY_INSTRUCTIONS");
    await client.command("project.trust", { projectId: "p" });
    expect(
      (
        await client.command("prompt", {
          sessionId: original,
          text: "after trust on existing Session",
        })
      ).error,
    ).toBeUndefined();
    await client.next(
      (message) =>
        message.type === "result" && message.sessionId === original && fake.contexts.length >= 2,
    );
    expect(JSON.stringify(fake.contexts[1])).toContain("FIRST_PROJECT_HOOK");
    await create("p", 1);
    expect(JSON.stringify(fake.contexts[1])).toContain("FIRST_PROJECT_HOOK");
    expect(JSON.stringify(fake.contexts[2])).not.toContain("SECOND_PROJECT_HOOK");
    await client.command("project.update", {
      projectId: "p",
      name: "Project",
      directories: [first, second],
      primary: second,
    });
    const changed = await create("p", 2);
    expect(JSON.stringify(fake.contexts[3])).toContain("SECOND_PROJECT_HOOK");
    expect(JSON.stringify(fake.contexts[3])).toContain("FIRST_DIRECTORY_INSTRUCTIONS");
    await create("nested", 3);
    expect(JSON.stringify(fake.contexts[4])).not.toContain("UNREGISTERED_NESTED_HOOK");
    const list = await client.command("sessions.list");
    expect(list.result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: original, cwd: first }),
        expect.objectContaining({ id: changed, cwd: second }),
      ]),
    );
    expect((await db.settings()).trustedProjects).toBeUndefined();
  } finally {
    await owner.close();
  }
});

test("project registration survives restart and a removed project cannot hide other Sessions", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-projects-"));
  const projectDir = await mkdtemp(join(tmpdir(), "rukie-project-"));
  let server = await startServer({ homeDir, onHandshake: () => {} });
  let client = await connect(server);
  try {
    const added = await client.command("project.create", {
      name: "Project",
      directories: [projectDir],
      trusted: true,
    });
    expect(added.result).toMatchObject({
      directories: [await realpath(projectDir)],
      primary: await realpath(projectDir),
      trusted: true,
    });
    expect(
      (
        await client.command("project.create", {
          name: "Project",
          directories: [join(projectDir, "missing")],
          trusted: true,
        })
      ).error,
    ).toEqual({ code: "project_not_found" });
    client.socket.close();
    await server.close();
    server = await startServer({ homeDir, onHandshake: () => {} });
    client = await connect(server);
    expect((await client.command("projects.list")).result).toEqual([added.result]);
    await rm(projectDir, { recursive: true, force: true });
    expect((await client.command("sessions.list")).result).toEqual([]);
    expect((await client.command("session.subscribe", { sessionId: "missing" })).error).toEqual({
      code: "session_not_found",
    });
    const malformed = await client.command("made.up");
    expect(malformed.error).toEqual({ code: "invalid_command" });
  } finally {
    client.socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
}, 5000);

test("an application-root Session held by another owner permits only a read-only desktop snapshot", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-busy-")),
      (directory) => rm(directory, { recursive: true, force: true }),
    );
    const fake = fakeModel([fauxAssistantMessage("held writer reply")]);
    const server = await owner.acquire(
      () => startServer({ homeDir, sessionOptions: fake, onHandshake: () => {} }),
      (resource) => resource.close(),
    );
    const owned = await owner.acquire(
      () =>
        createSession({
          ...fake,
          homeDir,
          dataRoot: join(homeDir, "desktop-data"),
          cwd: join(homeDir, "desktop-data", "workspace"),
        }),
      (resource) => resource.close(),
    );
    await owned.run("held writer prompt");
    await owned.close();
    // The child holds a real cross-process kernel mutex; parent virtual clocks cannot model it.
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../../agent/tests/helpers/session-store-worker.ts"),
        "hold",
        join(homeDir, "desktop-data", "workspace"),
        homeDir,
        owned.id,
        join(homeDir, "desktop-data"),
      ],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );
    let releaseReader: (() => void) | undefined;
    owner.add(async () => {
      child.kill();
      await child.exited;
      releaseReader?.();
    });
    const reader = child.stdout.getReader();
    releaseReader = () => reader.releaseLock();
    const log = Bun.file(
      join(
        createSessionStore({
          homeDir,
          dataRoot: join(homeDir, "desktop-data"),
          cwd: join(homeDir, "desktop-data", "workspace"),
        }).key(owned.id),
        "session.sqlite",
      ),
    );
    const client = await connect(server, "app://rukie", owner);
    expect(new TextDecoder().decode((await reader.read()).value)).toStartWith("READY ");
    const committed = await log.bytes();
    expect((await client.command("session.subscribe", { sessionId: owned.id })).error).toEqual({
      code: "session_busy",
    });
    const snapshot = await client.next((message) => message.type === "snapshot");
    expect(JSON.stringify(snapshot)).toContain("held writer reply");
    expect(await log.bytes()).toEqual(committed);
    expect(
      (await client.command("prompt", { sessionId: owned.id, text: "must not write" })).error,
    ).toEqual({ code: "session_busy" });
    child.stdin.end();
    expect(await child.exited).toBe(0);
    expect(
      (await client.command("session.subscribe", { sessionId: owned.id })).result,
    ).toMatchObject({ readonly: true });
    // Successful observation immediately rolls back its probe, permitting a later writer.
    const reopened = await owner.acquire(
      () =>
        createSession({
          ...fakeModel([]),
          homeDir,
          dataRoot: join(homeDir, "desktop-data"),
          cwd: join(homeDir, "desktop-data", "workspace"),
          resumeId: owned.id,
        }),
      (resource) => resource.close(),
    );
    await reopened.close();
  } finally {
    await owner.close();
  }
}, 5000);
test("permission epochs survive takeover and settle once, with session rules applying to later calls", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-permission-wire-"));
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("write", { path: "first.txt", content: "one" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("write", { path: "second.txt", content: "two" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const server = await startServer({
    homeDir,
    sessionOptions: { ...fake, settings: { permissionMode: "ask" } },
    onHandshake: () => {},
  });
  const first = await connect(server);
  try {
    const created = await first.command("session.create", { project: null, text: "write" });
    expect(created.result).toMatchObject({ requestId: expect.any(String) });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    const asked = await first.next((message) => message.type === "interaction_requested");
    expect(asked.sessionId).toBe(sessionId);
    expect((asked.request as Record<string, unknown>).signal).toBeUndefined();
    const second = await connect(server);
    try {
      await second.command("session.subscribe", { sessionId });
      expect(await second.next((message) => message.type === "interaction_requested")).toEqual(
        asked,
      );
      expect(
        (
          await second.command("interaction.reply", {
            identity: { ...(asked.identity as object), epoch: "expired" },
            reply: "allow",
          })
        ).error,
      ).toEqual({ code: "interaction_stale" });
      expect(
        (
          await second.command("interaction.reply", {
            identity: asked.identity,
            reply: "allow-session",
          })
        ).result,
      ).toEqual({});
      await second.next((message) => message.type === "interaction_settled");
      await second.next((message) => message.type === "result");
      expect(
        second.messages.filter((message) => message.type === "interaction_requested"),
      ).toHaveLength(1);
      expect(
        (await second.command("interaction.reply", { identity: asked.identity, reply: "allow" }))
          .error,
      ).toEqual({ code: "interaction_stale" });
    } finally {
      second.socket.close();
    }
  } finally {
    first.socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

test("models, selection, mode, pin and preferences are public and durable", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-registry-wire-"));
  const fake = fakeModel([fauxAssistantMessage("done")]);
  let server = await startServer({ homeDir, sessionOptions: fake, onHandshake: () => {} });
  let client = await connect(server);
  try {
    expect((await client.command("models.list")).result).toEqual(
      expect.arrayContaining([expect.objectContaining({ spec: "faux/faux-1" })]),
    );
    const created = await client.command("session.create", {
      project: null,
      text: "hello",
      modelSelection: { provider: "faux", modelId: "faux-1", thinkingLevel: "off" },
      permissionMode: "full-access",
    });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await client.next((message) => message.type === "result");
    expect(await client.next((message) => message.type === "session_state")).toMatchObject({
      sessionId,
      permissionMode: "full-access",
      thinkingLevel: "off",
      contextReport: { model: "faux/faux-1", categories: expect.any(Array) },
    });

    expect(
      (
        await client.command("session.set_model", {
          sessionId,
          provider: "faux",
          modelId: "faux-1",
          thinkingLevel: "off",
        })
      ).result,
    ).toMatchObject({ model: "faux/faux-1" });
    expect(
      (await client.command("session.set_permission_mode", { sessionId, mode: "full-access" }))
        .result,
    ).toEqual({ mode: "full-access" });
    await client.command("session.pin", { sessionId });
    await client.command("preferences.set", {
      preferences: { sort: "created", showProjects: false },
    });
    expect(
      await client.next(
        (message) =>
          message.type === "sessions_changed" &&
          (message.preferences as { sort?: string }).sort === "created",
      ),
    ).toMatchObject({ pinned: [sessionId] });
    client.socket.close();
    await server.close();
    server = await startServer({ homeDir, sessionOptions: fake, onHandshake: () => {} });
    client = await connect(server);
    expect(
      (await client.command("preferences.set", { preferences: { showPinned: false } })).result,
    ).toEqual({ sort: "created", showProjects: false, showPinned: false });
    expect(await client.next((message) => message.type === "sessions_changed")).toMatchObject({
      pinned: [sessionId],
    });
    await client.command("session.unpin", { sessionId });
    expect(
      await client.next(
        (message) =>
          message.type === "sessions_changed" &&
          Array.isArray(message.pinned) &&
          message.pinned.length === 0,
      ),
    ).toBeDefined();
  } finally {
    client.socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

test.each(["success", "failure"])(
  "archive %s after the idle deadline still retires its unobserved Session",
  async (outcome) => {
    const owner = ownResources();
    let clock: ReturnType<typeof FakeTimers.install> | undefined;
    try {
      const homeDir = await owner.acquire(
        () => mkdtemp(join(tmpdir(), "rukie-archive-idle-")),
        (directory) => rm(directory, { recursive: true, force: true }),
      );
      const fake = fakeModel([fauxAssistantMessage("done")]);
      let expiredDuringDiscovery = false;
      // Restore global time only after the owned server and its timers have closed.
      owner.add(() => clock?.uninstall());
      const server = await owner.acquire(
        () =>
          startServer({
            homeDir,
            sessionOptions: fake,
            onHandshake: () => {},
            onWarning: () => {
              if (!clock || expiredDuringDiscovery) return;
              // Public discovery diagnostics place the deadline inside archive's awaited work.
              expiredDuringDiscovery = true;
              clock.tick(1);
              if (outcome === "failure") throw new Error("discovery diagnostic failed");
            },
          }),
        (resource) => resource.close(),
      );
      const client = await connect(server, "app://rukie", owner);
      const created = await client.command("session.create", { project: null, text: "hello" });
      const sessionId = (created.result as { sessionId: string }).sessionId;
      await client.next((message) => message.type === "result");
      clock = FakeTimers.install({
        now: Date.now(),
        toFake: ["Date", "setTimeout", "clearTimeout"],
      });
      await client.command("session.unsubscribe", { sessionId });
      const dataRoot = join(homeDir, "desktop-data");
      const cwd = (
        (await client.command("sessions.list")).result as { id: string; cwd: string }[]
      ).find((session) => session.id === sessionId)!.cwd;
      await clock.tickAsync(600000 - 1);
      await expect(
        createSession({ ...fake, homeDir, dataRoot, cwd, resumeId: sessionId }),
      ).rejects.toMatchObject({ code: "session-busy" });
      // Malformed external storage is reported through the public diagnostic callback.
      const malformed = join(dataRoot, "sessions", "unreadable-fixture");
      await mkdir(malformed);
      await writeFile(join(malformed, "session.sqlite"), "not a SQLite database");
      const archived = await client.command("session.archive", { sessionId });
      if (outcome === "success") expect(archived.error).toBeUndefined();
      else expect(archived.error).toEqual({ code: "internal" });
      expect(expiredDuringDiscovery).toBe(true);
      await rm(malformed, { recursive: true });
      client.messages.length = 0;
      await clock.tickAsync(600000 - 1);
      await expect(
        createSession({ ...fake, homeDir, dataRoot, cwd, resumeId: sessionId }),
      ).rejects.toMatchObject({ code: "session-busy" });
      clock.tick(1);
      const retired = await client.next(
        (message) => message.type === "sessions_changed" && message.closedSessionId === sessionId,
      );
      expect(retired.archived).toEqual(outcome === "success" ? [sessionId] : []);
      const reopened = await owner.acquire(
        () => createSession({ ...fake, homeDir, dataRoot, cwd, resumeId: sessionId }),
        (session) => session.close(),
      );
      expect(reopened.id).toBe(sessionId);
    } finally {
      await owner.close();
    }
  },
);

test("idle unsubscribed Session releases its lease exactly at ten minutes", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-idle-wire-"));
  const fake = fakeModel([fauxAssistantMessage("done")]);
  const server = await startServer({ homeDir, sessionOptions: fake, onHandshake: () => {} });
  const client = await connect(server);
  let clock: ReturnType<typeof FakeTimers.install> | undefined;
  try {
    const created = await client.command("session.create", { project: null, text: "hello" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await client.next((message) => message.type === "result");
    clock = FakeTimers.install({ now: Date.now(), toFake: ["Date", "setTimeout", "clearTimeout"] });
    await client.command("session.unsubscribe", { sessionId });
    const cwd = (
      (await client.command("sessions.list")).result as { id: string; cwd: string }[]
    ).find((session) => session.id === sessionId)!.cwd;
    await clock.tickAsync(600000 - 1);
    await expect(
      createSession({
        ...fake,
        homeDir,
        dataRoot: join(homeDir, "desktop-data"),
        cwd,
        resumeId: sessionId,
      }),
    ).rejects.toMatchObject({ code: "session-busy" });
    clock.tick(1);
    await client.next(
      (message) => message.type === "sessions_changed" && message.closedSessionId === sessionId,
    );
    const reopened = await createSession({
      ...fake,
      homeDir,
      dataRoot: join(homeDir, "desktop-data"),
      cwd,
      resumeId: sessionId,
    });
    await reopened.close();
  } finally {
    clock?.uninstall();
    client.socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

test("SIGTERM awaits Session shutdown and kills running Background Job process groups", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-signal-wire-"));
  // Real process/signal propagation and OS process-group death cannot use a parent virtual clock.
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "helpers/signal-server.ts"), homeDir],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stdout = child.stdout.getReader();
  let client: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    const first = await stdout.read();
    const connection: { port: number; token: string } = JSON.parse(
      new TextDecoder().decode(first.value),
    );
    client = await connect(connection);
    const created = await client.command("session.create", { project: null, text: "start job" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await client.next((message) => message.type === "result");
    const cwd = (
      (await client.command("sessions.list")).result as { id: string; cwd: string }[]
    ).find((session) => session.id === sessionId)!.cwd;
    const pid = await waitForPidFile(join(cwd, "pid"));
    expect(() => process.kill(pid, 0)).not.toThrow();
    child.kill("SIGTERM");
    expect(await child.exited).toBe(0);
    expect(() => process.kill(pid, 0)).toThrow();
    const resumed = await createSession({
      ...fakeModel([]),
      homeDir,
      dataRoot: join(homeDir, "desktop-data"),
      cwd,
      resumeId: sessionId,
    });
    expect(resumed.jobs()).toEqual([]);
    await resumed.close();
  } finally {
    client?.socket.close();
    child.kill();
    await child.exited;
    stdout.releaseLock();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

test("aborting a permission request broadcasts settlement and rejects its late epoch", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-cancel-permission-wire-"));
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("write", { path: "file", content: "one" }), {
      stopReason: "toolUse",
    }),
  ]);
  const server = await startServer({
    homeDir,
    sessionOptions: { ...fake, settings: { permissionMode: "ask" } },
    onHandshake: () => {},
  });
  const client = await connect(server);
  try {
    const created = await client.command("session.create", { project: null, text: "write" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    const asked = await client.next((message) => message.type === "interaction_requested");
    await client.command("abort", { sessionId });
    expect(await client.next((message) => message.type === "interaction_settled")).toMatchObject({
      identity: asked.identity,
    });
    expect(
      (await client.command("interaction.reply", { identity: asked.identity, reply: "allow" }))
        .error,
    ).toEqual({ code: "interaction_stale" });
  } finally {
    client.socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

test("Run, pending Interaction and Queued Input prevent idle reclamation", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-active-idle-wire-"));
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("write", { path: "file", content: "one" }), {
      stopReason: "toolUse",
    }),
  ]);
  const server = await startServer({
    homeDir,
    sessionOptions: { ...fake, settings: { permissionMode: "ask" } },
    onHandshake: () => {},
  });
  const client = await connect(server);
  let clock: ReturnType<typeof FakeTimers.install> | undefined;
  try {
    const created = await client.command("session.create", { project: null, text: "write" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await client.next((message) => message.type === "interaction_requested");
    await client.command("prompt", { sessionId, text: "queued" });
    expect((await client.command("session.archive", { sessionId })).error).toEqual({
      code: "session_busy",
    });
    expect((await client.command("session.delete", { sessionId })).error).toEqual({
      code: "session_busy",
    });
    clock = FakeTimers.install({ now: Date.now(), toFake: ["Date", "setTimeout", "clearTimeout"] });
    await client.command("session.unsubscribe", { sessionId });
    await clock.tickAsync(600001);
    await expect(
      createSession({
        ...fake,
        homeDir,
        dataRoot: join(homeDir, "desktop-data"),
        cwd: ((await client.command("sessions.list")).result as { id: string; cwd: string }[]).find(
          (session) => session.id === sessionId,
        )!.cwd,
        resumeId: sessionId,
      }),
    ).rejects.toMatchObject({ code: "session-busy" });
    expect((await client.command("abort", { sessionId })).result).toMatchObject({
      inputs: [{ prompt: "queued" }],
    });
  } finally {
    clock?.uninstall();
    client.socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

test("a running Background Job holds an unsubscribed idle Session", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-job-idle-wire-"));
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: "mkfifo input; printf '%s' $$ > pid; exec cat input",
        description: "Wait on FIFO",
        run_in_background: true,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("started"),
  ]);
  const server = await startServer({
    homeDir,
    sessionOptions: { ...fake, settings: { permissionMode: "full-access" } },
    onHandshake: () => {},
  });
  const client = await connect(server);
  let clock: ReturnType<typeof FakeTimers.install> | undefined;
  try {
    const created = await client.command("session.create", { project: null, text: "job" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await client.next((message) => message.type === "result");
    const cwd = (
      (await client.command("sessions.list")).result as { id: string; cwd: string }[]
    ).find((session) => session.id === sessionId)!.cwd;
    const pid = await waitForPidFile(join(cwd, "pid"));
    expect((await client.command("session.archive", { sessionId })).error).toEqual({
      code: "session_busy",
    });
    expect((await client.command("session.delete", { sessionId })).error).toEqual({
      code: "session_busy",
    });
    clock = FakeTimers.install({ now: Date.now(), toFake: ["Date", "setTimeout", "clearTimeout"] });
    await client.command("session.unsubscribe", { sessionId });
    await clock.tickAsync(600001);
    await expect(
      createSession({
        ...fake,
        homeDir,
        dataRoot: join(homeDir, "desktop-data"),
        cwd,
        resumeId: sessionId,
      }),
    ).rejects.toMatchObject({ code: "session-busy" });
    expect(() => process.kill(pid, 0)).not.toThrow();
  } finally {
    clock?.uninstall();
    client.socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

test("a native background Subagent holds a parent Session after its Run ends", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-child-idle-wire-"));
  const child = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
  const response: Parameters<typeof fakeModel>[0][number] = async (context, options) => {
    if (
      context.messages.some(
        (message) =>
          message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
      )
    )
      return fauxAssistantMessage("parent idle");
    options?.signal?.addEventListener(
      "abort",
      () => child.resolve(fauxAssistantMessage("cancelled")),
      { once: true },
    );
    return child.promise;
  };
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("subagent", { description: "Inspect", prompt: "child" }), {
      stopReason: "toolUse",
    }),
    response,
    response,
    fauxAssistantMessage("child notification received"),
  ]);
  fake.model.contextWindow = 100000;
  const server = await startServer({ homeDir, sessionOptions: fake, onHandshake: () => {} });
  const client = await connect(server);
  let clock: ReturnType<typeof FakeTimers.install> | undefined;
  try {
    const created = await client.command("session.create", { project: null, text: "delegate" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await client.next((message) => message.type === "run_end");
    await client.next(
      (message) =>
        message.type === "snapshot" &&
        (message.background as { active: boolean }[]).some((item) => item.active),
    );
    expect((await client.command("session.archive", { sessionId })).error).toEqual({
      code: "session_busy",
    });
    expect((await client.command("session.delete", { sessionId })).error).toEqual({
      code: "session_busy",
    });
    clock = FakeTimers.install({ now: Date.now(), toFake: ["Date", "setTimeout", "clearTimeout"] });
    await client.command("session.unsubscribe", { sessionId });
    await clock.tickAsync(600001);
    await expect(
      createSession({
        ...fake,
        homeDir,
        dataRoot: join(homeDir, "desktop-data"),
        cwd: ((await client.command("sessions.list")).result as { id: string; cwd: string }[]).find(
          (session) => session.id === sessionId,
        )!.cwd,
        resumeId: sessionId,
      }),
    ).rejects.toMatchObject({ code: "session-busy" });
  } finally {
    clock?.uninstall();
    child.resolve(fauxAssistantMessage("done"));
    client.socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

test("a session grant settles other pending permission cards covered by its rule", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-rule-settlement-wire-"));
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("write", { path: "first", content: "one" }, { id: "first" }),
        fauxToolCall("write", { path: "second", content: "two" }, { id: "second" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const server = await startServer({
    homeDir,
    sessionOptions: { ...fake, settings: { permissionMode: "ask" } },
    onHandshake: () => {},
  });
  const client = await connect(server);
  try {
    await client.command("session.create", { project: null, text: "write both" });
    const first = await client.next((message) => message.type === "interaction_requested");
    const second = await client.next(
      (message) =>
        message.type === "interaction_requested" &&
        (message.identity as { epoch: string }).epoch !==
          (first.identity as { epoch: string }).epoch,
    );
    await client.command("interaction.reply", { identity: first.identity, reply: "allow-session" });
    expect(
      await client.next(
        (message) =>
          message.type === "interaction_settled" &&
          (message.identity as { epoch: string }).epoch ===
            (second.identity as { epoch: string }).epoch,
      ),
    ).toBeDefined();
    await client.next((message) => message.type === "result");
    expect(
      (await client.command("interaction.reply", { identity: second.identity, reply: "allow" }))
        .error,
    ).toEqual({ code: "interaction_stale" });
  } finally {
    client.socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

test("unsubscribed Sessions publish permission creation, reconnect state and cancellation summaries", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-sidebar-permission-"));
  const reply = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
  const fake = fakeModel([() => reply.promise, fauxAssistantMessage("done")]);
  const server = await startServer({
    homeDir,
    sessionOptions: { ...fake, settings: { permissionMode: "ask" } },
    onHandshake: () => {},
  });
  const first = await connect(server);
  const summary = (
    message: Record<string, unknown>,
    id: string,
    waiting: boolean,
    running = true,
  ) =>
    message.type === "sessions_changed" &&
    Array.isArray(message.sessions) &&
    message.sessions.some(
      (item) => item.id === id && item.waitingPermission === waiting && item.running === running,
    );
  try {
    const created = await first.command("session.create", { project: null, text: "write file" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await first.command("session.unsubscribe", { sessionId });
    await first.next((m) => summary(m, sessionId, false));
    first.messages.length = 0;
    reply.resolve(
      fauxAssistantMessage(fauxToolCall("write", { path: "first.txt", content: "one" }), {
        stopReason: "toolUse",
      }),
    );
    await first.next((m) => m.type === "interaction_requested");
    await first.next((m) => summary(m, sessionId, true));
    const replacement = await connect(server);
    try {
      await replacement.next((m) => summary(m, sessionId, true));
      await replacement.command("abort", { sessionId });
      await replacement.next((m) => summary(m, sessionId, false, false));
      expect(replacement.messages.some((m) => m.type === "interaction_settled")).toBe(true);
    } finally {
      replacement.socket.close();
    }
  } finally {
    reply.resolve(fauxAssistantMessage("cleanup"));
    first.socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

test("desktop neither lists nor contends with a terminal Session in the same project", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-isolated-frontends-"));
  const fake = fakeModel([fauxAssistantMessage("desktop answer")]);
  const server = await startServer({ homeDir, sessionOptions: fake, onHandshake: () => {} });
  const cwd = join(homeDir, "desktop-data", "workspace");
  const terminal = await createSession({
    homeDir,
    cwd,
    ...fakeModel([fauxAssistantMessage("terminal answer")]),
  });
  const client = await connect(server);
  try {
    await terminal.run("terminal prompt");
    expect((await client.command("sessions.list")).result).toEqual([]);
    expect((await client.command("session.subscribe", { sessionId: terminal.id })).error).toEqual({
      code: "session_not_found",
    });
    const created = await client.command("session.create", {
      project: null,
      text: "desktop prompt",
    });
    expect(created.error).toBeUndefined();
    await client.next((message) => message.type === "result");
    expect(JSON.stringify((await client.command("sessions.list")).result)).not.toContain(
      terminal.id,
    );
  } finally {
    client.socket.close();
    await terminal.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

test("desktop output wire reads committed bytes after server restart without opening execution", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-output-wire-"));
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: "printf 'stored output'; printf diagnostic >&2",
        description: "persistent output",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  let server = await startServer({ homeDir, sessionOptions: fake, onHandshake: () => {} });
  let client = await connect(server);
  try {
    const created = await client.command("session.create", {
      project: null,
      text: "capture",
      permissionMode: "full-access",
    });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await client.next((message) => message.type === "result");
    const ended = client.messages.find(
      (message) => message.type === "tool_execution_end" && message.toolName === "bash",
    );
    const result = ended?.result as { details: { outputRef: { id: string } } };
    const outputRef = result.details.outputRef;
    expect(
      (await client.command("tool_output.read", { sessionId, outputRef, offset: 0 })).result,
    ).toMatchObject({ stdout: "stored output", stderr: "diagnostic", nextOffset: 23 });
    client.socket.close();
    await server.close();
    server = await startServer({ homeDir, onHandshake: () => {} });
    client = await connect(server);
    expect(
      (await client.command("prompt", { sessionId, text: "unconfigured model" })).error,
    ).toMatchObject({ code: "model_unavailable" });
    const owner = await createSession({
      cwd: ((await client.command("sessions.list")).result as { id: string; cwd: string }[]).find(
        (session) => session.id === sessionId,
      )!.cwd,
      homeDir,
      dataRoot: join(homeDir, "desktop-data"),
      resumeId: sessionId,
      ...fakeModel([]),
    });
    try {
      expect(
        (await client.command("tool_output.read", { sessionId, outputRef, offset: 7 })).result,
      ).toMatchObject({ stdout: "output", stderr: "diagnostic", nextOffset: 23 });
    } finally {
      await owner.close();
    }
    expect(
      (await client.command("tool_output.read", { sessionId, outputRef, offset: -1 })).error,
    ).toEqual({ code: "invalid_command" });
  } finally {
    client.socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("explicit private credential reveal is provider scoped and catalog access never decrypts", async () => {
  const owner = ownResources();
  const homeDir = await owner.acquire(
    () => mkdtemp(join(tmpdir(), "rukie-reveal-wire-")),
    (directory) => rm(directory, { recursive: true, force: true }),
  );
  let reads = 0;
  let fail = false;
  const server = await owner.acquire(
    () =>
      startServer({
        homeDir,
        managementToken: "fixture-management",
        onHandshake: () => {},
        encryption: {
          encrypt: async (_id, value) => value,
          decrypt: async (id, value) => {
            reads++;
            expect(id).toBe("provider:local");
            if (fail) throw new Error("sensitive failure");
            return value === "ciphertext-fixture" ? "fixture-key-only" : "";
          },
        },
      }),
    (resource) => resource.close(),
  );
  const manage = (input: unknown, token = "fixture-management", origin?: string) =>
    fetch(`http://127.0.0.1:${server.port}/private/model-services`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, ...(origin ? { origin } : {}) },
      body: JSON.stringify(input),
    });
  try {
    await manage({
      type: "save",
      provider: {
        id: "local",
        name: "Local",
        api: "openai-completions",
        baseUrl: "https://example.com",
        models: [],
      },
      credential: { type: "replace", ciphertext: "ciphertext-fixture" },
    });
    const list = await (await manage({ type: "list" })).text();
    expect(list).not.toContain("ciphertext-fixture");
    expect(reads).toBe(0);
    expect((await manage({ type: "revealKey", id: "local" }, server.token)).status).toBe(403);
    expect(
      (await manage({ type: "revealKey", id: "local" }, "fixture-management", "app://rukie"))
        .status,
    ).toBe(403);
    expect((await manage({ type: "revealKey", id: "oauth:other" })).status).toBe(400);
    expect((await manage({ type: "revealKey", id: "missing" })).status).toBe(409);
    expect(reads).toBe(0);
    expect(await (await manage({ type: "revealKey", id: "local" })).json()).toEqual({
      value: "fixture-key-only",
    });
    fail = true;
    const failed = await manage({ type: "revealKey", id: "local" });
    expect(failed.status).toBe(409);
    expect(await failed.text()).not.toContain("sensitive failure");
    fail = false;
    expect(await (await manage({ type: "revealKey", id: "local" })).json()).toEqual({
      value: "fixture-key-only",
    });
  } finally {
    await owner.close();
  }
});

test("development workspaces share configuration and preferences while keeping history and projects local", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-shared-dev-")),
      (root) => rm(root, { recursive: true, force: true }),
    );
    const configurationRoot = join(homeDir, "configuration");
    const dataA = join(homeDir, "a");
    const dataB = join(homeDir, "b");
    const settings = await owner.acquire(
      () => AppDatabase.open(configurationRoot),
      (db) => db.close(),
    );
    await settings.saveSettings({ permissionMode: "full-access" });
    await settings.saveProvider(
      {
        id: "shared",
        name: "Shared",
        api: "openai-completions",
        baseUrl: "https://example.com/v1",
        models: [{ id: "m" }],
      },
      { type: "replace", ciphertext: "opaque-shared" },
    );
    const history = await owner.acquire(
      () => createSession({ homeDir, dataRoot: dataA, cwd: homeDir, ...fakeModel([]) }),
      (session) => session.close(),
    );
    await history.close();
    const start = (dataRoot: string) =>
      owner.acquire(
        () => startServerImpl({ homeDir, dataRoot, configurationRoot, onHandshake: () => {} }),
        (server) => server.close(),
      );
    const a = await start(dataA);
    const b = await start(dataB);
    const clientA = await connect(a, "app://rukie", owner);
    const clientB = await connect(b, "app://rukie", owner);
    for (const client of [clientA, clientB]) {
      expect((await client.command("models.list")).result).toEqual([
        expect.objectContaining({ providerId: "shared", authenticated: true }),
      ]);
    }
    expect((await clientA.command("sessions.list")).result).toEqual([
      expect.objectContaining({ id: history.id }),
    ]);
    expect((await clientB.command("sessions.list")).result).toEqual([]);
    await clientA.command("project.create", { directories: [homeDir], trusted: true });
    expect((await clientB.command("projects.list")).result).toEqual([]);
    expect(
      (await clientA.command("preferences.set", { preferences: { showPinned: true } })).result,
    ).toEqual({ showPinned: true });
    expect(
      (await clientB.command("preferences.set", { preferences: { sort: "created" } })).result,
    ).toEqual({ showPinned: true, sort: "created" });
    await a.close();
    const restarted = await start(dataA);
    const client = await connect(restarted, "app://rukie", owner);
    await client.command("project.create", {
      name: "Project",
      directories: [homeDir],
      trusted: true,
    });
    const changed = await client.next((message) => message.type === "sessions_changed");
    expect(changed.preferences).toEqual({ showPinned: true, sort: "created" });
    expect((await client.command("sessions.list")).result).toEqual([
      expect.objectContaining({ id: history.id }),
    ]);
    const local = await owner.acquire(
      () => AppDatabase.open(dataA),
      (db) => db.close(),
    );
    expect(await local.providers()).toEqual([]);
    expect(await local.settings()).toEqual({});
    expect((await local.registry()).preferences).toEqual({});
    expect(await settings.credential("provider:shared")).toBe("opaque-shared");
    expect(await settings.settings()).toEqual({ permissionMode: "full-access" });
    expect(await settings.sessions()).toEqual([]);
  } finally {
    await owner.close();
  }
});

test("host wire authorizes registered roots and keeps paths in argument vectors", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-host-")),
      (root) => rm(root, { recursive: true, force: true }),
    );
    const calls: string[][] = [];
    const server = await owner.acquire(
      () =>
        startServer({
          homeDir,
          hostPlatform: "darwin",
          executeHost: async (argv) => {
            calls.push([...argv]);
            return { exitCode: 0, stdout: "" };
          },
          onHandshake: () => {},
        }),
      (resource) => resource.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    expect((await client.command("host.revealPath", { path: homeDir })).error).toEqual({
      code: "invalid_command",
    });
    await client.command("project.create", {
      name: "Project",
      directories: [homeDir],
      trusted: true,
    });
    expect((await client.command("host.revealPath", { path: homeDir })).error).toBeUndefined();
    expect(calls).toEqual([["/usr/bin/open", "-R", await realpath(homeDir)]]);
  } finally {
    await owner.close();
  }
});

for (const platform of ["darwin", "linux", "win32"] as const) {
  test(`host ${platform} uses safe native arguments and rejects path escapes`, async () => {
    const owner = ownResources();
    try {
      const homeDir = await owner.acquire(
        () => mkdtemp(join(tmpdir(), "rukie-host-platform-")),
        (root) => rm(root, { recursive: true, force: true }),
      );
      const project = join(homeDir, "project ; $(echo injected)");
      await mkdir(project);
      const file = join(project, "file.txt");
      await writeFile(file, "fixture");
      await symlink(homeDir, join(project, "escape"));
      const calls: string[][] = [];
      let folder = project;
      const server = await owner.acquire(
        () =>
          startServer({
            homeDir,
            hostPlatform: platform,
            executeHost: async (argv) => {
              calls.push([...argv]);
              return { exitCode: 0, stdout: folder ? `${folder}\n` : "" };
            },
            onHandshake: () => {},
          }),
        (resource) => resource.close(),
      );
      const client = await connect(server, "app://rukie", owner);
      await client.command("project.create", {
        name: "Project",
        directories: [project],
        trusted: true,
      });
      const canonical = await realpath(project);
      expect((await client.command("host.revealPath", { path: file })).error).toBeUndefined();
      expect(calls.pop()).toEqual(
        platform === "darwin"
          ? ["/usr/bin/open", "-R", join(canonical, "file.txt")]
          : platform === "linux"
            ? ["xdg-open", canonical]
            : ["explorer.exe", "/select,", join(canonical, "file.txt")],
      );
      expect(
        (await client.command("host.openInTerminal", { path: project })).error,
      ).toBeUndefined();
      expect(calls.pop()).toEqual(
        platform === "darwin"
          ? ["/usr/bin/open", "-a", "Terminal", canonical]
          : platform === "linux"
            ? ["x-terminal-emulator", "--working-directory", canonical]
            : ["wt.exe", "-d", canonical],
      );
      for (const path of [
        "relative",
        join(project, "missing"),
        join(project, "escape"),
        homeDir,
        `${project}\0`,
      ])
        expect((await client.command("host.revealPath", { path })).error).toEqual({
          code: "invalid_command",
        });
      expect((await client.command("host.openInTerminal", { path: file })).error).toEqual({
        code: "invalid_command",
      });
      const workspace = join(homeDir, "desktop-data", "workspace");
      expect(
        (await client.command("host.openInTerminal", { path: workspace })).error,
      ).toBeUndefined();
      calls.length = 0;
      const selected = await client.command("host.pickFolder");
      if (platform === "darwin") {
        expect(selected.result).toEqual([await realpath(project)]);
        expect(calls[0]?.slice(0, 2)).toEqual(["/usr/bin/osascript", "-e"]);
        expect(calls[0]?.[2]).not.toContain(project);
        folder = "";
        expect((await client.command("host.pickFolder")).result).toBeNull();
      } else {
        expect(selected.error).toEqual({ code: "unsupported" });
        expect(calls).toEqual([]);
      }
    } finally {
      await owner.close();
    }
  });
}

test("browser model services encrypt, keep and delete credentials through authenticated wire", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-wire-models-")),
      (path) => rm(path, { recursive: true, force: true }),
    );
    const warnings: string[] = [];
    const { memorySecretEncryption } = await import("../src/storage/secrets.ts");
    const server = await owner.acquire(
      () =>
        startServer({
          homeDir,
          development: true,
          encryptionBackend: "memory",
          encryption: memorySecretEncryption(),
          sessionOptions: fakeModel([fauxAssistantMessage("safe wire reply")]),
          onWarning: (warning) => warnings.push(warning),
          onHandshake: () => {},
        }),
      (server) => server.close(),
    );
    const client = await connect(server, "http://localhost:5173", owner);
    const provider = {
      id: "fixture",
      name: "Fixture",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:1",
      models: [],
    };
    expect(
      (
        await client.command("modelServices.save", {
          provider,
          credential: { type: "replace", value: "wire-secret-fixture" },
        })
      ).error,
    ).toBeUndefined();
    expect((await client.command("modelServices.list")).result).toEqual([
      { ...provider, hasCredential: true },
    ]);
    expect(JSON.stringify(client.messages)).not.toContain("wire-secret-fixture");
    client.messages.length = 0;
    expect(
      (await client.command("session.create", { project: null, text: "hello" })).error,
    ).toBeUndefined();
    await client.next((message) => message.type === "result");
    expect(client.messages.some((message) => message.type === "snapshot")).toBe(true);
    expect(JSON.stringify(client.messages)).not.toContain("wire-secret-fixture");
    expect(
      (await client.command("modelServices.revealKey", { providerId: "fixture" })).result,
    ).toEqual({ value: "wire-secret-fixture" });
    expect(
      (
        await client.command("modelServices.save", {
          provider: { ...provider, name: "Updated" },
          credential: { type: "keep" },
        })
      ).error,
    ).toBeUndefined();
    expect(
      (await client.command("modelServices.revealKey", { providerId: "fixture" })).result,
    ).toEqual({ value: "wire-secret-fixture" });
    expect(
      (await client.command("modelServices.save", { provider, credential: { type: "delete" } }))
        .error,
    ).toBeUndefined();
    expect(
      (await client.command("modelServices.revealKey", { providerId: "fixture" })).result,
    ).toEqual({ value: null });
    expect((await client.command("modelServices.list")).result).toEqual([
      { ...provider, hasCredential: false },
    ]);
    await client.command("modelServices.delete", { providerId: "fixture" });
    expect((await client.command("modelServices.list")).result).toEqual([]);
    expect(warnings).toEqual([]);
  } finally {
    await owner.close();
  }
});

for (const backend of ["electron", "memory"] as const) {
  test(`model service ${backend} failures never expose credential exceptions`, async () => {
    const owner = ownResources();
    try {
      const homeDir = await owner.acquire(
        () => mkdtemp(join(tmpdir(), "rukie-wire-model-error-")),
        (path) => rm(path, { recursive: true, force: true }),
      );
      const warnings: string[] = [];
      const server = await owner.acquire(
        () =>
          startServer({
            homeDir,
            development: true,
            encryptionBackend: backend,
            encryption: {
              encrypt: async () => {
                throw new Error("unsafe-fixture-key");
              },
              decrypt: async () => {
                throw new Error("unsafe-fixture-key");
              },
            },
            onWarning: (warning) => warnings.push(warning),
            onHandshake: () => {},
          }),
        (server) => server.close(),
      );
      const client = await connect(server, "http://localhost:5173", owner);
      const provider = {
        id: "fixture",
        name: "Fixture",
        api: "openai-completions",
        baseUrl: "",
        models: [],
      };
      const result = await client.command("modelServices.save", {
        provider,
        credential: { type: "replace", value: "unsafe-fixture-key" },
      });
      expect(result.error).toEqual({
        code: backend === "electron" ? "model_services_unavailable" : "internal",
      });
      if (backend === "memory")
        expect((await client.command("modelServices.list")).result).toEqual([]);
      else
        for (const type of ["list", "delete", "test", "revealKey", "prices"]) {
          const fields =
            type === "prices"
              ? { baseUrl: "http://127.0.0.1", modelId: "fixture" }
              : ["delete", "test", "revealKey"].includes(type)
                ? { providerId: "fixture", ...(type === "test" ? { modelId: "fixture" } : {}) }
                : {};
          expect((await client.command(`modelServices.${type}`, fields)).error).toEqual({
            code: "model_services_unavailable",
          });
        }
      expect(JSON.stringify(client.messages)).not.toContain("unsafe-fixture-key");
      expect(warnings.join(" ")).not.toContain("unsafe-fixture-key");
    } finally {
      await owner.close();
    }
  });
}

test("archive hides registry membership durably without opening or changing stored Session history", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-archive-wire-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const history = await owner.acquire(
      () =>
        createSession({
          homeDir,
          dataRoot: join(homeDir, "desktop-data"),
          cwd: join(homeDir, "desktop-data", "workspace"),
          ...fakeModel([fauxAssistantMessage("archived history")]),
        }),
      (session) => session.close(),
    );
    await history.run("keep this Transcript");
    await history.close();
    const storage = Bun.file(
      join(homeDir, "desktop-data", "sessions", history.id, "session.sqlite"),
    );
    const before = await storage.bytes();
    const server = await owner.acquire(
      () => startServer({ homeDir, onHandshake: () => {} }),
      (resource) => resource.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    await client.command("session.subscribe", { sessionId: history.id });
    expect((await client.command("session.pin", { sessionId: history.id })).error).toBeUndefined();
    expect(
      (await client.command("session.archive", { sessionId: history.id })).error,
    ).toBeUndefined();
    expect(
      await client.next(
        (message) => message.type === "sessions_changed" && message.closedSessionId === history.id,
      ),
    ).toMatchObject({
      archived: [history.id],
      pinned: [],
      sessions: [expect.objectContaining({ id: history.id })],
    });
    expect((await client.command("session.pin", { sessionId: history.id })).error).toEqual({
      code: "session_archived",
    });
    expect((await client.command("session.archive", { sessionId: "missing" })).error).toEqual({
      code: "session_not_found",
    });
    expect(await storage.bytes()).toEqual(before);
    await server.close();
    const app = await owner.acquire(
      () => AppDatabase.open(join(homeDir, "desktop-data")),
      (resource) => resource.close(),
    );
    expect(await app.registry()).toMatchObject({ archived: [history.id], pinned: [] });
  } finally {
    await owner.close();
  }
}, 5000);

test("archive refuses running and waiting Sessions but accepts a subscribed idle Session", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-archive-active-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const entered = Promise.withResolvers<void>();
    const proceed = Promise.withResolvers<void>();
    const fake = fakeModel([
      async () => {
        entered.resolve();
        await proceed.promise;
        return fauxAssistantMessage(fauxToolCall("write", { path: "file", content: "saved" }), {
          stopReason: "toolUse",
        });
      },
      fauxAssistantMessage("done"),
    ]);
    const server = await owner.acquire(
      () =>
        startServer({
          homeDir,
          sessionOptions: { ...fake, settings: { permissionMode: "ask" } },
          onHandshake: () => {},
        }),
      (resource) => resource.close(),
    );
    owner.add(() => proceed.resolve());
    const client = await connect(server, "app://rukie", owner);
    const moveDirectory = join(homeDir, "move-target");
    await mkdir(moveDirectory);
    const moveProject = (
      await client.command("project.create", {
        name: "Project",
        directories: [moveDirectory],
        trusted: true,
      })
    ).result as { id: string };
    const created = await client.command("session.create", { project: null, text: "write" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await entered.promise;
    expect((await client.command("session.archive", { sessionId })).error).toEqual({
      code: "session_busy",
    });
    expect((await client.command("session.delete", { sessionId })).error).toEqual({
      code: "session_busy",
    });
    expect(
      (await client.command("session.move", { sessionId, projectId: moveProject.id })).error,
    ).toEqual({ code: "session_busy" });
    proceed.resolve();
    const asked = await client.next((message) => message.type === "interaction_requested");
    expect((await client.command("session.archive", { sessionId })).error).toEqual({
      code: "session_busy",
    });
    expect((await client.command("session.delete", { sessionId })).error).toEqual({
      code: "session_busy",
    });
    expect(
      (await client.command("session.move", { sessionId, projectId: moveProject.id })).error,
    ).toEqual({ code: "session_busy" });
    expect((await client.command("session.pin", { sessionId })).error).toBeUndefined();
    await client.command("interaction.reply", { identity: asked.identity, reply: "allow" });
    await client.next((message) => message.type === "result");
    expect((await client.command("session.archive", { sessionId })).error).toBeUndefined();
    expect(
      await client.next(
        (message) => message.type === "sessions_changed" && message.closedSessionId === sessionId,
      ),
    ).toMatchObject({ archived: [sessionId], pinned: [] });
  } finally {
    await owner.close();
  }
}, 5000);

test("session.rename commits unopened titles without unlocking credentials or recovering pending work", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-rename-wire-")),
      (directory) => rm(directory, { recursive: true, force: true }),
    );
    const dataRoot = join(homeDir, "desktop-data");
    const crashed = await crashUnsafeEffect(homeDir, true, { dataRoot });
    const options = { homeDir, dataRoot, cwd: homeDir, id: crashed.sessionId };
    const pending = await readSessionSnapshot(options);
    expect(JSON.stringify(pending)).toContain("Unknown child");
    const fake = fakeModel([fauxAssistantMessage("must not recover")]);
    let decryptions = 0;
    const server = await owner.acquire(
      () =>
        startServer({
          homeDir,
          sessionOptions: fake,
          encryption: {
            async encrypt() {
              throw new Error("unexpected");
            },
            async decrypt() {
              decryptions++;
              throw new Error("unexpected");
            },
          },
          onHandshake: () => {},
        }),
      (resource) => resource.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    expect(
      (
        await client.command("session.rename", {
          sessionId: crashed.sessionId,
          title: "  Saved name  ",
        })
      ).error,
    ).toBeUndefined();
    expect(
      await client.next(
        (message) =>
          message.type === "sessions_changed" &&
          Array.isArray(message.sessions) &&
          message.sessions.some(
            (session) =>
              typeof session === "object" &&
              session !== null &&
              "title" in session &&
              session.title === "Saved name",
          ),
      ),
    ).toMatchObject({
      sessions: [
        expect.objectContaining({
          id: crashed.sessionId,
          title: "Saved name",
          titleSource: "user",
        }),
      ],
    });
    expect((await readSessionSnapshot(options)).messages).toEqual(pending.messages);
    expect(fake.contexts).toHaveLength(0);
    expect(decryptions).toBe(0);
    expect(
      client.messages.some(
        (message) =>
          message.type === "run_start" ||
          message.type === "result" ||
          message.type === "session_state",
      ),
    ).toBe(false);
    expect(
      (await client.command("session.rename", { sessionId: crashed.sessionId, title: " " })).error,
    ).toEqual({ code: "invalid_command" });
    expect(
      (await client.command("session.rename", { sessionId: "missing", title: "Name" })).error,
    ).toEqual({ code: "session_not_found" });
    await server.close();
    expect(fake.contexts).toHaveLength(0);
  } finally {
    await owner.close();
  }
});

test("session.rename uses an open owner and reports another host's occupied lease without writing", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-live-rename-wire-")),
      (directory) => rm(directory, { recursive: true, force: true }),
    );
    const server = await owner.acquire(
      () =>
        startServer({
          homeDir,
          sessionOptions: fakeModel([fauxAssistantMessage("done")]),
          onHandshake: () => {},
        }),
      (resource) => resource.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    const created = await client.command("session.create", { project: null, text: "hello" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await client.next((message) => message.type === "result");
    expect(
      (await client.command("session.rename", { sessionId, title: "Live name" })).error,
    ).toBeUndefined();
    expect(
      await client.next(
        (message) => message.type === "session_title_changed" && message.title === "Live name",
      ),
    ).toBeDefined();
    const options = { homeDir, dataRoot: join(homeDir, "desktop-data"), cwd: homeDir };
    const occupied = await owner.acquire(
      () => createSession({ ...options, ...fakeModel([]) }),
      (resource) => resource.close(),
    );
    await occupied.rename("External owner");
    expect(
      (await client.command("session.rename", { sessionId: occupied.id, title: "Rejected" })).error,
    ).toEqual({ code: "session_busy" });
    expect(await listSessions(options)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: occupied.id, title: "External owner" }),
      ]),
    );
  } finally {
    await owner.close();
  }
});

test("session.delete closes an idle opened Session and removes pinned and archived storage", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-delete-wire-")),
      (directory) => rm(directory, { recursive: true, force: true }),
    );
    const server = await owner.acquire(
      () =>
        startServer({
          homeDir,
          sessionOptions: fakeModel([fauxAssistantMessage("done")]),
          onHandshake: () => {},
        }),
      (resource) => resource.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    const created = await client.command("session.create", { project: null, text: "hello" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await client.next((message) => message.type === "result");
    expect((await client.command("session.pin", { sessionId })).error).toBeUndefined();
    expect((await client.command("session.archive", { sessionId })).error).toBeUndefined();
    const [deletion, concurrentPrompt] = await Promise.all([
      client.command("session.delete", { sessionId }),
      client.command("prompt", { sessionId, text: "cannot reopen during deletion" }),
    ]);
    expect(deletion.error).toBeUndefined();
    expect(concurrentPrompt.error).toEqual({ code: "session_busy" });
    expect(
      await client.next(
        (message) =>
          message.type === "sessions_changed" &&
          message.closedSessionId === sessionId &&
          Array.isArray(message.sessions) &&
          message.sessions.length === 0,
      ),
    ).toMatchObject({ sessions: [], pinned: [], archived: [] });
    expect(
      await Bun.file(
        join(homeDir, "desktop-data", "sessions", sessionId, "session.sqlite"),
      ).exists(),
    ).toBe(false);
    expect(
      (await client.command("prompt", { sessionId, text: "must not recreate" })).error,
    ).toEqual({ code: "session_not_found" });
    expect((await client.command("session.delete", { sessionId: "missing" })).error).toEqual({
      code: "session_not_found",
    });
    await server.close();
    const restarted = await owner.acquire(
      () => startServer({ homeDir, sessionOptions: fakeModel([]), onHandshake: () => {} }),
      (resource) => resource.close(),
    );
    const second = await connect(restarted, "app://rukie", owner);
    expect(await second.next((message) => message.type === "sessions_changed")).toMatchObject({
      sessions: [],
      pinned: [],
      archived: [],
    });
  } finally {
    await owner.close();
  }
});

test("session.delete refuses another host's lease and preserves its organization records", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-delete-busy-wire-")),
      (directory) => rm(directory, { recursive: true, force: true }),
    );
    const options = { homeDir, dataRoot: join(homeDir, "desktop-data"), cwd: homeDir };
    const occupied = await owner.acquire(
      () => createSession({ ...options, ...fakeModel([]) }),
      (resource) => resource.close(),
    );
    await occupied.rename("Kept");
    const server = await owner.acquire(
      () => startServer({ homeDir, sessionOptions: fakeModel([]), onHandshake: () => {} }),
      (resource) => resource.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    const sessionId = occupied.id;
    expect((await client.command("session.pin", { sessionId })).error).toBeUndefined();
    expect((await client.command("session.delete", { sessionId })).error).toEqual({
      code: "session_busy",
    });
    expect(await client.command("sessions.list")).toMatchObject({
      result: [expect.objectContaining({ id: sessionId, title: "Kept" })],
    });
    await occupied.close();
    expect((await client.command("session.delete", { sessionId })).error).toBeUndefined();
    expect(
      await client.next(
        (message) => message.type === "sessions_changed" && message.closedSessionId === sessionId,
      ),
    ).toMatchObject({ sessions: [], pinned: [], archived: [] });
  } finally {
    await owner.close();
  }
});

test("archive rejects an external Core Run without changing registry membership", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-archive-external-")),
      (directory) => rm(directory, { recursive: true, force: true }),
    );
    const entered = Promise.withResolvers<void>();
    const proceed = Promise.withResolvers<void>();
    const occupied = await owner.acquire(
      () =>
        createSession({
          homeDir,
          dataRoot: join(homeDir, "desktop-data"),
          cwd: homeDir,
          ...fakeModel([
            async () => {
              entered.resolve();
              await proceed.promise;
              return fauxAssistantMessage("finished");
            },
          ]),
        }),
      (session) => session.close(),
    );
    const server = await owner.acquire(
      () => startServer({ homeDir, onHandshake: () => {} }),
      (resource) => resource.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    expect((await client.command("session.pin", { sessionId: occupied.id })).error).toBeUndefined();
    const run = occupied.run("working outside server");
    owner.add(async () => {
      proceed.resolve();
      await run;
    });
    await entered.promise;
    expect((await client.command("session.archive", { sessionId: occupied.id })).error).toEqual({
      code: "session_busy",
    });
    const database = await owner.acquire(
      () => AppDatabase.open(join(homeDir, "desktop-data")),
      (resource) => resource.close(),
    );
    expect(await database.registry()).toMatchObject({ pinned: [occupied.id], archived: [] });
  } finally {
    await owner.close();
  }
});

test("archive rejects a prompt accepted while model preparation is pending", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-archive-admission-")),
      (directory) => rm(directory, { recursive: true, force: true }),
    );
    const proceed = Promise.withResolvers<void>();
    const fake = fakeModel([
      fauxAssistantMessage("initialized"),
      async () => {
        await proceed.promise;
        return fauxAssistantMessage("finished");
      },
    ]);
    const server = await owner.acquire(
      () => startServer({ homeDir, sessionOptions: fake, onHandshake: () => {} }),
      (resource) => resource.close(),
    );
    owner.add(() => proceed.resolve());
    const client = await connect(server, "app://rukie", owner);
    const created = await client.command("session.create", { project: null, text: "initialize" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await client.next((message) => message.type === "result" && message.sessionId === sessionId);
    expect((await client.command("session.pin", { sessionId })).error).toBeUndefined();
    // One socket preserves request arrival order. Prompt dispatch yields for model catalog reads.
    const prompt = client.command("prompt", { sessionId, text: "already accepted" });
    const archive = client.command("session.archive", { sessionId });
    expect((await archive).error).toEqual({ code: "session_busy" });
    expect((await prompt).error).toBeUndefined();
    const database = await owner.acquire(
      () => AppDatabase.open(join(homeDir, "desktop-data")),
      (resource) => resource.close(),
    );
    expect(await database.registry()).toMatchObject({ pinned: [sessionId], archived: [] });
    proceed.resolve();
  } finally {
    await owner.close();
  }
});

test("archive reserves command admission before committing and refuses a concurrent prompt", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-archive-reserved-")),
      (directory) => rm(directory, { recursive: true, force: true }),
    );
    const fake = fakeModel([fauxAssistantMessage("must not run")]);
    const history = await owner.acquire(
      () =>
        createSession({ homeDir, dataRoot: join(homeDir, "desktop-data"), cwd: homeDir, ...fake }),
      (session) => session.close(),
    );
    const sessionId = history.id;
    await history.close();
    const server = await owner.acquire(
      () => startServer({ homeDir, sessionOptions: fake, onHandshake: () => {} }),
      (resource) => resource.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    expect((await client.command("session.subscribe", { sessionId })).error).toBeUndefined();
    // Same-socket arrival order makes archive own admission before any awaited discovery/save.
    const archive = client.command("session.archive", { sessionId });
    const prompt = client.command("prompt", { sessionId, text: "must not run hidden" });
    expect((await archive).error).toBeUndefined();
    expect((await prompt).error).toEqual({ code: "session_busy" });
    expect(fake.contexts).toHaveLength(0);
    expect(client.messages.some((message) => message.type === "run_start")).toBe(false);
    const database = await owner.acquire(
      () => AppDatabase.open(join(homeDir, "desktop-data")),
      (resource) => resource.close(),
    );
    expect(await database.registry()).toMatchObject({ archived: [sessionId] });
  } finally {
    await owner.close();
  }
});

test("session.move preserves an unopened Session and publishes its new Project cwd without execution", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      async () => realpath(await mkdtemp(join(tmpdir(), "rukie-move-wire-"))),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const dataRoot = join(homeDir, "desktop-data");
    const target = join(homeDir, "target");
    await mkdir(target);
    const history = await owner.acquire(
      () =>
        createSession({
          homeDir,
          dataRoot,
          cwd: homeDir,
          ...fakeModel([fauxAssistantMessage("history")]),
        }),
      (session) => session.close(),
    );
    await history.run("original");
    await history.rename("Preserved title");
    await history.close();
    const before = await readSessionSnapshot({ homeDir, dataRoot, cwd: homeDir, id: history.id });
    const execution = fakeModel([fauxAssistantMessage("must not run")]);
    const server = await owner.acquire(
      () => startServer({ homeDir, sessionOptions: execution, onHandshake: () => {} }),
      (resource) => resource.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    const project = (
      await client.command("project.create", {
        name: "Project",
        directories: [target],
        trusted: true,
      })
    ).result as { id: string };
    await client.command("session.pin", { sessionId: history.id });
    client.messages.length = 0;
    expect(
      (await client.command("session.move", { sessionId: history.id, projectId: project.id }))
        .error,
    ).toBeUndefined();
    const changed = await client.next((message) => message.type === "sessions_changed");
    expect(changed).toMatchObject({
      sessions: [
        expect.objectContaining({ id: history.id, cwd: target, title: "Preserved title" }),
      ],
      pinned: [history.id],
    });
    expect(
      (await readSessionSnapshot({ homeDir, dataRoot, cwd: target, id: history.id })).messages,
    ).toEqual(before.messages);
    expect(execution.contexts).toHaveLength(0);
    expect(
      client.messages.some(
        (message) =>
          message.type === "run_start" ||
          message.type === "result" ||
          message.type === "session_state",
      ),
    ).toBe(false);
    expect(
      (await client.command("session.move", { sessionId: history.id, projectId: project.id }))
        .error,
    ).toEqual({ code: "invalid_command" });
    expect(
      (await client.command("session.move", { sessionId: history.id, projectId: "missing" })).error,
    ).toEqual({ code: "project_not_found" });
    expect(
      (await client.command("session.move", { sessionId: "missing", projectId: project.id })).error,
    ).toEqual({ code: "session_not_found" });
    expect(
      (await client.command("session.move", { sessionId: history.id, projectId: null })).error,
    ).toEqual({ code: "invalid_command" });
  } finally {
    await owner.close();
  }
});

test("session.move closes an idle owner and the next prompt executes in the target directory", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      async () => realpath(await mkdtemp(join(tmpdir(), "rukie-live-move-"))),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const target = join(homeDir, "target");
    await mkdir(target);
    const execution = fakeModel([fauxAssistantMessage("before"), fauxAssistantMessage("after")]);
    const server = await owner.acquire(
      () => startServer({ homeDir, sessionOptions: execution, onHandshake: () => {} }),
      (resource) => resource.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    const project = (
      await client.command("project.create", {
        name: "Project",
        directories: [target],
        trusted: true,
      })
    ).result as { id: string };
    const created = (await client.command("session.create", { project: null, text: "hello" }))
      .result as { sessionId: string };
    const sessionId = created.sessionId;
    await client.next((message) => message.type === "result");
    const [moved, concurrent] = await Promise.all([
      client.command("session.move", { sessionId, projectId: project.id }),
      client.command("prompt", { sessionId, text: "must not execute while moving" }),
    ]);
    expect(moved.error).toBeUndefined();
    expect(concurrent.error).toEqual({ code: "session_busy" });
    expect(execution.contexts).toHaveLength(1);
    // Subscription is history-only; only a prompt may resume execution at the new cwd.
    expect((await client.command("session.subscribe", { sessionId })).error).toBeUndefined();
    expect(execution.contexts).toHaveLength(1);
    client.messages.length = 0;
    expect((await client.command("prompt", { sessionId, text: "continue" })).error).toBeUndefined();
    await client.next((message) => message.type === "result");
    expect(JSON.stringify(execution.contexts[1]?.messages)).toContain(target);
    expect(JSON.stringify(execution.contexts[1]?.messages)).toContain("Working directory changed");
    expect((await client.command("sessions.list")).result).toEqual([
      expect.objectContaining({ id: sessionId, cwd: target }),
    ]);
  } finally {
    await owner.close();
  }
});

test("session.move rejects an external writer and leaves pending unopened work untouched", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      async () => realpath(await mkdtemp(join(tmpdir(), "rukie-busy-move-"))),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const dataRoot = join(homeDir, "desktop-data");
    const target = join(homeDir, "target");
    await mkdir(target);
    const crashed = await crashUnsafeEffect(homeDir, true, { dataRoot });
    const options = { homeDir, dataRoot, cwd: homeDir, id: crashed.sessionId };
    const before = await readSessionSnapshot(options);
    const execution = fakeModel([fauxAssistantMessage("must not recover")]);
    const server = await owner.acquire(
      () => startServer({ homeDir, sessionOptions: execution, onHandshake: () => {} }),
      (resource) => resource.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    const project = (
      await client.command("project.create", {
        name: "Project",
        directories: [target],
        trusted: true,
      })
    ).result as { id: string };
    const occupied = await owner.acquire(
      () => createSession({ homeDir, dataRoot, cwd: homeDir, ...fakeModel([]) }),
      (resource) => resource.close(),
    );
    expect(
      (await client.command("session.move", { sessionId: occupied.id, projectId: project.id }))
        .error,
    ).toEqual({ code: "session_busy" });
    expect((await client.command("sessions.list")).result).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: occupied.id, cwd: homeDir })]),
    );
    expect(
      (
        await client.command("session.move", {
          sessionId: crashed.sessionId,
          projectId: project.id,
        })
      ).error,
    ).toBeUndefined();
    const after = await readSessionSnapshot({ ...options, cwd: target });
    expect(after.messages).toEqual(before.messages);
    expect(after.inbox).toEqual(before.inbox);
    expect(execution.contexts).toHaveLength(0);
  } finally {
    await owner.close();
  }
});

test("project.update validates complete canonical state and requires trust only for trusted additions", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-project-update-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const first = await realpath(await mkdtemp(join(homeDir, "first-")));
    const second = await realpath(await mkdtemp(join(homeDir, "second-")));
    const third = await realpath(await mkdtemp(join(homeDir, "third-")));
    const other = await realpath(await mkdtemp(join(homeDir, "other-")));
    const alias = join(homeDir, "alias");
    await symlink(second, alias);
    const db = await owner.acquire(
      () => AppDatabase.open(join(homeDir, "desktop-data")),
      (db) => db.close(),
    );
    await db.saveRegistry({
      projects: [
        { id: "p", name: "Original", directories: [first, second], primary: first, trusted: true },
        { id: "u", name: "Untrusted", directories: [third], primary: third, trusted: false },
        { id: "o", name: "Other Project", directories: [other], primary: other, trusted: true },
      ],
      pinned: [],
      archived: [],
      preferences: {},
    });
    const server = await owner.acquire(
      () => startServer({ homeDir, onHandshake: () => {} }),
      (server) => server.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    const edit = {
      projectId: "p",
      name: "  Renamed  ",
      directories: [first, alias, second],
      primary: alias,
    };
    expect((await client.command("project.update", edit)).result).toEqual({
      id: "p",
      name: "Renamed",
      directories: [first, second],
      primary: second,
      trusted: true,
    });
    for (const name of ["", "   ", "x".repeat(129)])
      expect((await client.command("project.update", { ...edit, name })).error).toEqual({
        code: "invalid_command",
      });
    for (const name of ["", "   ", "x".repeat(129)])
      expect(
        (await client.command("project.create", { name, directories: [first], trusted: true }))
          .error,
      ).toEqual({ code: "invalid_command" });
    expect(
      (await client.command("project.create", { directories: [first], trusted: true })).error,
    ).toEqual({ code: "invalid_command" });
    expect(
      (await client.command("project.update", { ...edit, projectId: "missing" })).error,
    ).toEqual({ code: "project_not_found" });
    expect((await client.command("project.update", { ...edit, directories: [] })).error).toEqual({
      code: "invalid_command",
    });
    expect((await client.command("project.update", { ...edit, primary: other })).error).toEqual({
      code: "invalid_command",
    });
    expect(
      (
        await client.command("project.update", {
          ...edit,
          directories: ["relative"],
          primary: "relative",
        })
      ).error,
    ).toEqual({ code: "project_not_found" });
    const missing = join(homeDir, "missing");
    expect(
      (
        await client.command("project.update", {
          ...edit,
          directories: [missing],
          primary: missing,
        })
      ).error,
    ).toEqual({ code: "project_not_found" });
    const reserved = join(homeDir, "desktop-data", "workspace");
    expect(
      (
        await client.command("project.update", {
          ...edit,
          directories: [reserved],
          primary: reserved,
        })
      ).error,
    ).toEqual({ code: "project_reserved" });
    expect(
      (await client.command("project.update", { ...edit, directories: [other], primary: other }))
        .error,
    ).toEqual({ code: "project_conflict", params: { project: "Other Project" } });
    const added = await realpath(await mkdtemp(join(homeDir, "added-")));
    const addition = { ...edit, directories: [first, second, added], primary: first };
    expect((await client.command("project.update", addition)).error).toEqual({
      code: "project_trust_required",
    });
    expect(
      (await client.command("project.update", { ...addition, trusted: true })).result,
    ).toMatchObject({ directories: [first, second, added], trusted: true });
    expect(
      (await client.command("project.update", { ...edit, directories: [first], primary: first }))
        .result,
    ).toMatchObject({ directories: [first], trusted: true });
    expect(
      (
        await client.command("project.update", {
          projectId: "u",
          name: "Untrusted Edited",
          directories: [third, second],
          primary: second,
          trusted: true,
        })
      ).result,
    ).toMatchObject({ trusted: false, primary: second });
    await client.next(
      (message) =>
        message.type === "sessions_changed" &&
        Array.isArray(message.projects) &&
        message.projects.some(
          (p) =>
            typeof p === "object" && p !== null && "name" in p && p.name === "Untrusted Edited",
        ),
    );
  } finally {
    await owner.close();
  }
});

test("project.remove rejects running and waiting Sessions in any directory and preserves idle history and files", async () => {
  const owner = ownResources();
  const proceed = Promise.withResolvers<void>();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-project-remove-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const first = await realpath(await mkdtemp(join(homeDir, "first-")));
    const second = await realpath(await mkdtemp(join(homeDir, "second-")));
    const dataRoot = join(homeDir, "desktop-data");
    const history = await owner.acquire(
      () =>
        createSession({
          homeDir,
          dataRoot,
          cwd: first,
          ...fakeModel([fauxAssistantMessage("archived history")]),
        }),
      (session) => session.close(),
    );
    await history.run("keep archived");
    await history.close();
    const db = await owner.acquire(
      () => AppDatabase.open(dataRoot),
      (db) => db.close(),
    );
    await db.saveRegistry({
      projects: [
        { id: "p", name: "Project", directories: [first, second], primary: second, trusted: true },
      ],
      pinned: [],
      archived: [history.id],
      preferences: {},
    });
    const entered = Promise.withResolvers<void>();
    const fake = fakeModel([
      async () => {
        entered.resolve();
        await proceed.promise;
        return fauxAssistantMessage(
          fauxToolCall("write", { path: "kept.txt", content: "kept content" }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("done"),
    ]);
    const server = await owner.acquire(
      () =>
        startServer({
          homeDir,
          onHandshake: () => {},
          sessionOptions: { ...fake, settings: { permissionMode: "ask" } },
        }),
      (server) => server.close(),
    );
    owner.add(() => proceed.resolve());
    const client = await connect(server, "app://rukie", owner);
    const created = await client.command("session.create", { project: "p", text: "write" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await entered.promise;
    expect((await client.command("project.remove", { projectId: "p" })).error).toEqual({
      code: "session_busy",
    });
    proceed.resolve();
    const asked = await client.next((message) => message.type === "interaction_requested");
    expect((await client.command("project.remove", { projectId: "p" })).error).toEqual({
      code: "session_busy",
    });
    await client.command("interaction.reply", { identity: asked.identity, reply: "allow" });
    await client.next((message) => message.type === "result");
    await client.command("session.pin", { sessionId });
    const before = await readSessionSnapshot({ homeDir, dataRoot, cwd: second, id: sessionId });
    const archivedBefore = await readSessionSnapshot({
      homeDir,
      dataRoot,
      cwd: first,
      id: history.id,
    });
    expect((await client.command("project.remove", { projectId: "p" })).result).toEqual({});
    expect((await client.command("project.remove", { projectId: "p" })).error).toEqual({
      code: "project_not_found",
    });
    await client.next(
      (message) =>
        message.type === "sessions_changed" &&
        Array.isArray(message.projects) &&
        message.projects.length === 0 &&
        Array.isArray(message.pinned) &&
        message.pinned.includes(sessionId),
    );
    expect((await client.command("projects.list")).result).toEqual([]);
    expect((await client.command("sessions.list")).result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: sessionId, cwd: second }),
        expect.objectContaining({ id: history.id, cwd: first }),
      ]),
    );
    expect(await readSessionSnapshot({ homeDir, dataRoot, cwd: second, id: sessionId })).toEqual(
      before,
    );
    expect(await readSessionSnapshot({ homeDir, dataRoot, cwd: first, id: history.id })).toEqual(
      archivedBefore,
    );
    expect(await Bun.file(join(second, "kept.txt")).text()).toBe("kept content");
    await server.close();
    const reopened = await owner.acquire(
      () => startServer({ homeDir, onHandshake: () => {} }),
      (server) => server.close(),
    );
    const reconnect = await connect(reopened, "app://rukie", owner);
    expect((await reconnect.command("projects.list")).result).toEqual([]);
    expect(await reconnect.next((message) => message.type === "sessions_changed")).toMatchObject({
      pinned: [sessionId],
      archived: [history.id],
    });
  } finally {
    proceed.resolve();
    await owner.close();
  }
});

test("Project edits and removal reload idle Session ownership, directories and trust without interrupting an active Run", async () => {
  const owner = ownResources();
  const proceed = Promise.withResolvers<void>();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-project-reopen-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const first = await realpath(await mkdtemp(join(homeDir, "first-")));
    const second = await realpath(await mkdtemp(join(homeDir, "second-")));
    const third = await realpath(await mkdtemp(join(homeDir, "third-")));
    await mkdir(join(first, ".rukie"));
    await writeFile(
      join(first, ".rukie", "settings.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "printf 'opened\\n' >> opens" }] }],
        },
      }),
    );
    await writeFile(join(second, "AGENTS.md"), "SECOND_INITIAL");
    await writeFile(join(third, "AGENTS.md"), "THIRD_ADDED");
    const entered = Promise.withResolvers<void>();
    const fake = fakeModel([
      async () => {
        entered.resolve();
        await proceed.promise;
        return fauxAssistantMessage("first done");
      },
      ...Array.from({ length: 4 }, () => fauxAssistantMessage("done")),
    ]);
    const server = await owner.acquire(
      () => startServer({ homeDir, onHandshake: () => {}, sessionOptions: fake }),
      (server) => server.close(),
    );
    owner.add(() => proceed.resolve());
    const client = await connect(server, "app://rukie", owner);
    const project = (
      await client.command("project.create", {
        name: "Project",
        directories: [first, second],
        trusted: true,
      })
    ).result as { id: string };
    const created = await client.command("session.create", { project: project.id, text: "first" });
    const sessionId = (created.result as { sessionId: string }).sessionId;
    await entered.promise;
    const update = {
      projectId: project.id,
      name: "Edited",
      directories: [first, third],
      primary: third,
      trusted: true,
    };
    expect((await client.command("project.update", update)).error).toBeUndefined();
    expect((await client.command("sessions.list")).result).toEqual([
      expect.objectContaining({ id: sessionId, cwd: first, running: true }),
    ]);
    expect(client.messages.some((message) => message.type === "result")).toBe(false);
    expect(await Bun.file(join(first, "opens")).text()).toBe("opened\n");
    proceed.resolve();
    await client.next((message) => message.type === "result");
    const prompt = async (text: string, count: number) => {
      client.messages.length = 0;
      expect((await client.command("prompt", { sessionId, text })).error).toBeUndefined();
      await client.next((message) => message.type === "result" && fake.contexts.length === count);
    };
    await writeFile(join(second, "AGENTS.md"), "SECOND_REMOVED_UPDATE");
    await prompt("after directory edit", 2);
    expect(JSON.stringify(fake.contexts[1])).toContain("THIRD_ADDED");
    expect(JSON.stringify(fake.contexts[1])).not.toContain("SECOND_REMOVED_UPDATE");
    expect(await Bun.file(join(first, "opens")).text()).toBe("opened\nopened\n");
    expect(
      (await client.command("project.remove", { projectId: project.id })).error,
    ).toBeUndefined();
    await writeFile(join(third, "AGENTS.md"), "THIRD_REMOVED_PROJECT");
    await prompt("after Project removal", 3);
    expect(JSON.stringify(fake.contexts[2])).not.toContain("THIRD_REMOVED_PROJECT");
    expect(await Bun.file(join(first, "opens")).text()).toBe("opened\nopened\n");
    const replacement = (
      await client.command("project.create", {
        name: "Replacement",
        directories: [first, second],
        trusted: true,
      })
    ).result as { id: string };
    await prompt("after registration", 4);
    expect(JSON.stringify(fake.contexts[3])).toContain("SECOND_REMOVED_UPDATE");
    expect(await Bun.file(join(first, "opens")).text()).toBe("opened\nopened\nopened\n");
    expect(
      (
        await client.command("project.update", {
          projectId: replacement.id,
          name: "Only second",
          directories: [second],
          primary: second,
        })
      ).error,
    ).toBeUndefined();
    await writeFile(join(second, "AGENTS.md"), "SECOND_NO_LONGER_OWNED");
    await prompt("after cwd removal", 5);
    expect(JSON.stringify(fake.contexts[4])).not.toContain("SECOND_NO_LONGER_OWNED");
    expect(await Bun.file(join(first, "opens")).text()).toBe("opened\nopened\nopened\n");
    expect((await client.command("sessions.list")).result).toEqual([
      expect.objectContaining({ id: sessionId, cwd: first }),
    ]);
  } finally {
    proceed.resolve();
    await owner.close();
  }
});

test("legacy alias Project edits preserve cwd hook trust until membership or registration removal", async () => {
  const owner = ownResources();
  try {
    const homeDir = await owner.acquire(
      () => mkdtemp(join(tmpdir(), "rukie-alias-trust-")),
      (directory) => rm(directory, { recursive: true, force: true }),
    );
    const canonical = await realpath(await mkdtemp(join(homeDir, "repository-")));
    const alias = join(homeDir, "link");
    const second = await realpath(await mkdtemp(join(homeDir, "second-")));
    await symlink(canonical, alias);
    await mkdir(join(canonical, ".rukie"));
    await writeFile(
      join(canonical, ".rukie", "settings.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "printf 'trusted-open\\n' >> opens" }] },
          ],
        },
      }),
    );
    const database = await owner.acquire(
      () => AppDatabase.open(join(homeDir, "desktop-data")),
      (resource) => resource.close(),
    );
    // A pre-canonicalized registration retains its explicit trust and original path spelling.
    await database.saveRegistry({
      projects: [
        {
          id: "legacy",
          name: "Original",
          directories: [alias, second],
          primary: alias,
          trusted: true,
        },
      ],
      pinned: [],
      archived: [],
      preferences: {},
    });
    await database.close();
    const fake = fakeModel(Array.from({ length: 5 }, () => fauxAssistantMessage("done")));
    const server = await owner.acquire(
      () => startServer({ homeDir, onHandshake: () => {}, sessionOptions: fake }),
      (resource) => resource.close(),
    );
    const client = await connect(server, "app://rukie", owner);
    const created = await client.command("session.create", { project: "legacy", text: "first" });
    expect(created.error).toBeUndefined();
    if (
      typeof created.result !== "object" ||
      created.result === null ||
      !("sessionId" in created.result) ||
      typeof created.result.sessionId !== "string"
    )
      throw new Error("Missing Session id");
    const sessionId = created.result.sessionId;
    await client.next((message) => message.type === "result" && message.sessionId === sessionId);
    const opens = Bun.file(join(canonical, "opens"));
    expect(await opens.text()).toBe("trusted-open\n");
    const prompt = async (text: string, count: number) => {
      client.messages.length = 0;
      expect((await client.command("prompt", { sessionId, text })).error).toBeUndefined();
      await client.next((message) => message.type === "result" && fake.contexts.length === count);
    };
    const renamed = await client.command("project.update", {
      projectId: "legacy",
      name: "Renamed",
      directories: [alias, second],
      primary: alias,
    });
    expect(renamed.error).toBeUndefined();
    expect(renamed.result).toMatchObject({ directories: [canonical, second], primary: canonical });
    await prompt("after rename-only canonicalization", 2);
    expect(await opens.text()).toBe("trusted-open\ntrusted-open\n");
    expect(
      (
        await client.command("project.update", {
          projectId: "legacy",
          name: "Only second",
          directories: [second],
          primary: second,
        })
      ).error,
    ).toBeUndefined();
    await prompt("after cwd membership removal", 3);
    expect(await opens.text()).toBe("trusted-open\ntrusted-open\n");
    const replacement = await client.command("project.create", {
      name: "Replacement",
      directories: [canonical],
      trusted: true,
    });
    expect(replacement.error).toBeUndefined();
    if (
      typeof replacement.result !== "object" ||
      replacement.result === null ||
      !("id" in replacement.result) ||
      typeof replacement.result.id !== "string"
    )
      throw new Error("Missing Project id");
    await prompt("after canonical registration", 4);
    expect(await opens.text()).toBe("trusted-open\ntrusted-open\ntrusted-open\n");
    expect(
      (await client.command("project.remove", { projectId: replacement.result.id })).error,
    ).toBeUndefined();
    await prompt("after registration removal", 5);
    expect(await opens.text()).toBe("trusted-open\ntrusted-open\ntrusted-open\n");
    expect((await client.command("sessions.list")).result).toEqual([
      expect.objectContaining({ id: sessionId, cwd: alias, projectId: null }),
    ]);
  } finally {
    await owner.close();
  }
});
