import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "@rukie/agent";
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
      socket.onmessage = (event) => resolve(JSON.parse(String(event.data)));
    });
    socket.send(JSON.stringify({ id: "1", type: "projects.list" }));
    expect(await response).toEqual({ type: "response", id: "1", result: [] });
  } finally {
    socket.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
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
      expect(replacement.messages[0]?.type).toBe("snapshot");
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
      expect((await second.command("prompt", { sessionId, text: "busy" })).error).toEqual({
        code: "session_busy",
      });
      const result = await second.command("abort", { sessionId });
      expect(result.result).toEqual({ inputs: [] });
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
  const fake = fakeModel([]);
  const server = await startServer({ homeDir, sessionOptions: fake, onHandshake: () => {} });
  const owned = await createSession({
    ...fake,
    homeDir,
    cwd: join(homeDir, ".rukie", "desktop", "workspace"),
  });
  const client = await connect(server);
  try {
    expect((await client.command("session.subscribe", { sessionId: owned.id })).error).toEqual({
      code: "session_busy",
    });
  } finally {
    client.socket.close();
    await owned.close();
    await server.close();
    await rm(homeDir, { recursive: true, force: true });
  }
}, 5000);
