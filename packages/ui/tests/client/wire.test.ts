import { expect, test } from "vitest";
import { createWireClient } from "../../src/client";
import { startWireFixture } from "../helpers/wire";

test("correlates commands and resubscribes with fresh connection credentials", async () => {
  const server = await startWireFixture();
  let connectionReads = 0;
  const client = createWireClient({
    getConnection: async () => {
      connectionReads++;
      return server.connection;
    },
  });
  try {
    await client.connect();
    await client.subscribe("one");
    const projects = await client.request({ type: "projects.list" });
    expect(projects).toEqual([{ id: "project", name: "Project", path: "/project" }]);
    await server.disconnect();
    await expect.poll(() => client.getState()).toBe("connected");
    await expect.poll(() => connectionReads).toBe(2);
    await expect
      .poll(
        async () => (await server.commands()).filter((c) => c.type === "session.subscribe").length,
      )
      .toBe(2);
  } finally {
    client.close();
    await server.close();
  }
});

test("superseded connections stop automatic reconnect and reject commands until Retry", async () => {
  const server = await startWireFixture();
  const client = createWireClient({ getConnection: async () => server.connection });
  try {
    await client.connect();
    await fetch(`http://127.0.0.1:${server.connection.port}/supersede`);
    await expect.poll(() => client.getState()).toBe("disconnected");
    await expect(client.request({ type: "models.list" })).rejects.toMatchObject({
      code: "disconnected",
    });
    await client.connect();
    expect(client.getState()).toBe("connected");
    client.hostState("disconnected");
    expect(client.getState()).toBe("disconnected");
    await expect(client.request({ type: "sessions.list" })).rejects.toMatchObject({
      code: "disconnected",
    });
  } finally {
    client.close();
    await server.close();
  }
});

test("concurrent response IDs survive reversed arrival; disconnected requests reject", async () => {
  const server = await startWireFixture();
  const client = createWireClient({ getConnection: async () => server.connection });
  try {
    await client.connect();
    await fetch(`http://127.0.0.1:${server.connection.port}/hold`);
    const projects = client.request({ type: "projects.list" });
    const models = client.request({ type: "models.list" });
    await expect.poll(async () => (await server.commands()).length).toBe(2);
    await fetch(`http://127.0.0.1:${server.connection.port}/flush`);
    expect(await projects).toEqual([{ id: "project", name: "Project", path: "/project" }]);
    expect(await models).toEqual([
      expect.objectContaining({ spec: "test/script", thinkingLevels: ["off", "low", "high"] }),
    ]);
    await fetch(`http://127.0.0.1:${server.connection.port}/hold`);
    const pending = client.request({ type: "sessions.list" });
    const rejection = expect(pending).rejects.toMatchObject({ code: "disconnected" });
    client.hostState("disconnected");
    await rejection;
  } finally {
    client.close();
    await server.close();
  }
});

test("unrecognized wire error codes settle requests as invalid_command", async () => {
  const server = await startWireFixture();
  const client = createWireClient({ getConnection: async () => server.connection });
  try {
    await client.connect();
    await fetch(`http://127.0.0.1:${server.connection.port}/hold`);
    const result = client.request({ type: "models.list" });
    const rejection = expect(result).rejects.toMatchObject({ code: "invalid_command" });
    await expect.poll(async () => (await server.commands()).length).toBe(1);
    const [command] = await server.commands();
    if (!command) throw new Error("Expected held command");
    await server.send({ type: "response", id: command.id, error: { code: "unexpected" } });
    await rejection;
  } finally {
    client.close();
    await server.close();
  }
});
