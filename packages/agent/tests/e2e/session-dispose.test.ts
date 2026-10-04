import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { abortingModel } from "../helpers/aborting-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each([undefined, "other"] as const)(
  "dispose matches reason %s and concurrent calls run SessionEnd once",
  async (reason) => {
    dirs = await tempDirs();
    const fake = fakeModel([fauxAssistantMessage("done")]);
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        hooks: {
          SessionEnd: [
            { matcher: reason ?? "exit", hooks: [{ type: "command", command: "cat >> input" }] },
            {
              matcher: reason === "other" ? "exit" : "other",
              hooks: [{ type: "command", command: "touch wrong" }],
            },
          ],
        },
      },
    });
    await session.run("hi");
    await Promise.all([session.dispose(reason), session.dispose("other")]);
    await session.dispose();
    const input = await Bun.file(join(dirs.cwd, "input")).json();
    expect(input).toMatchObject({
      session_id: session.id,
      cwd: dirs.cwd,
      permission_mode: "ask",
      hook_event_name: "SessionEnd",
      reason: reason ?? "exit",
    });
    expect(isAbsolute(input.transcript_path)).toBe(true);
    expect(await Bun.file(join(dirs.cwd, "wrong")).exists()).toBe(false);
  },
);

test("dispose interrupts an active Run and closes its MCP process", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.homeDir, "manifest.json"), JSON.stringify({ tools: ["echo"] }));
  await Bun.write(
    join(dirs.homeDir, ".neant/mcp.json"),
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
  const fake = abortingModel();
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        SessionEnd: [{ hooks: [{ type: "command", command: "echo ended >> count" }] }],
      },
    },
  });
  const run = session.run("wait").catch((error: unknown) => error);
  await fake.started;
  const pid = Number((await Bun.file(join(dirs.homeDir, "pids")).text()).trim());
  expect(() => process.kill(pid, 0)).not.toThrow();
  try {
    await session.dispose();
    expect(await run).toBeInstanceOf(Error);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(await Bun.file(join(dirs.cwd, "count")).text()).toBe("ended\n");
    await expect(session.run("again")).rejects.toThrow("disposed");
  } finally {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* Already closed. */
    }
  }
});

test("SessionEnd discards all output and retains the small handler timeout", async () => {
  dirs = await tempDirs();
  const warnings: string[] = [];
  const session = await createSession({
    ...dirs,
    ...fakeModel([]),
    onWarning: (warning) => {
      warnings.push(warning);
    },
    settings: {
      hooks: {
        SessionEnd: [
          {
            hooks: [
              { type: "command", command: "echo '{bad}'" },
              { type: "command", command: "sleep 10; touch late", timeout: 0.02 },
              {
                type: "command",
                command: 'echo \'{"continue":false,"systemMessage":"ignore","unknownField":true}\'',
              },
            ],
          },
        ],
      },
    },
  });
  const started = performance.now();
  await session.dispose();
  expect(performance.now() - started).toBeLessThan(1000);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("timed out after 0.02s");
  expect(await Bun.file(join(dirs.cwd, "late")).exists()).toBe(false);
});

test("dispose cancels a slow in-flight tool hook before running SessionEnd", async () => {
  dirs = await tempDirs();
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(fauxToolCall("bash", { command: "touch forbidden" }), {
        stopReason: "toolUse",
      }),
    ]),
    permissionMode: "full-access",
    settings: {
      hooks: {
        PreToolUse: [
          {
            hooks: [{ type: "command", command: "touch hook-started; sleep 10; touch hook-late" }],
          },
        ],
        SessionEnd: [{ hooks: [{ type: "command", command: "touch ended" }] }],
      },
    },
  });
  const run = session.run("try").catch((error: unknown) => error);
  const deadline = Date.now() + 2000;
  while (!(await Bun.file(join(dirs.cwd, "hook-started")).exists())) {
    if (Date.now() > deadline) throw new Error("Tool hook did not start");
    await Bun.sleep(10);
  }
  const started = performance.now();
  await session.dispose();
  expect(performance.now() - started).toBeLessThan(1000);
  expect(await run).toBeInstanceOf(Error);
  expect(await Bun.file(join(dirs.cwd, "hook-late")).exists()).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "forbidden")).exists()).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "ended")).exists()).toBe(true);
});

test("an event observer can await dispose without waiting on its own Run", async () => {
  dirs = await tempDirs();
  const warnings: string[] = [];
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fakeModel([]),
    onWarning: (warning) => {
      warnings.push(warning);
    },
    settings: {
      hooks: {
        SessionEnd: [{ hooks: [{ type: "command", command: "sleep 10", timeout: 0.02 }] }],
      },
    },
  });
  const started = performance.now();
  await expect(
    session.run("try", {
      onEvent: async (event) => {
        events.push(event);
        await session.dispose();
      },
    }),
  ).rejects.toThrow();
  expect(performance.now() - started).toBeLessThan(1000);
  expect(warnings).toHaveLength(1);
  expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
    { event: "SessionEnd", error: { code: "hook-timeout", params: { timeout: "0.02" } } },
  ]);
});

test("SessionEnd exit failures emit diagnostics after the Run while discarding output", async () => {
  dirs = await tempDirs();
  const warnings: string[] = [];
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fakeModel([fauxAssistantMessage("done")]),
    onWarning: (warning) => {
      warnings.push(warning);
    },
    settings: {
      hooks: {
        SessionEnd: [
          { hooks: [{ type: "command", command: "echo '{bad}'; echo failed >&2; exit 3" }] },
        ],
      },
    },
  });
  await session.run("try", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  await session.dispose();
  expect(warnings).toHaveLength(1);
  expect(events.at(-1)).toMatchObject({
    type: "hook_warning",
    sessionId: session.id,
    event: "SessionEnd",
    error: { code: "hook-exit", params: { exitCode: "3", stderr: "failed" } },
  });
});

test("SessionEnd handlers share a 1.5 second total shutdown budget", async () => {
  dirs = await tempDirs();
  const warnings: string[] = [];
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fakeModel([fauxAssistantMessage("done")]),
    onWarning: (warning) => {
      warnings.push(warning);
    },
    settings: {
      hooks: {
        SessionEnd: [
          {
            hooks: [
              { type: "command", command: "cat > first; sleep 10; touch first-late" },
              {
                type: "command",
                command: "cat > second; sleep 10; touch second-late",
                timeout: 10,
              },
            ],
          },
        ],
      },
    },
  });
  await session.run("try", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  const started = performance.now();
  await session.dispose();
  expect(performance.now() - started).toBeLessThan(2500);
  expect(warnings).toHaveLength(2);
  expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
    { event: "SessionEnd", error: { code: "hook-timeout", params: { timeout: "1.5" } } },
    { event: "SessionEnd", error: { code: "hook-timeout", params: { timeout: "1.5" } } },
  ]);
  for (const name of ["first", "second"]) {
    expect((await Bun.file(join(dirs.cwd, name)).json()).hook_event_name).toBe("SessionEnd");
    expect(await Bun.file(join(dirs.cwd, `${name}-late`)).exists()).toBe(false);
  }
});
