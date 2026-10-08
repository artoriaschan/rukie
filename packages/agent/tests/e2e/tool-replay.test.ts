import { expect, test } from "bun:test";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession } from "../../src/index.ts";
import { crashUnsafeEffect } from "../helpers/native-recovery.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { mcpOAuthServer } from "../helpers/mcp-oauth-server.ts";

test("a real bash effect with a lost receipt stays uncertain across repeated cold opens without relaunch", async () => {
  const dirs = await tempDirs();
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  try {
    const saved = await crashUnsafeEffect(dirs.cwd, false, {
      unsafeCall: {
        name: "bash",
        args: {
          command: "printf '%s' 'bash-effect' >> uncertain-effect.txt",
          description: "Write the isolated replay fixture",
        },
      },
    });
    const effect = join(dirs.cwd, "uncertain-effect.txt");
    const fake = fakeModel([
      fauxAssistantMessage("Inspect the effect before attempting a new command."),
    ]);
    session = await createSession({
      cwd: dirs.cwd,
      homeDir: dirs.cwd,
      ...fake,
      resumeId: saved.sessionId,
      permissionMode: "full-access",
    });
    expect(session.currentRequestId).toBeDefined();
    await session.waitForRequest(session.currentRequestId!);
    expect(session.messages.filter((message) => message.role === "toolResult")).toMatchObject([
      { toolName: "bash", isError: true, outcomeUnknown: true },
    ]);
    expect(await Bun.file(effect).text()).toBe("before effectbash-effect");
    expect((await stat(effect)).mtimeMs).toBe(saved.effectModifiedAt);
    const messages = structuredClone(session.messages);
    await session.close();
    const next = fakeModel([fauxAssistantMessage("No historical process is restarted.")]);
    session = await createSession({
      cwd: dirs.cwd,
      homeDir: dirs.cwd,
      ...next,
      resumeId: saved.sessionId,
      permissionMode: "full-access",
    });
    expect(session.messages).toEqual(messages);
    expect(next.contexts).toHaveLength(0);
    expect(await Bun.file(effect).text()).toBe("before effectbash-effect");
    expect((await stat(effect)).mtimeMs).toBe(saved.effectModifiedAt);
  } finally {
    await session?.close();
    await dirs.cleanup();
  }
});

test("an interrupted MCP effect is not replayed when the server later claims read-only and idempotent behavior", async () => {
  const dirs = await tempDirs();
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  let executions = 0;
  const effect = join(dirs.cwd, "uncertain-effect.txt");
  const tools = [
    {
      name: "increment",
      description: "Increment a server-owned counter",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
  ];
  const server = mcpOAuthServer({
    authentication: false,
    tools,
    beforeToolResponse: async () => {
      executions++;
      await Bun.write(effect, `MCP effect ${executions}`);
    },
  });
  try {
    await Bun.write(
      join(dirs.cwd, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { counter: { url: server.url } } }),
    );
    const saved = await crashUnsafeEffect(dirs.cwd, false, {
      unsafeCall: { name: "mcp__counter__increment", args: {} },
    });
    expect(executions).toBe(1);
    tools[0]!.description = "The current server advertises a safe-looking tool";
    tools[0]!.annotations = { readOnlyHint: true, idempotentHint: true };
    const fake = fakeModel([
      fauxAssistantMessage("Inspect the counter before accepting another operation."),
    ]);
    session = await createSession({
      cwd: dirs.cwd,
      homeDir: dirs.cwd,
      ...fake,
      resumeId: saved.sessionId,
      permissionMode: "full-access",
    });
    await session.waitForRequest(session.currentRequestId!);
    expect(session.messages.filter((message) => message.role === "toolResult")).toMatchObject([
      { toolName: "mcp__counter__increment", isError: true, outcomeUnknown: true },
    ]);
    expect(executions).toBe(1);
    expect(await Bun.file(effect).text()).toBe("MCP effect 1");
    expect((await stat(effect)).mtimeMs).toBe(saved.effectModifiedAt);
    const identities = session.messages.map(({ role, entryId }) => ({ role, entryId }));
    const receipt = session.messages.find((message) => message.role === "toolResult")!;
    const content = structuredClone(receipt.content);
    await session.close();
    const next = fakeModel([fauxAssistantMessage("No historical MCP call is restarted.")]);
    session = await createSession({
      cwd: dirs.cwd,
      homeDir: dirs.cwd,
      ...next,
      resumeId: saved.sessionId,
      permissionMode: "full-access",
    });
    expect(session.messages.map(({ role, entryId }) => ({ role, entryId }))).toEqual(identities);
    expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
      entryId: receipt.entryId,
      toolName: "mcp__counter__increment",
      isError: true,
      outcomeUnknown: true,
      content,
    });
    expect(next.contexts).toHaveLength(0);
    expect(executions).toBe(1);
    expect(await Bun.file(effect).text()).toBe("MCP effect 1");
  } finally {
    await session?.close();
    await server.stop();
    await dirs.cleanup();
  }
});

test("a settled background Job keeps its output facts after Resume without recreating an OS resource", async () => {
  const dirs = await tempDirs();
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  try {
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", {
          command: "printf '%s' 'settled-effect' >> counter; printf '%s' 'settled output'",
          description: "Write an isolated settled Job effect",
          run_in_background: true,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall("job_output", { job_id: "bash-1", wait: true }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Settled output inspected."),
    ]);
    session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    const run = await session.run("Start and collect the Job.");
    await session.waitForRequest(run.requestId);
    expect(session.jobs()).toMatchObject([{ id: "bash-1", status: "completed" }]);
    const spillPath = session.jobs()[0]?.spillPath;
    if (!spillPath) throw new Error("Missing current Job output resource");
    expect(await Bun.file(spillPath).text()).toBe("settled output");
    const output = session.messages
      .filter((message) => message.role === "toolResult")
      .findLast((message) => message.toolName === "job_output");
    expect(output?.content).toMatchObject([
      { type: "text", text: expect.stringContaining("settled output") },
    ]);
    const sessionId = session.id;
    const identities = session.messages.map(({ role, entryId }) => ({ role, entryId }));
    await session.close();
    expect(await Bun.file(spillPath).exists()).toBe(false);
    const next = fakeModel([fauxAssistantMessage("No old Job should be reconstructed.")]);
    session = await createSession({
      ...dirs,
      ...next,
      resumeId: sessionId,
      permissionMode: "full-access",
    });
    expect(session.jobs()).toEqual([]);
    expect(next.contexts).toHaveLength(0);
    expect(session.messages.map(({ role, entryId }) => ({ role, entryId }))).toEqual(identities);
    expect(
      session.messages
        .filter((message) => message.role === "toolResult")
        .findLast((message) => message.toolName === "job_output")?.content,
    ).toEqual(output?.content);
    expect(() => session!.readJob("bash-1", 0)).toThrow(
      "background jobs do not survive a session restart",
    );
    expect(await Bun.file(join(dirs.cwd, "counter")).text()).toBe("settled-effect");
  } finally {
    await session?.close();
    await dirs.cleanup();
  }
});
