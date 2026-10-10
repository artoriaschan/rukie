import FakeTimers from "@sinonjs/fake-timers";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { waitForPidFile } from "../../agent/tests/helpers/wait-for-file.ts";
import { join } from "node:path";
import { createSession, createJsonlStore } from "@rukie/agent";
import { startServer } from "../src/index.ts";

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

async function connect(server: { port: number; token: string }, origin = "app://rukie") {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
    protocols: ["rukie.v1", `rukie.auth.${server.token}`],
    headers: { Origin: origin },
  });
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

test("a new Session streams and can be reopened from the shared JSONL store", async () => {
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

test("project registration survives restart and a removed project cannot hide other Sessions", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-projects-"));
  const projectDir = await mkdtemp(join(tmpdir(), "rukie-project-"));
  let server = await startServer({ homeDir, onHandshake: () => {} });
  let client = await connect(server);
  try {
    const added = await client.command("project.add", { path: projectDir });
    expect(added.result).toMatchObject({ path: projectDir });
    expect(
      (await client.command("project.add", { path: join(projectDir, "missing") })).error,
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

test("a TUI-owned Session is listed but cannot be opened by desktop", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "rukie-busy-"));
  const fake = fakeModel([fauxAssistantMessage("held writer reply")]);
  const server = await startServer({ homeDir, sessionOptions: fake, onHandshake: () => {} });
  const owned = await createSession({
    ...fake,
    homeDir,
    cwd: join(homeDir, ".rukie", "desktop", "workspace"),
  });
  await owned.run("held writer prompt");
  const log = Bun.file(
    join(
      createJsonlStore({ homeDir, cwd: join(homeDir, ".rukie", "desktop", "workspace") }).key(
        owned.id,
      ),
      "main.jsonl",
    ),
  );
  const committed = await log.text();
  const client = await connect(server);
  try {
    expect((await client.command("session.subscribe", { sessionId: owned.id })).error).toEqual({
      code: "session_busy",
    });
    const snapshot = await client.next((message) => message.type === "snapshot");
    expect(JSON.stringify(snapshot)).toContain("held writer reply");
    expect(await log.text()).toBe(committed);
    expect(
      (await client.command("prompt", { sessionId: owned.id, text: "must not write" })).error,
    ).toEqual({ code: "session_busy" });
  } finally {
    client.socket.close();
    await owned.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
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
    const cwd = join(homeDir, ".rukie", "desktop", "workspace");
    await clock.tickAsync(600000 - 1);
    await expect(
      createSession({ ...fake, homeDir, cwd, resumeId: sessionId }),
    ).rejects.toMatchObject({ code: "session-busy" });
    clock.tick(1);
    await client.next(
      (message) => message.type === "sessions_changed" && message.closedSessionId === sessionId,
    );
    const reopened = await createSession({ ...fake, homeDir, cwd, resumeId: sessionId });
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
    const cwd = join(homeDir, ".rukie", "desktop", "workspace");
    const pid = await waitForPidFile(join(cwd, "pid"));
    expect(() => process.kill(pid, 0)).not.toThrow();
    child.kill("SIGTERM");
    expect(await child.exited).toBe(0);
    expect(() => process.kill(pid, 0)).toThrow();
    const resumed = await createSession({ ...fakeModel([]), homeDir, cwd, resumeId: sessionId });
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
    clock = FakeTimers.install({ now: Date.now(), toFake: ["Date", "setTimeout", "clearTimeout"] });
    await client.command("session.unsubscribe", { sessionId });
    await clock.tickAsync(600001);
    await expect(
      createSession({
        ...fake,
        homeDir,
        cwd: join(homeDir, ".rukie", "desktop", "workspace"),
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
    const cwd = join(homeDir, ".rukie", "desktop", "workspace");
    const pid = await waitForPidFile(join(cwd, "pid"));
    clock = FakeTimers.install({ now: Date.now(), toFake: ["Date", "setTimeout", "clearTimeout"] });
    await client.command("session.unsubscribe", { sessionId });
    await clock.tickAsync(600001);
    await expect(
      createSession({ ...fake, homeDir, cwd, resumeId: sessionId }),
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
    clock = FakeTimers.install({ now: Date.now(), toFake: ["Date", "setTimeout", "clearTimeout"] });
    await client.command("session.unsubscribe", { sessionId });
    await clock.tickAsync(600001);
    await expect(
      createSession({
        ...fake,
        homeDir,
        cwd: join(homeDir, ".rukie", "desktop", "workspace"),
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
